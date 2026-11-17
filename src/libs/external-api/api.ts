import type { ExternalMapMesh, ExternalMapMeshQuads } from '@/libs/map/external-map-mesh-api'
import type { ExternalMapGeoTiff, ExternalMapOverlay } from '@/libs/map/external-overlay-api'
import type { ExternalPoi, ExternalPoiUpdate } from '@/libs/poi/external-api'

import { CallbackRateLimiter } from './callback-rate-limiter'

export { mapMeshReservedBytes } from '@/libs/map/external-map-meshes'

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
 * Draws a GeoJSON overlay on Cockpit's maps, replacing any overlay already using its id. Features are styled by
 * their simplestyle-spec properties (`stroke`, `stroke-width`, `stroke-opacity`, `fill`, `fill-opacity`,
 * `marker-color`, `marker-size`). A point with a `radius` property is drawn as a circle of that radius in metres,
 * styled like a polygon. The overlay is saved on the computer running Cockpit, unless `live` is true,
 * which suits data that is re-sent as it changes.
 * @param {ExternalMapOverlay} overlay - The overlay. Every sender shares the same ids, so prefix it with your
 * extension's name
 * @example
 * ```typescript
 * setMapOverlay({
 *   id: 'my-extension-route',
 *   name: 'Route',
 *   geojson: {
 *     type: 'FeatureCollection',
 *     features: [{
 *       type: 'Feature',
 *       properties: { stroke: '#FFFF00' },
 *       geometry: { type: 'LineString', coordinates: [[-48.5585, -27.5935], [-48.5575, -27.5925]] },
 *     }],
 *   },
 * })
 * ```
 */
export function setMapOverlay(overlay: ExternalMapOverlay): void {
  window.parent.postMessage({ type: 'cockpit:setMapOverlay', overlay }, '*')
}

/**
 * Adds features to a map overlay without re-sending the ones it already has, for a track that grows as the
 * vehicle moves.
 * @param {string} id - The id of an overlay already sent with `setMapOverlay`
 * @param {ExternalMapOverlay['geojson']['features']} features - The GeoJSON features to add
 */
export function appendMapOverlayFeatures(id: string, features: ExternalMapOverlay['geojson']['features']): void {
  window.parent.postMessage({ type: 'cockpit:appendMapOverlayFeatures', id, features }, '*')
}

/**
 * Removes every feature from a map overlay, keeping the overlay itself to be appended to again.
 * @param {string} id - The id of the overlay
 */
export function clearMapOverlay(id: string): void {
  window.parent.postMessage({ type: 'cockpit:clearMapOverlay', id }, '*')
}

/**
 * Has Cockpit download a GeoTIFF and show it on its maps, replacing the one already using its id. The file is
 * downloaded once and saved like a GeoTIFF the operator loaded, so send it again to update it. The server must
 * allow Cockpit's origin through CORS.
 * @param {ExternalMapGeoTiff} geoTiff - Id, name, URL and render mode of the overlay. Data-lake inputs in the URL
 * are resolved, so `{{ vehicle-address }}` becomes the address Cockpit reaches the vehicle at
 * @example
 * ```typescript
 * setMapGeoTiff({
 *   id: 'my-extension-depth',
 *   name: 'Depth',
 *   url: 'http://{{ vehicle-address }}:9000/survey/depth.tif',
 *   renderMode: 'bathymetry',
 * })
 * ```
 */
export function setMapGeoTiff(geoTiff: ExternalMapGeoTiff): void {
  window.parent.postMessage({ type: 'cockpit:setMapGeoTiff', geoTiff }, '*')
}

/**
 * Removes a map overlay from Cockpit, GeoJSON or GeoTIFF, including its saved copy.
 * @param {string} id - The id of the overlay
 */
export function removeMapOverlay(id: string): void {
  window.parent.postMessage({ type: 'cockpit:removeMapOverlay', id }, '*')
}

/**
 * Asks Cockpit which map mesh features and limits it supports. It answers with a `cockpit:mapCapabilities` message
 * carrying the same `requestId` and a `meshes` object: `version` of the mesh commands (check that it is the version
 * your code targets; unknown fields may appear in either direction and are ignored), `drawn` (false without WebGL2:
 * meshes are still kept and their commands answered, but nothing is shown), the limits `maxCapacity`,
 * `maxQuadsPerMessage`, `maxMessageBytes`, `maxTexelSide` and `maxStripBytes` (the most texel bytes one untinted strip
 * can have; subtract 4 when sending a tint, and keep a batch within `maxMessageBytes`), `budgetBytes` (the most all
 * meshes together may reserve for their full capacity on this computer, past which `cockpit:setMapMesh` is answered
 * with `code: 'budget'`, `usedBytes`, `previousBytes`, `requestedBytes` and `budgetBytes`) and `usedBytes` (what they
 * reserve now, the same total a refusal reports), and the texel `formats`. Capabilities are a snapshot: another sender
 * can reserve space before your next `setMapMesh`. Size a mesh with `mapMeshReservedBytes`, the formula of version 1.
 * To negotiate a smaller capacity, start from a refusal's `requestedBytes` and `previousBytes` rather than dividing
 * bytes by bytes per strip. If Cockpit never answers, it predates map meshes. Answers to this and to mesh commands
 * arrive as `message` events on this window, in the order their commands were sent. A `requestId` has 1 to 256
 * characters: a query or command with any other is invalid, so it is neither applied nor answered.
 * @param {string} requestId - Echoed back in the answer
 */
export function getMapCapabilities(requestId: string): void {
  window.parent.postMessage({ type: 'cockpit:getMapCapabilities', requestId }, '*')
}

/**
 * Creates a mesh of textured quads on Cockpit's maps, for georeferenced imagery sent many times a second. Sending it
 * again with the same capacity and texels keeps its quads and its head, changing only its name, filter, palette and
 * opacity; the optional ones you omit return to their defaults (`'nearest'` filter, gray ramp palette, opacity 1).
 * Any other layout empties it, while a refused one keeps its quads. To grow a mesh, keep your source data, wait for
 * the set to succeed, then replay oldest first. Meshes are drawn only where WebGL2 is available. A mesh reserves its
 * whole capacity when set, whatever is later written, so ask for no more slots than you will show.
 *
 * Meshes are kept in memory only, so a Cockpit that reloads starts without them, while one whose connection to you
 * dropped keeps them as they were, without what you sent in between. Every sender shares them, so none is removed when
 * a connection closes. On every connection call `getMapCapabilities`, then `setMapMesh`. To replace what it shows, call
 * `clearMapMesh` once that set succeeds (regardless of your slot numbering), then replay the quads you want shown,
 * oldest first, in messages of at most 4096 quads, with an explicit `first` so every Cockpit ends up with the same
 * quads in the same slots. To resume instead, send every write and removal it missed.
 * @param {ExternalMapMesh} mesh - Id, name, capacity in quads, and the format and size of every quad's strip of texels.
 * An r8 mesh's texels index into its palette, 256 straight-alpha RGBA entries, an opaque gray ramp unless given. The
 * palette decides what shows through: give the entries for faint or empty readings zero alpha. Every sender shares the
 * same ids, so prefix the id with your extension's name.
 * `filter: 'linear'` interpolates r8 indices before the palette lookup, so use it only with a continuous ramp.
 * @param {string} [requestId] - When given, Cockpit answers with a `cockpit:mapMeshResult` carrying it and either `ok`
 * with the mesh's `capacity` and `head`, or the `error` it was rejected for
 * @example
 * ```typescript
 * setMapMesh({ id: 'my-extension-scan', name: 'Scan', capacity: 4096, texels: { format: 'r8', width: 200, height: 1 } })
 * ```
 */
export function setMapMesh(mesh: ExternalMapMesh, requestId?: string): void {
  window.parent.postMessage({ type: 'cockpit:setMapMesh', requestId, mesh }, '*')
}

/**
 * Writes quads into a map mesh, replacing those in their slots. A quad is drawn as two triangles split along its corner
 * 1 to corner 3 diagonal, its uv interpolated linearly across each. Its color is its texel's straight (not
 * premultiplied) RGBA, or for r8 its palette entry's, times its tint. Quads are drawn in slot order from the head on:
 * where a quad is the first to cover a pixel its color is drawn as it is, and each later quad mixes into what is there
 * with 60% weight for the newer one, on premultiplied color and alpha. As a result, identical overlapping readings draw
 * as one, while a changed reading (fully transparent texels included) pulls the pixel toward it, and a few later
 * readings all but replace it. With `filter: 'linear'`, r8 indices are interpolated before the palette lookup, so an
 * edge between index 0 and data samples the entries in between, and rgba8 straight colors are interpolated before
 * premultiplying, so a transparent texel's color bleeds into its neighbor's edge: give transparent texels their
 * neighbors' color, or use `'nearest'`, to avoid a dark fringe. The mesh's opacity fades the result once. Each map also
 * has a mesh opacity setting o: a texel of zero alpha is never drawn, and one of alpha a > 0 is drawn with alpha a² +
 * o·(1 − a²), which is a² at o = 0 and opaque at o = 1. Give the lowest alphas to readings the user should be able to
 * hide or show completely, such as silence, and full alpha to whatever should always show. The typed arrays' buffers
 * are transferred to Cockpit, so they are unusable here afterwards.
 * @param {string} id - The id of the mesh
 * @param {ExternalMapMeshQuads} quads - Per quad: 4 longitude/latitude corners in ring order, 4 uv in texels of
 * the quad's strip (texel centers at +0.5, with v counting rows from the first row sent), its strip of texels, row by
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
