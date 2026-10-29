import { describe, expect, test, vi } from 'vitest'

import {
  type MapMesh,
  type MapMeshPage,
  latToMercatorY,
  lonToMercatorX,
  MapMeshStore,
} from '@/libs/map/external-map-meshes'
import {
  fadeLowAlpha,
  MapMeshGlRenderer,
  mapMeshGlRenderer,
  meshMixWeight,
  mixReadings,
} from '@/libs/map/external-map-meshes-gl'
import { mapMeshStats } from '@/libs/map/external-map-meshes-stats'

type GlCall = [string, unknown[]]

// A context recording every call, where constants are their own names and uniform locations the uniforms' names.
const recordingGl = (): [WebGL2RenderingContext, GlCall[]] => {
  const calls: GlCall[] = []
  const results: Record<string, unknown> = {
    getProgramParameter: true,
    isContextLost: false,
    getParameter: 0,
    getExtension: null,
  }
  const gl = new Proxy(
    {},
    {
      get: (_, name) => {
        if (/^[A-Z0-9_]+$/.test(String(name))) return name
        return (...args: unknown[]) => {
          calls.push([String(name), args])
          if (name === 'getUniformLocation') return args[1]
          return String(name) in results ? results[String(name)] : {}
        }
      },
    }
  )
  return [gl as unknown as WebGL2RenderingContext, calls]
}

const fragmentSource = (calls: GlCall[]): string => String(calls.filter(([name]) => name === 'shaderSource')[1][1][1])

// Renders a ring of 6 quads written 5 then 3, so it wraps, with every quad in view.
const renderWrappedRing = (): GlCall[] => {
  const store = new MapMeshStore()
  const texels = { format: 'r8', width: 1024, height: 1024 } as const
  store.set({ id: 'scan', name: 'Scan', capacity: 6, texels, filter: 'nearest', opacity: 1 })
  const quad = [-48.55, -27.59, -48.5499, -27.59, -48.5499, -27.5901, -48.55, -27.5901]
  const write = (count: number): void => {
    const corners = new Float64Array(count * 8).map((_, i) => quad[i % 8])
    store.writeQuads('scan', {
      corners,
      uv: new Float32Array(count * 8),
      texels: new Uint8Array(count * 1024 * 1024),
    })
  }
  write(5)
  write(3)
  const [gl, calls] = recordingGl()
  const renderer = new MapMeshGlRenderer(document.createElement('canvas'), gl, store)
  const originX = lonToMercatorX(-48.55) - 100
  const originY = latToMercatorY(-27.59) + 100
  const mesh = store.meshes.get('scan') as MapMesh
  expect(renderer.render(mesh, { width: 400, height: 400, originX, originY, metresPerPixel: 1 }, 0.5)).toBe(true)
  return calls
}

describe('MapMeshGlRenderer', () => {
  test('outputs premultiplied color after the palette, tint and fade, discarding nothing', () => {
    const [gl, calls] = recordingGl()
    new MapMeshGlRenderer(document.createElement('canvas'), gl, new MapMeshStore())
    const fragment = fragmentSource(calls)
    expect(fragment).not.toContain('discard')
    const tinted = fragment.indexOf('straight *= quadTint;')
    expect(tinted).toBeGreaterThan(0)
    const faded = fragment.indexOf('float alpha = a > 0.0 ? mix(a * a, 1.0, clamp(lowAlphaFade, 0.0, 1.0)) : 0.0;')
    expect(faded).toBeGreaterThan(tinted)
    expect(fragment.indexOf('color = vec4(straight.rgb * alpha, alpha);')).toBeGreaterThan(faded)
  })

  test("draws a wrapped ring oldest to newest, across pages, with the map's fade, first exactly then mixed", () => {
    const calls = renderWrappedRing()
    expect(calls).toContainEqual(['uniform1f', ['lowAlphaFade', 0.5]])
    expect(calls).toContainEqual(['clearStencil', [0]])

    // Pages hold 4 slots: slots 2 and 3 of the first page, 4 and 5 of the second, then 0 and 1 of the first.
    const ranges = [
      ['uniform2f', ['pageSize', 2048, 2048]],
      ['uniform1i', ['firstSlot', 2]],
      ['drawArraysInstanced', ['TRIANGLE_STRIP', 0, 4, 2]],
      ['uniform2f', ['pageSize', 2048, 1024]],
      ['uniform1i', ['firstSlot', 0]],
      ['drawArraysInstanced', ['TRIANGLE_STRIP', 0, 4, 2]],
      ['uniform2f', ['pageSize', 2048, 2048]],
      ['uniform1i', ['firstSlot', 0]],
      ['drawArraysInstanced', ['TRIANGLE_STRIP', 0, 4, 2]],
    ]
    const state = ['enable', 'disable', 'stencilFunc', 'stencilOp', 'blendColor', 'blendFunc', 'drawArraysInstanced']
    const drawn = calls.filter(
      ([name, args]) => state.includes(name) || ['pageSize', 'firstSlot'].includes(String(args[0]))
    )
    expect(drawn).toEqual([
      ['disable', ['BLEND']],
      ['enable', ['STENCIL_TEST']],
      ['stencilFunc', ['EQUAL', 0, 0xff]],
      ['stencilOp', ['KEEP', 'KEEP', 'INCR']],
      ...ranges,
      ['enable', ['BLEND']],
      ['blendColor', [0, 0, 0, meshMixWeight]],
      ['blendFunc', ['CONSTANT_ALPHA', 'ONE_MINUS_CONSTANT_ALPHA']],
      ['stencilFunc', ['EQUAL', 1, 0xff]],
      ['stencilOp', ['KEEP', 'KEEP', 'KEEP']],
      ...ranges,
    ])
  })

  test('mixes newer quads into older ones instead of compositing them over', () => {
    const calls = renderWrappedRing()
    const overComposited = calls.some(
      ([name, args]) => name.startsWith('blendFunc') && args.includes('ONE') && args.includes('ONE_MINUS_SRC_ALPHA')
    )
    expect(overComposited).toBe(false)
    const draws = calls.flatMap(([name], index) => (name === 'drawArraysInstanced' ? [index] : []))
    const blending = calls.findIndex(([name, args]) => name === 'enable' && args[0] === 'BLEND')
    expect(calls.findIndex(([name, args]) => name === 'disable' && args[0] === 'BLEND')).toBeLessThan(draws[0])
    expect(blending).toBeGreaterThan(draws[2])
  })
})

describe('MapMeshGlRenderer releasing meshes', () => {
  const view = {
    width: 4,
    height: 4,
    originX: lonToMercatorX(-48.55) - 20,
    originY: latToMercatorY(-27.59) + 20,
    metresPerPixel: 10,
  }

  // A store with one quad in each of the meshes, all of them drawn, so the renderer holds a GPU copy of each.
  const drawnMeshes = (ids: string[]): [MapMeshStore, MapMeshGlRenderer, GlCall[]] => {
    const store = new MapMeshStore()
    for (const id of ids) {
      store.set({
        id,
        name: id,
        capacity: 2,
        texels: { format: 'r8', width: 1, height: 1 },
        filter: 'nearest',
        opacity: 1,
      })
      const corners = Float64Array.of(-48.55, -27.59, -48.5499, -27.59, -48.5499, -27.5901, -48.55, -27.5901)
      store.writeQuads(id, { corners, uv: new Float32Array(8), texels: new Uint8Array(1) })
    }
    const [gl, calls] = recordingGl()
    const renderer = new MapMeshGlRenderer(document.createElement('canvas'), gl, store)
    for (const id of ids) expect(renderer.render(store.meshes.get(id) as MapMesh, view, 1)).toBe(true)
    return [store, renderer, calls]
  }

  const deleted = (calls: GlCall[]): unknown[] =>
    calls.filter(([name]) => name === 'deleteTexture' || name === 'deleteBuffer').map(([, args]) => args[0])
  const canvasBytes = (renderer: MapMeshGlRenderer): number => renderer.canvas.width * renderer.canvas.height * 4

  test('frees the GPU copy of the last mesh as soon as it is removed, with nothing left to draw', () => {
    const [store, renderer, calls] = drawnMeshes(['scan'])
    expect(deleted(calls)).toHaveLength(0)
    expect(mapMeshStats.gpuBytes).toBeGreaterThan(canvasBytes(renderer))
    store.remove('scan')
    // Its palette and page textures, and its page's instance buffer.
    expect(deleted(calls)).toHaveLength(3)
    expect(mapMeshStats.gpuBytes).toBe(canvasBytes(renderer))
  })

  test('frees the GPU copy of the last mesh as soon as it is cleared, keeping the mesh', () => {
    const [store, renderer, calls] = drawnMeshes(['scan'])
    store.clear('scan')
    expect(deleted(calls)).toHaveLength(3)
    expect(mapMeshStats.gpuBytes).toBe(canvasBytes(renderer))
    expect(store.has('scan')).toBe(true)
  })

  test('frees only the removed mesh, and keeps drawing the others from their own GPU copies', () => {
    const [store, renderer, calls] = drawnMeshes(['scan', 'survey'])
    const bytesOfBoth = mapMeshStats.gpuBytes
    store.remove('scan')
    const freed = deleted(calls)
    expect(freed).toHaveLength(3)
    expect(mapMeshStats.gpuBytes).toBeLessThan(bytesOfBoth)
    expect(mapMeshStats.gpuBytes).toBeGreaterThan(canvasBytes(renderer))

    const drawnFrom = calls.length
    expect(renderer.render(store.meshes.get('survey') as MapMesh, view, 1)).toBe(true)
    const bound = calls
      .slice(drawnFrom)
      .filter(([name]) => name === 'bindTexture' || name === 'bindBuffer')
      .map(([, args]) => args[1])
    expect(bound.length).toBeGreaterThan(0)
    expect(bound.filter((object) => freed.includes(object))).toEqual([])
    expect(deleted(calls)).toHaveLength(3)
  })

  const ids = (count: number): string[] => Array.from({ length: count }, (_, i) => `mesh-${i}`)

  const uploaded = (calls: GlCall[]): unknown[] =>
    calls.flatMap(([name, args]) => (name === 'bufferSubData' ? [args[2]] : name === 'texSubImage2D' ? [args[8]] : []))

  test('flushes only the mesh written during a frame drawing many, uploading nothing of the others', () => {
    const [store, renderer, calls] = drawnMeshes(ids(8))
    const drawn = [...store.meshes.values()]
    // The store hands its flushes these wrappers, while the frame draws the meshes themselves, so only flushes count.
    const visited = new Set<string>()
    for (const mesh of drawn) {
      store.meshes.set(
        mesh.id,
        new Proxy(mesh, { get: (target, key) => (visited.add(mesh.id), Reflect.get(target, key)) })
      )
    }
    const frame = (): number =>
      drawn.reduce((visits, mesh) => {
        visited.clear()
        renderer.render(mesh, view, 1)
        return visits + visited.size
      }, 0)

    const corners = Float64Array.of(-48.55, -27.59, -48.5499, -27.59, -48.5499, -27.5901, -48.55, -27.5901)
    store.writeQuads('mesh-3', { first: 1, corners, uv: new Float32Array(8), texels: Uint8Array.of(9) })
    let from = calls.length
    expect(frame()).toBe(1)
    const page = drawn[3].pages[0] as MapMeshPage
    const data = uploaded(calls.slice(from))
    expect(data).toHaveLength(2)
    expect(data[0]).toBe(page.instances)
    expect(data[1]).toBe(page.texels)

    from = calls.length
    expect(frame()).toBe(0)
    expect(uploaded(calls.slice(from))).toEqual([])
  })

  // Entries walked in the renderer's own maps of GPU meshes and of GPU pages.
  const walkedGpuEntries = <T>(action: () => T): [T, number] => {
    const forEach = Map.prototype.forEach
    let walked = 0
    Map.prototype.forEach = function (
      this: Map<unknown, unknown>,
      callback: (value: unknown, key: unknown, map: Map<unknown, unknown>) => void,
      thisArg?: unknown
    ): void {
      const first = this.values().next().value as Record<string, unknown> | undefined
      if (first && ('bytes' in first || first.pages instanceof Map)) walked += this.size
      forEach.call(this, callback, thisArg)
    }
    try {
      return [action(), walked]
    } finally {
      Map.prototype.forEach = forEach
    }
  }

  const expectedGpuBytes = (store: MapMeshStore, renderer: MapMeshGlRenderer): number =>
    [...store.meshes.values()].reduce(
      (bytes, mesh) =>
        mesh.pages.reduce(
          (sum, page) => sum + (page ? page.instances.byteLength + page.texels.byteLength : 0),
          bytes + 1024
        ),
      canvasBytes(renderer)
    )

  test('keeps the GPU byte total of many meshes as they upload and go, without walking all of them each time', () => {
    const count = 16
    const [[store, renderer], uploading] = walkedGpuEntries(() => drawnMeshes(ids(count)))
    expect(mapMeshStats.gpuBytes).toBe(expectedGpuBytes(store, renderer))
    expect(mapMeshStats.gpuBytes).toBe(canvasBytes(renderer) + count * (2 * 68 + 2 + 1024))

    const [, removingHalf] = walkedGpuEntries(() => ids(count / 2).forEach((id) => store.remove(id)))
    expect(mapMeshStats.gpuBytes).toBe(expectedGpuBytes(store, renderer))
    const [, removingRest] = walkedGpuEntries(() => [...store.meshes.keys()].forEach((id) => store.remove(id)))
    expect(mapMeshStats.gpuBytes).toBe(canvasBytes(renderer))

    // Walking every GPU mesh on each upload and release would visit 272 entries while uploading and 256 while
    // removing.
    expect(uploading).toBeLessThanOrEqual(count)
    expect(removingHalf + removingRest).toBeLessThanOrEqual(count)
  })

  test('counts the GPU bytes from nothing again when the context is restored, as every mesh uploads again', () => {
    const [store, renderer, calls] = drawnMeshes(['scan', 'survey'])
    const bytes = mapMeshStats.gpuBytes
    renderer.canvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(mapMeshStats.gpuBytes).toBe(canvasBytes(renderer))
    const from = calls.length
    for (const id of ['scan', 'survey']) expect(renderer.render(store.meshes.get(id) as MapMesh, view, 1)).toBe(true)
    expect(mapMeshStats.gpuBytes).toBe(bytes)
    expect(calls.slice(from).filter(([name]) => name === 'bufferSubData')).toHaveLength(2)
  })

  test('counts a GPU palette once per mesh, whatever its pages, and nothing once the meshes are released', () => {
    const store = new MapMeshStore()
    const renderer = new MapMeshGlRenderer(document.createElement('canvas'), recordingGl()[0], store)
    // 4 strips of 1024x1024 texels fill a page, so 8 quads written make 2 pages.
    store.set({
      id: 'paged',
      name: 'paged',
      capacity: 8,
      texels: { format: 'r8', width: 1024, height: 1024 },
      filter: 'nearest',
      opacity: 1,
    })
    const quad = [-48.55, -27.59, -48.5499, -27.59, -48.5499, -27.5901, -48.55, -27.5901]
    const corners = Float64Array.from({ length: 8 * 8 }, (_, i) => quad[i % 8])
    store.writeQuads('paged', { corners, uv: new Float32Array(8 * 8), texels: new Uint8Array(8 * 1024 * 1024) })
    store.flush(renderer)
    const pages = (store.meshes.get('paged') as MapMesh).pages.filter((page) => page !== undefined) as MapMeshPage[]
    expect(pages).toHaveLength(2)
    const pageBytes = pages.reduce((sum, page) => sum + page.instances.byteLength + page.texels.byteLength, 0)
    expect(mapMeshStats.gpuBytes).toBe(canvasBytes(renderer) + pageBytes + 1024)

    // Never written, so its GPU copy is only its palette.
    store.set({
      id: 'palette-only',
      name: 'palette-only',
      capacity: 2,
      texels: { format: 'r8', width: 1, height: 1 },
      filter: 'nearest',
      opacity: 1,
    })
    store.flush(renderer)
    expect(mapMeshStats.gpuBytes).toBe(canvasBytes(renderer) + pageBytes + 2 * 1024)

    store.remove('paged')
    expect(mapMeshStats.gpuBytes).toBe(canvasBytes(renderer) + 1024)
    store.remove('palette-only')
    expect(mapMeshStats.gpuBytes).toBe(canvasBytes(renderer))
  })

  // The store's own bookkeeping, private, read as is rather than through a test-only API.
  const pending = (store: MapMeshStore, kind: 'dirty' | 'released' | 'onGpu'): Set<string> => Reflect.get(store, kind)
  const gpuMeshes = (renderer: MapMeshGlRenderer): Map<string, unknown> => Reflect.get(renderer, 'meshes')
  const quad = (): Float64Array =>
    Float64Array.of(-48.55, -27.59, -48.5499, -27.59, -48.5499, -27.5901, -48.55, -27.5901)
  const tinyMesh = (id: string): Parameters<MapMeshStore['set']>[0] => ({
    id,
    name: id,
    capacity: 2,
    texels: { format: 'r8', width: 1, height: 1 },
    filter: 'nearest',
    opacity: 1,
  })

  test('keeps nothing of 10,000 meshes defined and removed with no frame drawn in between or after', () => {
    const store = new MapMeshStore()
    const renderer = new MapMeshGlRenderer(document.createElement('canvas'), recordingGl()[0], store)
    let maxDirty = 0
    for (const id of ids(10000)) {
      store.set(tinyMesh(id))
      store.remove(id)
      maxDirty = Math.max(maxDirty, pending(store, 'dirty').size)
    }
    expect({
      maxDirty,
      dirty: pending(store, 'dirty').size,
      released: pending(store, 'released').size,
      meshes: store.meshes.size,
      gpuMeshes: gpuMeshes(renderer).size,
    }).toEqual({ maxDirty: 0, dirty: 0, released: 0, meshes: 0, gpuMeshes: 0 })
  })

  const churn = (store: MapMeshStore): void => {
    for (const id of ids(10000)) {
      store.set(tinyMesh(id))
      store.remove(id)
    }
  }

  test('keeps nothing of 10,000 meshes defined and removed with no renderer, as without WebGL2', () => {
    const store = new MapMeshStore()
    churn(store)
    expect({
      dirty: pending(store, 'dirty').size,
      released: pending(store, 'released').size,
      meshes: store.meshes.size,
    }).toEqual({ dirty: 0, released: 0, meshes: 0 })
  })

  test('gives a renderer created after that churn nothing to free, and draws and frees a mesh defined before it', () => {
    const store = new MapMeshStore()
    churn(store)
    store.set(tinyMesh('scan'))
    store.writeQuads('scan', { corners: quad(), uv: new Float32Array(8), texels: Uint8Array.of(7) })
    const [gl, calls] = recordingGl()
    const renderer = new MapMeshGlRenderer(document.createElement('canvas'), gl, store)
    const releaseMesh = vi.spyOn(renderer, 'releaseMesh')
    expect(pending(store, 'released').size).toBe(0)

    const mesh = store.meshes.get('scan') as MapMesh
    expect(renderer.render(mesh, view, 1)).toBe(true)
    const page = mesh.pages[0] as MapMeshPage
    expect(uploaded(calls)).toEqual([mesh.palette, page.instances, page.texels])
    expect(releaseMesh).not.toHaveBeenCalled()
    expect(deleted(calls)).toHaveLength(0)

    store.remove('scan')
    expect(releaseMesh.mock.calls).toEqual([['scan']])
    expect(deleted(calls)).toHaveLength(3)
    expect(gpuMeshes(renderer).size).toBe(0)
    expect(pending(store, 'released').size).toBe(0)
  })

  test('frees the GPU copy of drawn meshes removed, cleared or laid out anew, and queues none for one never drawn', () => {
    const [store, renderer, calls] = drawnMeshes(['removed', 'cleared', 'redefined'])
    store.remove('removed')
    expect(deleted(calls)).toHaveLength(3)
    store.clear('cleared')
    expect(deleted(calls)).toHaveLength(6)
    store.set({ ...tinyMesh('redefined'), capacity: 4 })
    expect(deleted(calls)).toHaveLength(9)
    expect(gpuMeshes(renderer).size).toBe(0)

    const releaseMesh = vi.spyOn(renderer, 'releaseMesh')
    store.set(tinyMesh('undrawn'))
    store.clear('undrawn')
    store.remove('undrawn')
    expect(releaseMesh).not.toHaveBeenCalled()
    expect(pending(store, 'released').size).toBe(0)
    expect(deleted(calls)).toHaveLength(9)
  })

  test('tells the maps a mesh is gone only once it is no longer pending an upload', () => {
    const [store] = drawnMeshes(['scan'])
    store.writeQuads('scan', { first: 1, corners: quad(), uv: new Float32Array(8), texels: Uint8Array.of(9) })
    expect(pending(store, 'dirty').has('scan')).toBe(true)
    const dirtyWhenTold: boolean[] = []
    store.subscribe(({ id }) => dirtyWhenTold.push(pending(store, 'dirty').has(id)))
    store.remove('scan')
    expect(dirtyWhenTold).toEqual([false])
  })

  test('uploads and draws a mesh removed and defined again under its id, from a new GPU copy', () => {
    const [store, renderer, calls] = drawnMeshes(['scan'])
    store.writeQuads('scan', { first: 1, corners: quad(), uv: new Float32Array(8), texels: Uint8Array.of(9) })
    store.remove('scan')
    const freed = deleted(calls)
    expect(freed).toHaveLength(3)
    expect(gpuMeshes(renderer).size).toBe(0)
    expect(mapMeshStats.gpuBytes).toBe(canvasBytes(renderer))

    store.set(tinyMesh('scan'))
    store.writeQuads('scan', { corners: quad(), uv: new Float32Array(8), texels: Uint8Array.of(7) })
    const from = calls.length
    expect(renderer.render(store.meshes.get('scan') as MapMesh, view, 1)).toBe(true)
    const mesh = store.meshes.get('scan') as MapMesh
    const page = mesh.pages[0] as MapMeshPage
    expect(uploaded(calls.slice(from))).toEqual([mesh.palette, page.instances, page.texels])
    const bound = calls
      .slice(from)
      .filter(([name]) => name === 'bindTexture' || name === 'bindBuffer')
      .map(([, args]) => args[1])
    expect(bound.filter((object) => freed.includes(object))).toEqual([])
    expect(gpuMeshes(renderer).size).toBe(1)
    expect(mapMeshStats.gpuBytes).toBe(expectedGpuBytes(store, renderer))
    expect(pending(store, 'dirty').size).toBe(0)
    expect(pending(store, 'released').size).toBe(0)
    expect(deleted(calls)).toHaveLength(3)
  })

  test('marks no id as on the GPU once 5,000 drawn meshes are removed, cleared or laid out anew', () => {
    const [store, renderer] = drawnMeshes(ids(5000))
    expect(pending(store, 'onGpu').size).toBe(5000)
    ids(5000).forEach((id) => store.remove(id))
    expect(pending(store, 'onGpu').size).toBe(0)
    expect(gpuMeshes(renderer).size).toBe(0)

    const [changed] = drawnMeshes(['cleared', 'redefined'])
    changed.clear('cleared')
    changed.set({ ...tinyMesh('redefined'), capacity: 4 })
    expect(pending(changed, 'onGpu').size).toBe(0)
  })

  test('frees the GPU copy an upload that threw left half made, once the mesh is removed', () => {
    const store = new MapMeshStore()
    store.set(tinyMesh('scan'))
    store.writeQuads('scan', { corners: quad(), uv: new Float32Array(8), texels: Uint8Array.of(7) })
    const [gl, calls] = recordingGl()
    const renderer = new MapMeshGlRenderer(document.createElement('canvas'), gl, store)
    vi.spyOn(renderer, 'uploadPage').mockImplementationOnce(() => {
      throw new Error('Context lost.')
    })
    const releaseMesh = vi.spyOn(renderer, 'releaseMesh')
    expect(() => renderer.render(store.meshes.get('scan') as MapMesh, view, 1)).toThrow('Context lost.')
    expect(gpuMeshes(renderer).has('scan')).toBe(true)

    store.remove('scan')
    expect(releaseMesh.mock.calls).toEqual([['scan']])
    // Only its palette texture was made before the upload threw.
    expect(deleted(calls)).toHaveLength(1)
    expect(gpuMeshes(renderer).size).toBe(0)
    expect(pending(store, 'onGpu').size).toBe(0)
  })
})

describe('mapMeshGlRenderer', () => {
  test('asks for a stencil buffer', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(mapMeshGlRenderer(new MapMeshStore())).toBeUndefined()
    expect(getContext).toHaveBeenCalledWith('webgl2', expect.objectContaining({ stencil: true }))
    getContext.mockRestore()
  })
})

describe('mixReadings', () => {
  const echo: [number, number, number, number] = [0.2, 0.4, 0.6, 0.8]
  const empty: [number, number, number, number] = [0, 0, 0, 0]

  test('draws identical readings exactly like one', () => {
    for (const count of [2, 3, 10, 100]) expect(mixReadings(Array(count).fill(echo))).toEqual(echo)
  })

  test('draws the first reading over an empty pixel exactly', () => {
    expect(mixReadings([echo])).toEqual(echo)
    expect(mixReadings([])).toEqual(empty)
  })

  test('leaves less than 7% of a strong echo after three empty readings', () => {
    const [, , , alpha] = mixReadings([[1, 1, 1, 1], empty, empty, empty])
    expect(alpha).toBeLessThan(0.07)
    expect(alpha).toBeCloseTo(0.4 ** 3, 12)
  })

  test('weighs the newer of two readings more', () => {
    const older: [number, number, number, number] = [1, 0, 0, 1]
    const newer: [number, number, number, number] = [0, 0, 0.25, 0.5]
    mixReadings([older, newer]).forEach((value, i) => expect(value).toBeCloseTo(0.4 * older[i] + 0.6 * newer[i], 12))
  })
})

const fades = [0, 0.25, 0.5, 1]
const steps = Array.from({ length: 21 }, (_, index) => index / 20)

describe('fadeLowAlpha', () => {
  const faintest = 1 / 255

  test('keeps empty texels empty and opaque texels opaque at any fade', () => {
    for (const fade of fades) {
      expect(fadeLowAlpha(0, fade)).toBe(0)
      expect(fadeLowAlpha(1, fade)).toBe(1)
    }
  })

  test('hides the faintest texel at a fade of 0, draws it at the fade in between and opaque at 1', () => {
    expect(fadeLowAlpha(faintest, 0)).toBeLessThan(0.5 / 255)
    expect(fadeLowAlpha(faintest, 0.5)).toBeCloseTo(0.5, 4)
    expect(fadeLowAlpha(faintest, 1)).toBe(1)
  })

  test('draws every texel with any alpha opaque at a fade of 1', () => {
    for (const alpha of steps.slice(1)) expect(fadeLowAlpha(alpha, 1)).toBe(1)
  })

  test('squares the alpha at a fade of 0, and matches known values', () => {
    for (const alpha of steps) expect(fadeLowAlpha(alpha, 0)).toBeCloseTo(alpha * alpha, 12)
    expect(fadeLowAlpha(0.5, 0)).toBe(0.25)
    expect(fadeLowAlpha(0.5, 0.5)).toBe(0.625)
    expect(fadeLowAlpha(0.5, 1)).toBe(1)
  })

  test('grows with the alpha and with the fade', () => {
    for (const fade of fades) {
      const faded = steps.map((alpha) => fadeLowAlpha(alpha, fade))
      expect(faded[1]).toBeGreaterThan(faded[0])
      faded.slice(2).forEach((value, index) => {
        if (fade < 1) expect(value).toBeGreaterThan(faded[index + 1])
        else expect(value).toBe(faded[index + 1])
      })
    }
    for (const alpha of steps) {
      const faded = steps.map((fade) => fadeLowAlpha(alpha, fade))
      faded.slice(1).forEach((value, index) => expect(value).toBeGreaterThanOrEqual(faded[index]))
    }
  })

  test('clamps the alpha and the fade to between 0 and 1', () => {
    expect(fadeLowAlpha(-0.5, 0.5)).toBe(0)
    expect(fadeLowAlpha(1.5, 0.5)).toBe(1)
    expect(fadeLowAlpha(0.5, -1)).toBe(fadeLowAlpha(0.5, 0))
    expect(fadeLowAlpha(0.5, 2)).toBe(fadeLowAlpha(0.5, 1))
  })
})
