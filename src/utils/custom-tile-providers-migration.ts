import type { CustomTileProviderMeta } from '@/types/mission'

/**
 * Tiles BlueSim ships of its reef level, seeded as a custom provider for simulated vehicles. They are rendered
 * up to `maxZoom`, and Leaflet upscales them past it.
 */
export const bluesimReefTileSource = { urlTemplate: 'bluesim/tiles/reef/{z}/{x}/{y}.jpg', maxZoom: 21 }

const needsReefMaxZoomCap = (provider: CustomTileProviderMeta): boolean =>
  provider.urlTemplate === bluesimReefTileSource.urlTemplate && (provider.maxZoom ?? 0) > bluesimReefTileSource.maxZoom

/**
 * Caps a BlueSim reef provider seeded when BlueSim still rendered zoom 22, which would otherwise request tiles that
 * no longer exist and draw a blank map there. Every other provider is left untouched.
 * @param {CustomTileProviderMeta[]} providers - The stored custom tile providers
 * @returns {CustomTileProviderMeta[]} The same array when nothing needs migrating, otherwise a migrated copy
 */
export const migrateBluesimReefMaxZoom = (providers: CustomTileProviderMeta[]): CustomTileProviderMeta[] => {
  if (!providers.some(needsReefMaxZoomCap)) return providers
  return providers.map((provider) =>
    needsReefMaxZoomCap(provider) ? { ...provider, maxZoom: bluesimReefTileSource.maxZoom } : provider
  )
}
