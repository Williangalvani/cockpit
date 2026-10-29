import { flushPromises, mount } from '@vue/test-utils'
import L from 'leaflet'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, h, onMounted, onUnmounted } from 'vue'

import { ExternalMapMeshesLayer } from '@/libs/map/external-map-meshes-layer'

vi.mock('@/composables/snackbar', () => ({ openSnackbar: vi.fn() }))
vi.mock('@/libs/map/external-map-meshes-gl', () => ({ mapMeshGlRenderer: () => undefined }))
vi.mock('@/composables/map/useExternalMapMeshes', () => ({
  useExternalMapMeshes: () => ({ meshes: { meshes: new Map(), subscribe: () => () => undefined } }),
}))

const { defaultMeshOpacity, useExternalMapMeshLayers } = await import('@/composables/map/useExternalMapMeshLayers')

let map: L.Map
const meshCanvas = (): HTMLCanvasElement | null | undefined => map.getPane('externalMeshPane')?.querySelector('canvas')
const meshAlpha = (): number | undefined => {
  let alpha: number | undefined
  map.eachLayer((layer) => {
    if (layer instanceof ExternalMapMeshesLayer) alpha = Reflect.get(layer, 'mapAlpha')
  })
  return alpha
}

beforeEach(() => {
  globalThis.requestAnimationFrame = vi.fn()
  globalThis.cancelAnimationFrame = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  const container = document.createElement('div')
  document.body.appendChild(container)
  map = L.map(container, { zoomAnimation: false }).setView([-27.59, -48.55], 15)
})

afterEach(() => {
  map.remove()
  vi.restoreAllMocks()
})

describe('useExternalMapMeshLayers mesh opacity', () => {
  test('draws a new map at the default until it is set otherwise', () => {
    const layers = useExternalMapMeshLayers()
    layers.init(map)
    expect(meshAlpha()).toBe(defaultMeshOpacity)
    layers.destroy()
  })

  test('applies an opacity set before init, keeps it across a destroy and a new init, and redraws on a change', () => {
    const layers = useExternalMapMeshLayers()
    layers.setMeshOpacity(defaultMeshOpacity)
    layers.init(map)
    expect(meshAlpha()).toBe(0.5)

    layers.destroy()
    expect(meshCanvas()).toBeNull()
    layers.init(map)
    expect(meshAlpha()).toBe(0.5)

    vi.mocked(requestAnimationFrame).mockClear()
    layers.setMeshOpacity(0.8)
    expect(meshAlpha()).toBe(0.8)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
    expect(meshCanvas()?.style.opacity).toBe('')
    layers.destroy()
  })
})

describe('useExternalMapMeshLayers mesh visibility', () => {
  test('hides and shows the meshes after init, keeping their opacity', () => {
    const layers = useExternalMapMeshLayers()
    layers.setMeshOpacity(0.3)
    layers.init(map)

    layers.setMeshesShown(false)
    expect(meshCanvas()).toBeNull()

    layers.setMeshesShown(true)
    expect(meshAlpha()).toBe(0.3)
    layers.destroy()
  })

  test('redraws the meshes each time they are shown again', () => {
    const layers = useExternalMapMeshLayers()
    layers.init(map)
    for (let toggle = 0; toggle < 3; toggle++) {
      layers.setMeshesShown(false)
      vi.mocked(requestAnimationFrame).mockClear()
      layers.setMeshesShown(true)
      expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
    }
    layers.destroy()
  })

  test('applies a hide set before init, across a destroy and a new init', () => {
    const layers = useExternalMapMeshLayers()
    layers.setMeshesShown(false)
    layers.init(map)
    expect(meshCanvas()).toBeNull()

    layers.destroy()
    layers.init(map)
    expect(meshCanvas()).toBeNull()

    layers.setMeshesShown(true)
    expect(meshCanvas()).toBeTruthy()
    layers.destroy()
    expect(meshCanvas()).toBeNull()
  })

  test('leaves the other map layers drawn while the meshes are hidden', () => {
    const geoTiff = L.imageOverlay('data:,', map.getBounds()).addTo(map)
    const layers = useExternalMapMeshLayers()
    layers.init(map)

    layers.setMeshesShown(false)
    expect(meshCanvas()).toBeNull()
    expect(map.hasLayer(geoTiff)).toBe(true)

    layers.setMeshesShown(true)
    expect(meshCanvas()).toBeTruthy()
    expect(map.hasLayer(geoTiff)).toBe(true)
    layers.destroy()
  })
})

describe('useExternalMapMeshLayers in a component that awaits other layers before init', () => {
  const liveIntervals = (): unknown[] => {
    const cleared = vi.mocked(clearInterval).mock.calls.map(([id]) => id)
    return vi
      .mocked(setInterval)
      .mock.results.map(({ value }) => value)
      .filter((id) => !cleared.includes(id))
  }

  // Mounts as Mission Planning does: an async mount hook initializes the meshes after awaiting the GeoTIFF overlays.
  // Returns the unmount, and what makes the overlays ready.
  const mountAwaitingOverlays = (): [() => void, () => Promise<void>] => {
    let resolveOverlays!: () => void
    const overlays = new Promise<void>((resolve) => (resolveOverlays = resolve))
    const wrapper = mount(
      defineComponent({
        setup() {
          const layers = useExternalMapMeshLayers()
          onMounted(async () => {
            await overlays
            layers.init(map)
          })
          onUnmounted(layers.destroy)
          return () => h('div')
        },
      })
    )
    const finishOverlays = async (): Promise<void> => {
      resolveOverlays()
      await flushPromises()
    }
    return [() => wrapper.unmount(), finishOverlays]
  }

  beforeEach(() => {
    vi.spyOn(globalThis, 'setInterval')
    vi.spyOn(globalThis, 'clearInterval')
  })

  afterEach(() => liveIntervals().forEach((id) => clearInterval(id as ReturnType<typeof setInterval>)))

  test('draws the meshes once the overlays are ready, and stops when the component unmounts', async () => {
    const [unmount, finishOverlays] = mountAwaitingOverlays()
    expect(meshCanvas()).toBeFalsy()
    await finishOverlays()
    expect(meshCanvas()).toBeTruthy()
    expect(meshAlpha()).toBe(defaultMeshOpacity)
    expect(liveIntervals()).toHaveLength(1)

    unmount()
    expect(meshCanvas()).toBeNull()
    expect(meshAlpha()).toBeUndefined()
    expect(liveIntervals()).toHaveLength(0)
  })
})
