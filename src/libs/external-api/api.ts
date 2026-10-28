import type { ExternalMapMesh, ExternalMapMeshQuads } from '@/libs/map/external-map-mesh-api'
import type { ExternalPoi, ExternalPoiUpdate } from '@/libs/poi/external-api'

import { CallbackRateLimiter } from './callback-rate-limiter'

/**
 * Current version of the Cockpit Widget API
 */
export const COCKPIT_WIDGET_API_VERSION = '0.0.0'

/**
 * Listens to updates for a specific datalake variable.
 * This function sets up a message listener that receives updates from the parent window
 * and forwards them to the callback function, respecting the specified rate limit.
 * @param {string} variableId - The name of the datalake variable to listen to
 * @param {Function} callback - The function to call when the variable is updated
 * @param {number} maxRateHz - The maximum rate (in Hz) at which updates should be received. Default is 10 Hz
 * @example
 * ```typescript
 * // Listen to updates at 5Hz
 * listenToDatalakeVariable('cockpit-memory-usage', (value) => {
 *   console.log('Memory Usage:', value);
 * }, 5);
 * ```
 */
export function listenToDatalakeVariable(variableId: string, callback: (data: any) => void, maxRateHz = 10): void {
  // Convert Hz to minimum interval in milliseconds
  const minIntervalMs = 1000 / maxRateHz
  const rateLimiter = new CallbackRateLimiter(minIntervalMs)

  const message = {
    type: 'cockpit:listenToDatalakeVariables',
    variable: variableId,
    maxRateHz: maxRateHz,
  }
  window.parent.postMessage(message, '*')

  window.addEventListener('message', function handler(event) {
    if (event.data.type === 'cockpit:datalakeVariable' && event.data.variable === variableId) {
      // Only call callback if we haven't exceeded the rate limit
      if (rateLimiter.canCall()) {
        callback(event.data.value)
      }
    }
  })
}

/**
 * Adds a point of interest to Cockpit. Ignored, with a warning in Cockpit's logs, if the id is already in use or
 * Cockpit has not finished syncing with the vehicle yet.
 * @param {ExternalPoi} poi - The point of interest. Its id is yours to choose, to update or remove it later
 * @example
 * ```typescript
 * addPointOfInterest({ id: 'target-1', name: 'Target 1', latitude: -27.59, longitude: -48.55, icon: 'mdi-flag' })
 * ```
 */
export function addPointOfInterest(poi: ExternalPoi): void {
  window.parent.postMessage({ type: 'cockpit:addPointOfInterest', poi }, '*')
}

/**
 * Changes the given fields of a point of interest. Latitude and longitude have to be sent together. Every update
 * is saved and synced to the vehicle, so use it for occasional changes rather than to stream a position.
 * @param {ExternalPoiUpdate} poi - The id of the point of interest and the fields to change
 */
export function updatePointOfInterest(poi: ExternalPoiUpdate): void {
  window.parent.postMessage({ type: 'cockpit:updatePointOfInterest', poi }, '*')
}

/**
 * Removes a point of interest from Cockpit.
 * @param {string} id - The id of the point of interest
 */
export function removePointOfInterest(id: string): void {
  window.parent.postMessage({ type: 'cockpit:removePointOfInterest', id }, '*')
}

/**
 * Asks Cockpit what it offers map meshes. It answers with a `cockpit:mapCapabilities` message carrying the same
 * `requestId` and a `meshes` object: `version` of the mesh commands (check it is the one you were written for;
 * fields you do not know may appear and are ignored both ways), `drawn` (false without WebGL2, where meshes are
 * kept and answered but not shown), the limits `maxCapacity`, `maxQuadsPerMessage`, `maxMessageBytes` and
 * `maxTexelSide`, and the texel `formats`. A Cockpit that never answers predates map meshes. Answers to this and
 * to mesh commands arrive as `message` events on this window, in the order their commands were sent.
 * @param {string} requestId - Echoed back in the answer
 */
export function getMapCapabilities(requestId: string): void {
  window.parent.postMessage({ type: 'cockpit:getMapCapabilities', requestId }, '*')
}

/**
 * Creates a mesh of textured quads on Cockpit's maps, for georeferenced imagery sent many times a second. Sending it
 * again with the same capacity and texels keeps its quads and its head, changing only its name, filter, palette and
 * opacity; any other layout empties it. Needs WebGL2.
 *
 * Meshes are kept in memory only, so a Cockpit that reloads or reconnects starts without them. On every connection
 * call `getMapCapabilities`, then `setMapMesh`, then `clearMapMesh` if you restarted your own slot numbering, and
 * replay the quads you want shown, oldest first, in messages of at most 4096 quads, with an explicit `first` so
 * every Cockpit ends up with the same quads in the same slots.
 * @param {ExternalMapMesh} mesh - Id, name, capacity in quads, and the format and size of every quad's strip of
 * texels. An r8 mesh's texels index into its palette, 256 straight-alpha RGBA entries, an opaque grey ramp unless
 * given. What shows through, such as faint or empty readings, is the palette's to decide: give those entries zero
 * alpha. Every sender shares the same ids, so prefix the id with your extension's name.
 * `filter: 'linear'` interpolates r8 indices before the palette lookup, so use it with a continuous ramp only
 * @param {string} [requestId] - When given, Cockpit answers with a `cockpit:mapMeshResult` carrying it, `ok`,
 * the mesh's `capacity` and `head`, or the `error` it was rejected for
 * @example
 * ```typescript
 * setMapMesh({ id: 'my-extension-scan', name: 'Scan', capacity: 4096, texels: { format: 'r8', width: 200, height: 1 } })
 * ```
 */
export function setMapMesh(mesh: ExternalMapMesh, requestId?: string): void {
  window.parent.postMessage({ type: 'cockpit:setMapMesh', requestId, mesh }, '*')
}

/**
 * Writes quads into a map mesh, replacing those in their slots. A quad is drawn as two triangles split along its
 * corner 1 to corner 3 diagonal, its uv interpolated linearly across each. Its colour is its texel's straight
 * (not premultiplied) RGBA, or for r8 its palette entry's, times its tint. Quads are drawn in slot order from the
 * head on: where a quad is the first to cover a pixel its colour is drawn as it is, and each later quad mixes into
 * what is there with 60% weight for the newer one, on premultiplied colour and alpha. Overlapping identical readings
 * so draw like one, while a changed one, fully transparent texels included, pulls the pixel toward it, a few later
 * readings all but replacing it. With `filter: 'linear'`, r8 indices are interpolated before the palette lookup, so
 * an edge between index 0 and data samples the entries in between, and rgba8 straight colours are interpolated
 * before premultiplying, so a transparent texel's colour bleeds into its neighbour's edge: give transparent texels
 * their neighbours' colour, or use `'nearest'`, to avoid a dark fringe. The mesh's opacity fades the result once.
 * The typed arrays' buffers are transferred to Cockpit, so they are unusable here afterwards.
 * @param {string} id - The id of the mesh
 * @param {ExternalMapMeshQuads} quads - Per quad: 4 longitude/latitude corners in ring order, 4 uv in texels of
 * the quad's strip (texel centres at +0.5, v counting rows from the first one sent), its strip of texels, row by
 * row, and an optional RGBA tint. Without `first`, they follow the previous write, wrapping around at the mesh's
 * capacity
 * @param {string} [requestId] - When given, Cockpit answers with a `cockpit:mapMeshResult` carrying it, the
 * `first` slot and `count` written and the `head` the next write without `first` starts at, so you know which
 * slots to remove later
 */
export function setMapMeshQuads(id: string, quads: ExternalMapMeshQuads, requestId?: string): void {
  const buffers = Object.values(quads).flatMap((value) => (ArrayBuffer.isView(value) ? [value.buffer] : []))
  const transfer = [...new Set(buffers)].filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer)
  window.parent.postMessage({ type: 'cockpit:setMapMeshQuads', requestId, id, ...quads }, '*', transfer)
}

/**
 * Empties consecutive slots of a map mesh, which then draw nothing.
 * @param {string} id - The id of the mesh
 * @param {number} first - The first slot
 * @param {number} count - How many slots
 * @param {string} [requestId] - When given, Cockpit answers with a `cockpit:mapMeshResult` carrying it
 */
export function removeMapMeshQuads(id: string, first: number, count: number, requestId?: string): void {
  window.parent.postMessage({ type: 'cockpit:removeMapMeshQuads', requestId, id, first, count }, '*')
}

/**
 * Replaces the palette of an r8 map mesh, recolouring it without sending its quads again.
 * @param {string} id - The id of the mesh
 * @param {Uint8Array} palette - 256 RGBA entries, straight alpha
 * @param {string} [requestId] - When given, Cockpit answers with a `cockpit:mapMeshResult` carrying it
 */
export function setMapMeshPalette(id: string, palette: Uint8Array, requestId?: string): void {
  window.parent.postMessage({ type: 'cockpit:setMapMeshPalette', requestId, id, palette }, '*')
}

/**
 * Empties every slot of a map mesh, keeping the mesh to be written to again from slot 0.
 * @param {string} id - The id of the mesh
 * @param {string} [requestId] - When given, Cockpit answers with a `cockpit:mapMeshResult` carrying it
 */
export function clearMapMesh(id: string, requestId?: string): void {
  window.parent.postMessage({ type: 'cockpit:clearMapMesh', requestId, id }, '*')
}

/**
 * Removes a map mesh from Cockpit.
 * @param {string} id - The id of the mesh
 * @param {string} [requestId] - When given, Cockpit answers with a `cockpit:mapMeshResult` carrying it
 */
export function removeMapMesh(id: string, requestId?: string): void {
  window.parent.postMessage({ type: 'cockpit:removeMapMesh', requestId, id }, '*')
}
