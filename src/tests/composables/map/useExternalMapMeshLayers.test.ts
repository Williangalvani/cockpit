import L from 'leaflet'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { mapMeshStats } from '@/libs/map/external-map-meshes-stats'

vi.mock('@/composables/snackbar', () => ({ openSnackbar: vi.fn() }))
vi.mock('@/libs/map/external-map-meshes-gl', () => ({ mapMeshGlRenderer: () => undefined }))
vi.mock('@/composables/map/useExternalMapMeshes', () => ({
  useExternalMapMeshes: () => ({ meshes: { meshes: new Map(), subscribe: () => () => undefined } }),
}))

const { defaultMeshOpacity, useExternalMapMeshLayers } = await import('@/composables/map/useExternalMapMeshLayers')

let map: L.Map
const meshCanvas = (): HTMLCanvasElement | null | undefined => map.getPane('externalMeshPane')?.querySelector('canvas')
const meshAlpha = (): number | undefined => Object.values(mapMeshStats.maps)[0]?.mapAlpha

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
