import L from 'leaflet'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { MapMesh, MapMeshStore } from '@/libs/map/external-map-meshes'
import type { MapMeshGlRenderer } from '@/libs/map/external-map-meshes-gl'
import { ExternalMapMeshesLayer } from '@/libs/map/external-map-meshes-layer'
import { mapMeshStats } from '@/libs/map/external-map-meshes-stats'

const mesh = { id: 'survey', highWater: 1, opacity: 0.5 } as MapMesh
const store = { meshes: new Map([[mesh.id, mesh]]), subscribe: () => () => undefined } as unknown as MapMeshStore

let frames: FrameRequestCallback[] = []
const runFrames = (): void => {
  const pending = frames
  frames = []
  pending.forEach((frame) => frame(0))
}

let map: L.Map
let layer: ExternalMapMeshesLayer
let render: ReturnType<typeof vi.fn>
let getRenderer: ReturnType<typeof vi.fn>

const addLayer = (alpha?: number): void => {
  layer = new ExternalMapMeshesLayer({
    store,
    renderer: getRenderer as unknown as () => MapMeshGlRenderer,
    isShown: () => true,
    onUnsupported: vi.fn(),
    pane: 'overlayPane',
  })
  if (alpha !== undefined) layer.setMapAlpha(alpha)
  map.addLayer(layer)
  runFrames()
}

const stats = (): (typeof mapMeshStats.maps)[string] => Object.values(mapMeshStats.maps)[0]

beforeEach(() => {
  frames = []
  globalThis.requestAnimationFrame = (frame) => frames.push(frame)
  globalThis.cancelAnimationFrame = vi.fn()
  const context = { clearRect: vi.fn(), drawImage: vi.fn(), globalAlpha: 1 }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  render = vi.fn(() => true)
  getRenderer = vi.fn(() => ({ canvas: document.createElement('canvas'), render }))
  const container = document.createElement('div')
  document.body.appendChild(container)
  map = L.map(container, { zoomAnimation: false }).setView([-27.59, -48.55], 15)
})

afterEach(() => {
  map.remove()
  vi.restoreAllMocks()
})

describe('ExternalMapMeshesLayer map alpha', () => {
  test('draws with an alpha of 1 by default, and shows it in the stats', () => {
    addLayer()
    expect(render).toHaveBeenCalledTimes(1)
    expect(render.mock.calls[0][0]).toBe(mesh)
    expect(render.mock.calls[0][2]).toBe(1)
    expect(stats().mapAlpha).toBe(1)
  })

  test('hands the renderer the alpha set before the layer was added', () => {
    addLayer(0.4)
    expect(render.mock.calls[0][2]).toBe(0.4)
    expect(stats().mapAlpha).toBe(0.4)
  })

  test('redraws once on the next frame when the alpha changes, and not when it does not', () => {
    addLayer()
    render.mockClear()
    layer.setMapAlpha(0.7)
    layer.setMapAlpha(0.5)
    expect(frames).toHaveLength(1)
    expect(render).not.toHaveBeenCalled()
    runFrames()
    expect(render).toHaveBeenCalledTimes(1)
    expect(render.mock.calls[0][2]).toBe(0.5)
    expect(stats().mapAlpha).toBe(0.5)

    layer.setMapAlpha(0.5)
    expect(frames).toHaveLength(0)
  })

  test('draws no meshes at an alpha of 0, without asking for the renderer', () => {
    addLayer()
    render.mockClear()
    getRenderer.mockClear()
    layer.setMapAlpha(0)
    runFrames()
    expect(render).not.toHaveBeenCalled()
    expect(getRenderer).not.toHaveBeenCalled()
    expect(stats().mapAlpha).toBe(0)
  })

  test('clamps the alpha to between 0 and 1, and treats a non-number as 1', () => {
    addLayer(1.5)
    expect(stats().mapAlpha).toBe(1)
    layer.setMapAlpha(-1)
    expect(stats().mapAlpha).toBe(0)
    layer.setMapAlpha(NaN)
    expect(stats().mapAlpha).toBe(1)
  })
})
