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
 * Creates a mesh of textured quads on Cockpit's maps, for georeferenced imagery sent many times a second. Sending it
 * again with the same capacity and texels keeps its quads. Meshes are kept in memory only, so send it again, and its
 * quads, after Cockpit reloads. Needs WebGL2.
 * @param {ExternalMapMesh} mesh - Id, name, capacity in quads, and the format and size of every quad's strip of
 * texels. An r8 mesh's texels index into its palette. Every sender shares the same ids, so prefix the id with your
 * extension's name
 * @example
 * ```typescript
 * setMapMesh({ id: 'my-extension-scan', name: 'Scan', capacity: 4096, texels: { format: 'r8', width: 200, height: 1 } })
 * ```
 */
export function setMapMesh(mesh: ExternalMapMesh): void {
  window.parent.postMessage({ type: 'cockpit:setMapMesh', mesh }, '*')
}

/**
 * Writes quads into a map mesh, replacing those in their slots. The typed arrays' buffers are transferred to
 * Cockpit, so they are unusable here afterwards.
 * @param {string} id - The id of the mesh
 * @param {ExternalMapMeshQuads} quads - Per quad: 4 lon/lat corners in ring order, 4 uv in texels of the quad's
 * strip, its strip of texels, and an optional RGBA tint. Without `first`, they follow the previous write,
 * wrapping around at the mesh's capacity
 */
export function setMapMeshQuads(id: string, quads: ExternalMapMeshQuads): void {
  const buffers = Object.values(quads).flatMap((value) => (ArrayBuffer.isView(value) ? [value.buffer] : []))
  const transfer = [...new Set(buffers)].filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer)
  window.parent.postMessage({ type: 'cockpit:setMapMeshQuads', id, ...quads }, '*', transfer)
}

/**
 * Empties consecutive slots of a map mesh, which then draw nothing.
 * @param {string} id - The id of the mesh
 * @param {number} first - The first slot
 * @param {number} count - How many slots
 */
export function removeMapMeshQuads(id: string, first: number, count: number): void {
  window.parent.postMessage({ type: 'cockpit:removeMapMeshQuads', id, first, count }, '*')
}

/**
 * Replaces the palette of an r8 map mesh, recolouring it without sending its quads again.
 * @param {string} id - The id of the mesh
 * @param {Uint8Array} palette - 256 RGBA entries, straight alpha
 */
export function setMapMeshPalette(id: string, palette: Uint8Array): void {
  window.parent.postMessage({ type: 'cockpit:setMapMeshPalette', id, palette }, '*')
}

/**
 * Empties every slot of a map mesh, keeping the mesh to be written to again.
 * @param {string} id - The id of the mesh
 */
export function clearMapMesh(id: string): void {
  window.parent.postMessage({ type: 'cockpit:clearMapMesh', id }, '*')
}

/**
 * Removes a map mesh from Cockpit.
 * @param {string} id - The id of the mesh
 */
export function removeMapMesh(id: string): void {
  window.parent.postMessage({ type: 'cockpit:removeMapMesh', id }, '*')
}
