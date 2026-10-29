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
