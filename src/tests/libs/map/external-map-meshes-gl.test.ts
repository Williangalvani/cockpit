import { describe, expect, test, vi } from 'vitest'

import { type MapMesh, latToMercatorY, lonToMercatorX, MapMeshStore } from '@/libs/map/external-map-meshes'
import {
  fadeLowAlpha,
  MapMeshGlRenderer,
  mapMeshGlRenderer,
  meshMixWeight,
  mixReadings,
} from '@/libs/map/external-map-meshes-gl'

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
  test('outputs premultiplied colour after the palette, tint and fade, discarding nothing', () => {
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

  test('never composites newer quads over older ones', () => {
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
