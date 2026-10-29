// Spike instrumentation for benchmarking the map meshes, read from the console as `window.__cockpitMapMeshStats`.

/**
 * Drawing statistics of one map
 */
export interface MapMeshMapStats {
  /**
   * Whether the map is shown, and so draws the meshes
   */
  shown: boolean
  /**
   * Full redraws so far
   */
  redraws: number
  /**
   * Main-thread milliseconds of every full redraw
   */
  redrawMsSum: number
  /**
   * Longest full redraw, in main-thread milliseconds
   */
  redrawMsMax: number
  /**
   * Last full redraw, in main-thread milliseconds
   */
  redrawMsLast: number
}

let cpuByteSize = (): number => 0

/**
 * Counters of the map mesh pipeline, from receiving commands to drawing them
 */
export const mapMeshStats = {
  messagesApplied: 0,
  quadsWritten: 0,
  parseMsSum: 0,
  parseMsMax: 0,
  applyMsSum: 0,
  applyMsMax: 0,
  uploads: 0,
  uploadBytes: 0,
  uploadMsSum: 0,
  drawCalls: 0,
  maps: {} as Record<string, MapMeshMapStats>,
  get shownMaps(): number {
    return Object.values(this.maps).filter((map) => map.shown).length
  },
  get hiddenMaps(): number {
    return Object.values(this.maps).filter((map) => !map.shown).length
  },
  gpuRenderer: '',
  maxTextureSize: 0,
  unsupported: false,
  // With `cockpit-debug-map-mesh-timing`, redraw times wait for the GPU to finish.
  finishTiming: false,
  get cpuBytes(): number {
    return cpuByteSize()
  },
  gpuBytes: 0,
}

/**
 * Sets where {@link mapMeshStats} reads the meshes' CPU memory from
 * @param {() => number} source - Returns the bytes held on the CPU
 */
export const setMapMeshCpuByteSize = (source: () => number): void => {
  cpuByteSize = source
}

/**
 * Records a duration into a sum and a maximum of {@link mapMeshStats}
 * @param {'parse' | 'apply'} name - Which duration
 * @param {number} ms - The duration, in milliseconds
 */
export const recordMapMeshMs = (name: 'parse' | 'apply', ms: number): void => {
  mapMeshStats[`${name}MsSum`] += ms
  mapMeshStats[`${name}MsMax`] = Math.max(mapMeshStats[`${name}MsMax`], ms)
}

declare global {
  /**
   * Window with the map mesh spike's statistics
   */
  interface Window {
    /**
     * Statistics of the map mesh pipeline
     */
    __cockpitMapMeshStats?: typeof mapMeshStats
  }
}

window.__cockpitMapMeshStats = mapMeshStats
