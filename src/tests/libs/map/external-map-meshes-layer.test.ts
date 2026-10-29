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
let drawnAlphas: number[]

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
const canvas = (): HTMLCanvasElement => map.getPane('overlayPane')?.querySelector('canvas') as HTMLCanvasElement
const renderedFades = (): number[] => render.mock.calls.map((call) => call[2])

beforeEach(() => {
  frames = []
  drawnAlphas = []
  globalThis.requestAnimationFrame = (frame) => frames.push(frame)
  globalThis.cancelAnimationFrame = vi.fn()
  const context = { clearRect: vi.fn(), drawImage: vi.fn(), globalAlpha: 1 }
  context.drawImage.mockImplementation(() => drawnAlphas.push(context.globalAlpha))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  render = vi.fn(() => true)
  getRenderer = vi.fn(() => ({ canvas: document.createElement('canvas'), render }))
  const container = document.createElement('div')
  document.body.appendChild(container)
  map = L.map(container, { zoomAnimation: false }).setView([-27.59, -48.55], 15)
  vi.spyOn(map, 'getSize').mockReturnValue(L.point(200, 100))
})

afterEach(() => {
  map.remove()
  vi.restoreAllMocks()
})

describe('ExternalMapMeshesLayer map alpha', () => {
  test('draws with an alpha of 1, the default, and shows it in the stats', () => {
    addLayer()
    expect(render).toHaveBeenCalledTimes(1)
    expect(render.mock.calls[0][0]).toBe(mesh)
    expect(renderedFades()).toEqual([1])
    expect(drawnAlphas).toEqual([mesh.opacity])
    expect(canvas().style.opacity).toBe('')
    expect(stats().mapAlpha).toBe(1)
  })

  test('passes the alpha set before the layer was added to the renderer, not to the composite or the canvas', () => {
    addLayer(0.4)
    expect(renderedFades()).toEqual([0.4])
    expect(drawnAlphas).toEqual([mesh.opacity])
    expect(canvas().style.opacity).toBe('')
    expect(stats().mapAlpha).toBe(0.4)
  })

  test('redraws once on the next frame with the new alpha when it changes, and not when it does not', () => {
    addLayer()
    render.mockClear()
    drawnAlphas = []
    layer.setMapAlpha(0.7)
    layer.setMapAlpha(0.5)
    expect(frames).toHaveLength(1)
    expect(render).not.toHaveBeenCalled()
    runFrames()
    expect(renderedFades()).toEqual([0.5])
    expect(drawnAlphas).toEqual([mesh.opacity])
    expect(canvas().style.opacity).toBe('')
    expect(stats().mapAlpha).toBe(0.5)

    layer.setMapAlpha(0.5)
    expect(frames).toHaveLength(0)
  })

  test('keeps drawing the meshes at an alpha of 0', () => {
    addLayer()
    render.mockClear()
    layer.setMapAlpha(0)
    runFrames()
    expect(renderedFades()).toEqual([0])
    expect(canvas().width).toBeGreaterThan(0)
    expect(canvas().style.opacity).toBe('')
    expect(stats().mapAlpha).toBe(0)
  })

  test('clamps the alpha to between 0 and 1, and treats a non-number as 1', () => {
    addLayer(1.5)
    expect(stats().mapAlpha).toBe(1)
    layer.setMapAlpha(-1)
    runFrames()
    expect(stats().mapAlpha).toBe(0)
    layer.setMapAlpha(NaN)
    runFrames()
    expect(stats().mapAlpha).toBe(1)
    expect(renderedFades()).toEqual([1, 0, 1])
    expect(canvas().style.opacity).toBe('')
  })
})
