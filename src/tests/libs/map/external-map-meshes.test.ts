import L from 'leaflet'
import { describe, expect, it } from 'vitest'

import type { ValidatedMapMesh, ValidatedMapMeshQuads } from '@/libs/map/external-map-mesh-api'
import {
  type MapMesh,
  type MapMeshChange,
  type MapMeshPage,
  type MapMeshRenderer,
  type MercatorPoint,
  latToMercatorY,
  lonToMercatorX,
  MapMeshStore,
  meshDrawRanges,
  meshInstanceBytes,
  stripPlace,
} from '@/libs/map/external-map-meshes'

const definition = (overrides: Partial<ValidatedMapMesh> = {}): ValidatedMapMesh => ({
  id: 'test-mesh',
  name: 'Test',
  capacity: 8,
  texels: { format: 'r8', width: 2, height: 1 },
  filter: 'nearest',
  opacity: 1,
  ...overrides,
})

// `count` quads of about 10 m side, side by side eastwards, each strip filled with its quad's index plus `value`.
const quads = (count: number, first?: number, value = 0, stripBytes = 2): ValidatedMapMeshQuads => {
  const corners = new Float64Array(count * 8)
  for (let i = 0; i < count; i++) {
    const lon = -48.55 + i * 0.0001
    corners.set([lon, -27.59, lon + 0.0001, -27.59, lon + 0.0001, -27.5901, lon, -27.5901], i * 8)
  }
  const texels = new Uint8Array(count * stripBytes)
  for (let i = 0; i < count; i++) texels.fill(i + value, i * stripBytes, (i + 1) * stripBytes)
  return { first, corners, uv: new Float32Array(count * 8).fill(0.5), texels }
}

const meshOf = (store: MapMeshStore): MapMesh => store.meshes.get('test-mesh') as MapMesh

const slotTexels = (mesh: MapMesh, slot: number): number[] => {
  const { page, x, y } = stripPlace(mesh, slot)
  const data = mesh.pages[page] as MapMeshPage
  const at = (y * data.width + x) * mesh.bytesPerTexel
  return [...data.texels.subarray(at, at + mesh.stripWidth * mesh.bytesPerTexel)]
}

const slotCorners = (mesh: MapMesh, slot: number): number[] => {
  const page = mesh.pages[stripPlace(mesh, slot).page] as MapMeshPage
  const at = ((slot - page.firstSlot) * meshInstanceBytes) / 4
  return [...page.instanceFloats.subarray(at, at + 8)]
}

describe('MapMeshStore', () => {
  it('keeps the quads when a mesh is set again with the same layout, and empties it otherwise', () => {
    const store = new MapMeshStore()
    store.set(definition())
    store.writeQuads('test-mesh', quads(3))
    store.set(definition({ name: 'Renamed', opacity: 0.5, filter: 'linear' }))
    expect(meshOf(store)).toMatchObject({ name: 'Renamed', opacity: 0.5, filter: 'linear', highWater: 3 })
    expect(slotTexels(meshOf(store), 2)).toEqual([2, 2])

    store.set(definition({ capacity: 16 }))
    expect(meshOf(store)).toMatchObject({ capacity: 16, head: 0, highWater: 0 })
    expect(meshOf(store).pages.filter(Boolean)).toHaveLength(0)
  })

  it('writes after the previous write without `first`, wrapping around at the capacity', () => {
    const store = new MapMeshStore()
    store.set(definition({ capacity: 4 }))
    store.writeQuads('test-mesh', quads(3))
    store.writeQuads('test-mesh', quads(2, undefined, 10))
    const mesh = meshOf(store)
    expect(slotTexels(mesh, 3)).toEqual([10, 10])
    expect(slotTexels(mesh, 0)).toEqual([11, 11])
    expect(slotTexels(mesh, 1)).toEqual([1, 1])
    expect(mesh).toMatchObject({ head: 1, highWater: 4 })
  })

  it('writes at an explicit `first`, and writes nothing when the quads do not fit', () => {
    const store = new MapMeshStore()
    store.set(definition())
    store.writeQuads('test-mesh', quads(2, 5, 20))
    const mesh = meshOf(store)
    expect(slotTexels(mesh, 5)).toEqual([20, 20])
    expect(slotTexels(mesh, 6)).toEqual([21, 21])
    expect(mesh).toMatchObject({ head: 7, highWater: 7 })

    expect(() => store.writeQuads('test-mesh', quads(2, 7, 30))).toThrow('do not fit')
    expect(slotTexels(mesh, 7)).toEqual([0, 0])
    expect(mesh).toMatchObject({ head: 7, highWater: 7 })
  })

  it('rejects texels that do not match the strip size', () => {
    const store = new MapMeshStore()
    store.set(definition())
    expect(() => store.writeQuads('test-mesh', quads(2, 0, 0, 3))).toThrow('texel bytes per quad')
    expect(meshOf(store).highWater).toBe(0)
  })

  it('empties removed slots into degenerate quads, reporting where they were', () => {
    const store = new MapMeshStore()
    store.set(definition())
    store.writeQuads('test-mesh', quads(4))
    const changes: MapMeshChange[] = []
    store.subscribe((change) => changes.push(change))
    store.removeQuads('test-mesh', 1, 2)
    const mesh = meshOf(store)
    expect(slotCorners(mesh, 1)).toEqual(Array(8).fill(0))
    expect(slotCorners(mesh, 2)).toEqual(Array(8).fill(0))
    expect(slotCorners(mesh, 3)).not.toEqual(Array(8).fill(0))
    expect(changes[0].bounds?.minX).toBeCloseTo(lonToMercatorX(-48.5499), 3)
    expect(changes[0].bounds?.maxX).toBeCloseTo(lonToMercatorX(-48.5497), 3)
  })

  it('reports a rewritten slot where its old quad was as well as where the new one is', () => {
    const store = new MapMeshStore()
    store.set(definition())
    store.writeQuads('test-mesh', quads(1, 0))
    const changes: MapMeshChange[] = []
    store.subscribe((change) => changes.push(change))
    const moved = quads(1, 0)
    moved.corners.forEach((value, i) => i % 2 === 0 && (moved.corners[i] = value + 0.01))
    store.writeQuads('test-mesh', moved)
    expect(changes[0].bounds?.minX).toBeCloseTo(lonToMercatorX(-48.55), 3)
    expect(changes[0].bounds?.maxX).toBeCloseTo(lonToMercatorX(-48.5399), 3)
  })

  it('draws a wrapped ring from the head to the high-water mark, then from the start to the head', () => {
    const store = new MapMeshStore()
    store.set(definition({ capacity: 6 }))
    store.writeQuads('test-mesh', quads(5))
    store.writeQuads('test-mesh', quads(3))
    const ranges = meshDrawRanges(meshOf(store)).map(({ first, count }) => [first, count])
    expect(ranges).toEqual([
      [2, 4],
      [0, 2],
    ])
  })

  it('places strips in pages of 2048 texels, splitting draws at page boundaries', () => {
    const store = new MapMeshStore()
    store.set(definition({ capacity: 50_000, texels: { format: 'r8', width: 200, height: 1 } }))
    const mesh = meshOf(store)
    expect(mesh.stripsPerRow).toBe(10)
    expect(mesh.slotsPerPage).toBe(20480)
    expect(mesh.pages).toHaveLength(3)
    expect(stripPlace(mesh, 20481)).toEqual({ page: 1, x: 200, y: 0 })
    expect(stripPlace(mesh, 15)).toEqual({ page: 0, x: 1000, y: 1 })

    store.writeQuads('test-mesh', quads(4, 20478, 0, 200))
    expect(slotTexels(mesh, 20480).slice(0, 3)).toEqual([2, 2, 2])
    // Slots below the write were never written, but sit before the head, so they are drawn, as degenerate quads.
    const ranges = meshDrawRanges(mesh).map(({ page, first, count }) => [page.index, first, count])
    expect(ranges).toEqual([
      [0, 0, 20480],
      [1, 0, 2],
    ])
    // The last page only holds the slots left over, so it is no larger than they need.
    store.writeQuads('test-mesh', quads(1, 49_999, 0, 200))
    expect(mesh.pages[2]).toMatchObject({ slotCount: 50_000 - 40960, width: 2000, height: 904 })
  })

  it('copies what it is sent rather than keeping the arrays', () => {
    const store = new MapMeshStore()
    store.set(definition())
    const sent = quads(1, 0, 7)
    store.writeQuads('test-mesh', sent)
    const corners = slotCorners(meshOf(store), 0)
    sent.corners.fill(0)
    sent.texels.fill(99)
    expect(slotCorners(meshOf(store), 0)).toEqual(corners)
    expect(slotTexels(meshOf(store), 0)).toEqual([7, 7])
  })

  it('hands a renderer only what changed since the last flush', () => {
    const uploads: [number, [number, number] | undefined][] = []
    const released: string[] = []
    const renderer: MapMeshRenderer = {
      releaseMesh: (id) => released.push(id),
      uploadSettings: () => undefined,
      uploadPage: (_mesh, page) => uploads.push([page.index, page.dirtySlots]),
    }
    const store = new MapMeshStore()
    store.set(definition())
    store.writeQuads('test-mesh', quads(2, 3))
    store.flush(renderer)
    expect(uploads).toEqual([[0, [3, 5]]])
    store.flush(renderer)
    expect(uploads).toHaveLength(1)
    store.remove('test-mesh')
    store.flush(renderer)
    expect(released).toEqual(['test-mesh'])
  })

  it('projects like Leaflet, keeping corners within a millimetre 10 km from the anchor', () => {
    const lat = -27.59
    const lon = -48.55
    const projected = L.Projection.SphericalMercator.project(L.latLng(lat, lon))
    expect(lonToMercatorX(lon)).toBeCloseTo(projected.x, 6)
    expect(latToMercatorY(lat)).toBeCloseTo(projected.y, 6)

    const store = new MapMeshStore()
    store.set(definition({ capacity: 1000 }))
    const metresToDegrees = 180 / (Math.PI * 6378137)
    const far = lon + (7_000 * metresToDegrees) / Math.cos((lat * Math.PI) / 180)
    const farLat = lat + 7_000 * metresToDegrees
    store.writeQuads('test-mesh', quads(1, 0))
    // Steps of irregular size, so the far corners do not land on numbers float32 happens to hold exactly.
    const sent = quads(100, 1)
    for (let i = 0; i < 100; i++) {
      const east = far - i * 0.0000123
      const north = farLat - i * 0.0000371
      sent.corners.set([east, north, east + 0.0001, north, east + 0.0001, north - 0.0001, east, north - 0.0001], i * 8)
    }
    store.writeQuads('test-mesh', sent)
    const mesh = meshOf(store)
    const anchor = mesh.anchor as MercatorPoint
    let worst = 0
    for (let i = 0; i < 100; i++) {
      const stored = slotCorners(mesh, i + 1)
      for (let corner = 0; corner < 4; corner++) {
        const x = lonToMercatorX(sent.corners[i * 8 + corner * 2])
        const y = latToMercatorY(sent.corners[i * 8 + corner * 2 + 1])
        const scale = Math.cos((sent.corners[i * 8 + corner * 2 + 1] * Math.PI) / 180)
        const error = Math.hypot(stored[corner * 2] + anchor.x - x, stored[corner * 2 + 1] + anchor.y - y) * scale
        worst = Math.max(worst, error)
      }
    }
    expect(worst).toBeGreaterThan(0)
    expect(worst).toBeLessThan(0.001)
  })
})
