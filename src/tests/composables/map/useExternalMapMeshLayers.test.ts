import L from 'leaflet'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/composables/snackbar', () => ({ openSnackbar: vi.fn() }))
vi.mock('@/libs/map/external-map-meshes-gl', () => ({ mapMeshGlRenderer: () => undefined }))
vi.mock('@/composables/map/useExternalMapMeshes', () => ({
  useExternalMapMeshes: () => ({ meshes: { meshes: new Map(), subscribe: () => () => undefined } }),
}))

const { defaultMeshOpacity, useExternalMapMeshLayers } = await import('@/composables/map/useExternalMapMeshLayers')

let map: L.Map
const meshCanvas = (): HTMLCanvasElement | null | undefined => map.getPane('externalMeshPane')?.querySelector('canvas')

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
  test('defaults to 50% for the map widgets', () => {
    expect(defaultMeshOpacity).toBe(0.5)
  })

  test('applies an opacity set before init, and keeps it across a destroy and a new init', () => {
    const layers = useExternalMapMeshLayers()
    layers.setMeshOpacity(defaultMeshOpacity)
    layers.init(map)
    expect(meshCanvas()?.style.opacity).toBe('0.5')

    layers.destroy()
    expect(meshCanvas()).toBeNull()
    layers.init(map)
    expect(meshCanvas()?.style.opacity).toBe('0.5')

    layers.setMeshOpacity(0.8)
    expect(meshCanvas()?.style.opacity).toBe('0.8')
    layers.destroy()
  })
})

describe('useExternalMapMeshLayers mesh visibility', () => {
  test('shows the meshes unless told otherwise', () => {
    const layers = useExternalMapMeshLayers()
    layers.init(map)
    expect(meshCanvas()).toBeTruthy()
    layers.destroy()
  })

  test('hides and shows the meshes after init, keeping their opacity', () => {
    const layers = useExternalMapMeshLayers()
    layers.setMeshOpacity(0.3)
    layers.init(map)

    layers.setMeshesShown(false)
    expect(meshCanvas()).toBeNull()

    layers.setMeshesShown(true)
    expect(meshCanvas()?.style.opacity).toBe('0.3')
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
