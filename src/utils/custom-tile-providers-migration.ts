/**
 * Tiles BlueSim ships of its reef level, seeded as a custom provider for simulated vehicles. They are rendered
 * up to `maxZoom`, and Leaflet upscales them past it.
 */
export const bluesimReefTileSource = { urlTemplate: 'bluesim/tiles/reef/{z}/{x}/{y}.jpg', maxZoom: 21 }
