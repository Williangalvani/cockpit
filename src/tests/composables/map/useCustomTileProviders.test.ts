import L from 'leaflet'
import { afterEach, expect, test, vi } from 'vitest'
import { reactive } from 'vue'

import type { CustomTileProviderMeta } from '@/types/mission'

const reef: CustomTileProviderMeta = {
  id: 'reef',
  name: 'BlueSim reef',
  type: 'url',
  createdAt: 0,
  maxZoom: 22,
  urlTemplate: 'bluesim/tiles/reef/{z}/{x}/{y}.jpg',
} as CustomTileProviderMeta

const missionStore = reactive({
  customTileProviders: [reef],
  defaultMapTileProvider: 'Use last selected',
  userLastCustomMapProviderId: 'reef' as string | null,
})

vi.mock('@/stores/mission', () => ({ useMissionStore: () => missionStore }))
vi.mock('@/composables/map/useCustomTileProviderLayer', () => ({
  customTileProviderSignature: (meta: CustomTileProviderMeta) => `${meta.id} ${meta.maxZoom}`,
  useCustomTileProviderLayer: () => ({
    createLayer: (meta: CustomTileProviderMeta) => ({
      layer: L.tileLayer(meta.urlTemplate!, { maxZoom: meta.maxZoom }),
    }),
  }),
}))

const { useCustomTileProviders } = await import('@/composables/map/useCustomTileProviders')

let map: L.Map | undefined
afterEach(() => {
  map?.remove()
})

test('restoring the last custom provider keeps a zoom beyond the overlays still on the map', () => {
  const builtIn = L.tileLayer('builtin/{z}/{x}/{y}.png', { maxZoom: 23 })
  const seamarks = L.tileLayer('seamarks/{z}/{x}/{y}.png', { maxZoom: 18 })
  const container = document.createElement('div')
  document.body.appendChild(container)
  map = L.map(container, { layers: [builtIn, seamarks] }).setView([33.81, -118.39], 20)
  expect(map.getZoom()).toBe(20)

  useCustomTileProviders().init(map, L.control.layers(), [builtIn], () => builtIn)

  expect(map.hasLayer(builtIn)).toBe(false)
  expect(map.getZoom()).toBe(20)
})
