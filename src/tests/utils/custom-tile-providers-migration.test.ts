import { describe, expect, test } from 'vitest'

import type { CustomTileProviderMeta } from '@/types/mission'
import { bluesimReefTileSource, migrateBluesimReefMaxZoom } from '@/utils/custom-tile-providers-migration'

const reefUrl = 'bluesim/tiles/reef/{z}/{x}/{y}.jpg'

const urlProvider = (id: string, urlTemplate: string, maxZoom?: number): CustomTileProviderMeta => ({
  id,
  name: id,
  type: 'url',
  urlTemplate,
  maxZoom,
  attribution: 'BlueSim',
  createdAt: 0,
})

describe('bluesimReefTileSource', () => {
  test('seeds the reef at the zoom BlueSim renders it up to', () => {
    expect(bluesimReefTileSource).toEqual({ urlTemplate: reefUrl, maxZoom: 21 })
  })

  test('a freshly seeded reef provider is left alone by the migration', () => {
    const providers = [urlProvider('reef', bluesimReefTileSource.urlTemplate, bluesimReefTileSource.maxZoom)]
    expect(migrateBluesimReefMaxZoom(providers)).toBe(providers)
  })
})

describe('migrateBluesimReefMaxZoom', () => {
  test.each([22, 23, 24])('caps a reef provider saved at zoom %i to 21, keeping its other fields', (maxZoom) => {
    const reef = { ...urlProvider('reef', reefUrl, maxZoom), brightness: 1.4 }
    expect(migrateBluesimReefMaxZoom([reef])).toEqual([{ ...reef, maxZoom: 21 }])
  })

  test('leaves every other provider untouched', () => {
    const other = urlProvider('other', 'https://tiles.example/{z}/{x}/{y}.png', 22)
    const archive: CustomTileProviderMeta = { id: 'archive', name: 'archive', type: 'file', maxZoom: 22, createdAt: 0 }
    const migrated = migrateBluesimReefMaxZoom([other, urlProvider('reef', reefUrl, 22), archive])
    expect(migrated[0]).toBe(other)
    expect(migrated[2]).toBe(archive)
    expect(migrated[1].maxZoom).toBe(21)
  })

  test.each([21, 18, undefined])('leaves a reef provider saved at zoom %s alone', (maxZoom) => {
    const providers = [urlProvider('reef', reefUrl, maxZoom)]
    expect(migrateBluesimReefMaxZoom(providers)).toBe(providers)
  })

  test('is idempotent', () => {
    const once = migrateBluesimReefMaxZoom([urlProvider('reef', reefUrl, 22)])
    expect(migrateBluesimReefMaxZoom(once)).toBe(once)
  })
})
