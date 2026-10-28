import { describe, expect, it } from 'vitest'

import { type ValidatedMapMeshQuads, externalMapOverlayCommandSchema } from '@/libs/map/external-overlay-api'

type Quads = Pick<ValidatedMapMeshQuads, 'corners' | 'uv' | 'texels'>

const base64 = (view: ArrayBufferView): string => {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  let binary = ''
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)))
  return btoa(binary)
}

// `count` quads of about 10 m side, side by side eastwards from Florianópolis.
const quads = (count: number): Quads => {
  const corners = new Float64Array(count * 8)
  for (let i = 0; i < count; i++) {
    const lon = -48.55 + i * 0.0001
    corners.set([lon, -27.59, lon + 0.0001, -27.59, lon + 0.0001, -27.5901, lon, -27.5901], i * 8)
  }
  return { corners, uv: new Float32Array(count * 8).fill(0.5), texels: new Uint8Array(count) }
}

const parseQuads = (fields: Record<string, unknown>): ReturnType<typeof externalMapOverlayCommandSchema.safeParse> =>
  externalMapOverlayCommandSchema.safeParse({ type: 'cockpit:setMapMeshQuads', id: 'test-mesh', ...fields })

const firstIssue = (result: ReturnType<typeof parseQuads>): string => result.error?.issues[0]?.message ?? ''

describe('cockpit:setMapMesh', () => {
  const mesh = { id: 'test-mesh', name: 'Test', capacity: 16, texels: { format: 'r8', width: 4, height: 1 } }

  it('fills in the defaults', () => {
    const result = externalMapOverlayCommandSchema.parse({ type: 'cockpit:setMapMesh', mesh })
    expect(result).toMatchObject({ mesh: { filter: 'nearest', opacity: 1 } })
  })

  it('accepts a palette as bytes or base64, for r8 only', () => {
    const palette = new Uint8Array(1024)
    expect(
      externalMapOverlayCommandSchema.safeParse({ type: 'cockpit:setMapMesh', mesh: { ...mesh, palette } }).success
    ).toBe(true)
    const encoded = { ...mesh, palette: base64(palette) }
    expect(externalMapOverlayCommandSchema.safeParse({ type: 'cockpit:setMapMesh', mesh: encoded }).success).toBe(true)
    const rgba = { ...mesh, texels: { format: 'rgba8', width: 4, height: 1 }, palette }
    expect(externalMapOverlayCommandSchema.safeParse({ type: 'cockpit:setMapMesh', mesh: rgba }).success).toBe(false)
    const short = { ...mesh, palette: new Uint8Array(1000) }
    expect(externalMapOverlayCommandSchema.safeParse({ type: 'cockpit:setMapMesh', mesh: short }).success).toBe(false)
  })

  it('rejects a capacity or strip beyond the limits', () => {
    const tooMany = { ...mesh, capacity: (1 << 20) + 1 }
    expect(externalMapOverlayCommandSchema.safeParse({ type: 'cockpit:setMapMesh', mesh: tooMany }).success).toBe(false)
    const tooWide = { ...mesh, texels: { format: 'r8', width: 2049, height: 1 } }
    expect(externalMapOverlayCommandSchema.safeParse({ type: 'cockpit:setMapMesh', mesh: tooWide }).success).toBe(false)
  })
})

describe('cockpit:setMapMeshQuads', () => {
  it('accepts typed arrays', () => {
    expect(parseQuads(quads(3)).success).toBe(true)
  })

  it('accepts base64 of the same little-endian bytes, decoding it to typed arrays', () => {
    const { corners, uv, texels } = quads(2)
    const result = parseQuads({ corners: base64(corners), uv: base64(uv), texels: base64(texels), first: 4 })
    expect(result.success).toBe(true)
    const data = result.data as unknown as Quads
    expect(data.corners).toBeInstanceOf(Float64Array)
    expect([...data.corners]).toEqual([...corners])
    expect(data.uv).toBeInstanceOf(Float32Array)
  })

  it('rejects base64 that is not a whole number of elements', () => {
    const { uv, texels } = quads(1)
    expect(parseQuads({ corners: base64(new Uint8Array(60)), uv, texels }).success).toBe(false)
  })

  it('rejects arrays of the wrong type or length', () => {
    const { corners, uv, texels } = quads(2)
    expect(parseQuads({ corners: new Float32Array(corners), uv, texels }).success).toBe(false)
    expect(firstIssue(parseQuads({ corners, uv: uv.subarray(0, 8), texels }))).toContain('8 numbers per quad')
    expect(firstIssue(parseQuads({ corners: corners.subarray(0, 12), uv, texels }))).toContain('8 numbers')
    expect(firstIssue(parseQuads({ corners, uv, texels, tint: new Uint8Array(4) }))).toContain('4 bytes per quad')
  })

  it('reports the first quad with a bad corner', () => {
    const nan = quads(3)
    nan.corners[17] = NaN
    expect(firstIssue(parseQuads(nan))).toBe('Quad 2 has a corner that is not a finite number.')
    const polar = quads(3)
    polar.corners[9] = 86
    expect(firstIssue(parseQuads(polar))).toContain('Quad 1 has a latitude')
    const outside = quads(1)
    outside.corners[0] = 181
    expect(firstIssue(parseQuads(outside))).toContain('longitude')
  })

  it('rejects a quad more than 20 km across', () => {
    const huge = quads(1)
    huge.corners.set([-48.55, -27.59, -48.35, -27.59, -48.35, -27.79, -48.55, -27.79])
    expect(firstIssue(parseQuads(huge))).toContain('20 km')
  })

  it('rejects more than 4096 quads in a message', () => {
    expect(parseQuads(quads(4096)).success).toBe(true)
    expect(firstIssue(parseQuads(quads(4097)))).toContain('4096')
  })

  it('rejects messages over 2 MiB', () => {
    const { corners, uv } = quads(1)
    expect(firstIssue(parseQuads({ corners, uv, texels: new Uint8Array(2 * 1024 * 1024) }))).toContain('bytes')
  })
})
