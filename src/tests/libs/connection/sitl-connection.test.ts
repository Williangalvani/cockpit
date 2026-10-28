import { expect, test, vi } from 'vitest'

import { getSitlHome, isRecentIsolationReload, parseSitlHome } from '@/libs/connection/sitl-connection'

// The codec's WebAssembly package does not load under Node
vi.mock('@/libs/connection/raw-mavlink-codec', () => ({ RawMavlinkCodec: vi.fn() }))

test('isRecentIsolationReload', () => {
  const reloadedAt = 1_800_000_000_000
  // The page that reload opened
  expect(isRecentIsolationReload(String(reloadedAt), reloadedAt + 300)).toBe(true)
  expect(isRecentIsolationReload(String(reloadedAt), reloadedAt + 2000)).toBe(true)
  expect(isRecentIsolationReload(String(reloadedAt), reloadedAt - 1000)).toBe(true)
  // A hard reload later on, handed the session storage of the page before the isolation reload
  expect(isRecentIsolationReload(String(reloadedAt), reloadedAt + 2001)).toBe(false)
  // A hard reload a few seconds later
  expect(isRecentIsolationReload(String(reloadedAt), reloadedAt + 4000)).toBe(false)
  // A page that started before the reload was stored, like one restored from the back/forward cache
  expect(isRecentIsolationReload(String(reloadedAt), reloadedAt - 1001)).toBe(false)
  // Missing, or the boolean guard from an older Cockpit
  expect(isRecentIsolationReload(null, reloadedAt)).toBe(false)
  expect(isRecentIsolationReload('true', reloadedAt)).toBe(false)
  expect(isRecentIsolationReload('', reloadedAt)).toBe(false)
})

test('parseSitlHome', () => {
  expect(parseSitlHome('33.810313,-118.393867,0,270')).toEqual({ lat: 33.810313, lon: -118.393867 })
  expect(parseSitlHome('-27.598524,-48.459752')).toEqual({ lat: -27.598524, lon: -48.459752 })
  expect(parseSitlHome('33.8')).toBe(null)
  expect(parseSitlHome(',-118.39,0,0')).toBe(null)
  expect(parseSitlHome('north,east')).toBe(null)
  expect(parseSitlHome('91,0,0,0')).toBe(null)
  expect(parseSitlHome('0,181,0,0')).toBe(null)
  expect(parseSitlHome('')).toBe(null)
})

test('getSitlHome is null without a sitl:// connection', () => {
  expect(getSitlHome()).toBe(null)
})
