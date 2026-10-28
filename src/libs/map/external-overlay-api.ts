import { z } from 'zod'

/**
 * Id external software gives a map overlay, so it can replace or remove it later. Every sender shares the same
 * ids, so prefix it with the sender's name (e.g. `simple-ping-survey-contours`) to keep two extensions from
 * replacing each other's overlays.
 */
export const externalMapOverlayIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, digits and single dashes.')

// Longitude first, as GeoJSON writes it, with an optional altitude.
const positionSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)], z.number())
const ringSchema = z.array(positionSchema).min(4)

const geometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: positionSchema }),
  z.object({ type: z.literal('MultiPoint'), coordinates: z.array(positionSchema) }),
  z.object({ type: z.literal('LineString'), coordinates: z.array(positionSchema).min(2) }),
  z.object({ type: z.literal('MultiLineString'), coordinates: z.array(z.array(positionSchema).min(2)) }),
  z.object({ type: z.literal('Polygon'), coordinates: z.array(ringSchema) }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(ringSchema)) }),
])

/**
 * GeoJSON feature of an external map overlay, styled by its simplestyle-spec properties
 */
export const externalMapOverlayFeatureSchema = z.object({
  type: z.literal('Feature'),
  geometry: geometrySchema,
  properties: z.record(z.string(), z.unknown()).nullable().default(null),
})

/**
 * Map overlay external software sends to be shown on Cockpit's maps
 */
export const externalMapOverlaySchema = z.object({
  id: externalMapOverlayIdSchema,
  name: z.string().min(1),
  live: z.boolean().default(false),
  geojson: z.object({
    type: z.literal('FeatureCollection'),
    features: z.array(externalMapOverlayFeatureSchema),
  }),
})

/**
 * GeoTIFF overlay external software asks Cockpit to download and show on its maps
 */
export const externalMapGeoTiffSchema = z.object({
  id: externalMapOverlayIdSchema,
  name: z.string().min(1),
  url: z.string().regex(/^https?:\/\//, 'Use an http or https URL.'),
  renderMode: z.enum(['grayscale', 'intensity', 'bathymetry']).default('grayscale'),
})

const maxMeshCapacity = 1 << 20
const maxMeshWriteQuads = 4096
// Larger messages make base64 decoding and validation a long task on the main thread.
const maxMeshMessageBytes = 2 * 1024 * 1024
// WebGL2's guaranteed MAX_TEXTURE_SIZE, so every strip fits a texture page on every device.
const maxStripSide = 2048
// Guards the GPU: a million quads spanning the screen at high zoom would be a million full-screen fills.
const maxQuadDiagonalMetres = 20_000
const maxMeshLatitude = 85.05
const paletteBytes = 256 * 4
const metresPerDegree = (Math.PI / 180) * 6378137

type TypedArrayConstructor = Float64ArrayConstructor | Float32ArrayConstructor | Uint8ArrayConstructor

// Typed arrays arrive as-is through postMessage, and as base64 of their little-endian bytes through WebSocket JSON,
// since validating a JSON array of a million numbers element by element takes hundreds of milliseconds.
const typedArrayOrBase64 = <T extends TypedArrayConstructor>(
  TypedArray: T
): z.ZodType<InstanceType<T>, InstanceType<T> | string> =>
  z.union([
    z.instanceof(TypedArray),
    z
      .base64()
      .max(Math.ceil(maxMeshMessageBytes / 3) * 4)
      .transform((base64, context) => {
        const binary = atob(base64)
        if (binary.length % TypedArray.BYTES_PER_ELEMENT !== 0) {
          context.addIssue({ code: 'custom', message: `Needs a multiple of ${TypedArray.BYTES_PER_ELEMENT} bytes.` })
          return z.NEVER
        }
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        return new TypedArray(bytes.buffer) as InstanceType<T>
      }),
  ])

const paletteSchema = typedArrayOrBase64(Uint8Array).refine((palette) => palette.length === paletteBytes, {
  message: `A palette has 256 RGBA entries, ${paletteBytes} bytes.`,
})

/**
 * Mesh of textured quads external software draws on Cockpit's maps, such as a sonar's pings. It has `capacity`
 * slots the sender writes quads into, each quad carrying its own `width` x `height` strip of texels. Unlike the
 * GeoJSON overlays, a mesh is kept in memory only: the sender re-sends it to a Cockpit that connects later.
 */
export const externalMapMeshSchema = z
  .object({
    id: externalMapOverlayIdSchema,
    name: z.string().min(1),
    capacity: z.number().int().min(1).max(maxMeshCapacity),
    texels: z.object({
      format: z.enum(['r8', 'rgba8']),
      width: z.number().int().min(1).max(maxStripSide),
      height: z.number().int().min(1).max(maxStripSide),
    }),
    filter: z.enum(['nearest', 'linear']).default('nearest'),
    // 256 RGBA entries, straight alpha, that r8 texels index into. Defaults to an opaque grey ramp.
    palette: paletteSchema.optional(),
    opacity: z.number().min(0).max(1).default(1),
  })
  .refine((mesh) => mesh.palette === undefined || mesh.texels.format === 'r8', {
    message: 'Only r8 meshes have a palette.',
    path: ['palette'],
  })

const meshQuadsShape = {
  id: externalMapOverlayIdSchema,
  // Omitted to write after the previous write, wrapping around at the mesh's capacity.
  first: z.number().int().min(0).optional(),
  // Longitude and latitude of each quad's four corners, in ring order: 8 per quad.
  corners: typedArrayOrBase64(Float64Array),
  // Texel coordinates of each corner inside the quad's own strip, texel centres at +0.5: 8 per quad.
  uv: typedArrayOrBase64(Float32Array),
  // Each quad's strip, row by row: width * height * bytes per texel per quad.
  texels: typedArrayOrBase64(Uint8Array),
  // RGBA, straight alpha, multiplied into each quad's colour: 4 per quad.
  tint: typedArrayOrBase64(Uint8Array).optional(),
}

type MeshQuads = z.output<z.ZodObject<typeof meshQuadsShape>>

const cornerProblem = (corners: Float64Array, quad: number): string | undefined => {
  const at = quad * 8
  for (let corner = 0; corner < 4; corner++) {
    const lon = corners[at + corner * 2]
    const lat = corners[at + corner * 2 + 1]
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return 'has a corner that is not a finite number'
    if (Math.abs(lon) > 180) return 'has a longitude outside [-180, 180]'
    if (Math.abs(lat) > maxMeshLatitude) return `has a latitude beyond ±${maxMeshLatitude}`
  }
  const latitudeScale = Math.cos(((corners[at + 1] + corners[at + 5]) / 2) * (Math.PI / 180))
  for (const [a, b] of [
    [0, 2],
    [1, 3],
  ]) {
    const east = (corners[at + b * 2] - corners[at + a * 2]) * latitudeScale
    const north = corners[at + b * 2 + 1] - corners[at + a * 2 + 1]
    if (Math.hypot(east, north) * metresPerDegree > maxQuadDiagonalMetres) {
      return `is more than ${maxQuadDiagonalMetres / 1000} km across`
    }
  }
  return undefined
}

// One pass over every quad, reporting only the first problem, so a malformed write costs no more than a valid one.
const validateMeshQuads = (quads: MeshQuads, context: z.core.$RefinementCtx<MeshQuads>): void => {
  const count = quads.corners.length / 8
  const issue = (path: string, message: string): void => context.addIssue({ code: 'custom', path: [path], message })
  if (!Number.isInteger(count) || count < 1) return issue('corners', 'Needs 8 numbers, 4 lon/lat pairs, per quad.')
  if (count > maxMeshWriteQuads) return issue('corners', `A message writes at most ${maxMeshWriteQuads} quads.`)
  if (quads.uv.length !== count * 8) return issue('uv', `Needs 8 numbers per quad, ${count * 8} for ${count} quads.`)
  if (quads.tint && quads.tint.length !== count * 4) return issue('tint', `Needs 4 bytes per quad, ${count * 4}.`)
  const bytes = quads.corners.byteLength + quads.uv.byteLength + quads.texels.byteLength + (quads.tint?.byteLength ?? 0)
  if (bytes > maxMeshMessageBytes) return issue('texels', `A message carries at most ${maxMeshMessageBytes} bytes.`)
  for (let quad = 0; quad < count; quad++) {
    const problem = cornerProblem(quads.corners, quad)
    if (problem) return issue('corners', `Quad ${quad} ${problem}.`)
    for (let i = quad * 8; i < quad * 8 + 8; i++) {
      if (!Number.isFinite(quads.uv[i])) return issue('uv', `Quad ${quad} has a uv that is not a finite number.`)
    }
  }
}

/**
 * Commands external software (embedded iframes, WebSocket servers) can send to manage map overlays.
 */
export const externalMapOverlayCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('cockpit:setMapOverlay'), overlay: externalMapOverlaySchema }),
  z.object({
    type: z.literal('cockpit:appendMapOverlayFeatures'),
    id: externalMapOverlayIdSchema,
    features: z.array(externalMapOverlayFeatureSchema).min(1),
  }),
  z.object({ type: z.literal('cockpit:clearMapOverlay'), id: externalMapOverlayIdSchema }),
  z.object({ type: z.literal('cockpit:setMapGeoTiff'), geoTiff: externalMapGeoTiffSchema }),
  z.object({ type: z.literal('cockpit:removeMapOverlay'), id: externalMapOverlayIdSchema }),
  z.object({ type: z.literal('cockpit:setMapMesh'), mesh: externalMapMeshSchema }),
  z.object({ type: z.literal('cockpit:setMapMeshQuads'), ...meshQuadsShape }).superRefine(validateMeshQuads),
  z.object({
    type: z.literal('cockpit:removeMapMeshQuads'),
    id: externalMapOverlayIdSchema,
    first: z.number().int().min(0),
    count: z.number().int().min(1),
  }),
  z.object({ type: z.literal('cockpit:clearMapMesh'), id: externalMapOverlayIdSchema }),
  z.object({ type: z.literal('cockpit:removeMapMesh'), id: externalMapOverlayIdSchema }),
  z.object({ type: z.literal('cockpit:setMapMeshPalette'), id: externalMapOverlayIdSchema, palette: paletteSchema }),
])

/**
 * A validated map overlay command from external software
 */
export type ExternalMapOverlayCommand = z.output<typeof externalMapOverlayCommandSchema>

/**
 * Map overlay as external software sends it
 */
export type ExternalMapOverlay = z.input<typeof externalMapOverlaySchema>

/**
 * GeoTIFF overlay as external software sends it
 */
export type ExternalMapGeoTiff = z.input<typeof externalMapGeoTiffSchema>

/**
 * A validated GeoTIFF overlay from external software
 */
export type ValidatedMapGeoTiff = z.output<typeof externalMapGeoTiffSchema>

/**
 * A validated GeoJSON feature of an external map overlay
 */
export type ExternalMapOverlayFeature = z.output<typeof externalMapOverlayFeatureSchema>

/**
 * Map mesh as external software sends it
 */
export type ExternalMapMesh = z.input<typeof externalMapMeshSchema>

/**
 * A validated map mesh from external software
 */
export type ValidatedMapMesh = z.output<typeof externalMapMeshSchema>

/**
 * Quads external software writes into a map mesh, as it sends them
 */
export type ExternalMapMeshQuads = Omit<z.input<z.ZodObject<typeof meshQuadsShape>>, 'id'>

/**
 * Validated quads written into a map mesh
 */
export type ValidatedMapMeshQuads = Omit<MeshQuads, 'id'>

/**
 * Tells whether a message is meant as a map overlay command, before validating it.
 * @param {unknown} message - Message received from external software
 * @returns {boolean} Whether the message carries one of the map overlay command types
 */
export const isExternalMapOverlayCommand = (message: unknown): boolean => {
  if (typeof message !== 'object' || message === null || !('type' in message)) return false
  return externalMapOverlayCommandSchema.options.some((option) => option.shape.type.value === message.type)
}
