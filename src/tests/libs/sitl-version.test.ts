import { expect, test } from 'vitest'

import { appSitlVersion, compareSitlVersions, versionedSimulatorUrl } from '@/libs/sitl-version'

const app = { sitl: 'aaaaaaaaaaaa', bluesim: 'bbbbbbbbbbbb', build: '2026-10-01T00:00:00.000Z' }
const deployed = { sitl: 'cccccccccccc', bluesim: 'bbbbbbbbbbbb', build: '2026-10-27T00:00:00.000Z' }

test('compareSitlVersions', () => {
  expect(compareSitlVersions(app, { ...app }, null)).toBe('current')
  expect(compareSitlVersions(app, deployed, null)).toBe('stale')
  // A deploy that left the SITL files alone still makes this copy old
  expect(compareSitlVersions(app, { ...app, build: deployed.build }, null)).toBe('stale')
  // Reloaded once to this build already, so it must not reload again
  expect(compareSitlVersions(app, deployed, deployed.build)).toBe('still-stale')
  // A reload to an earlier deploy does not hold back the reload to a later one
  expect(compareSitlVersions(app, deployed, app.build)).toBe('stale')
})

test('versionedSimulatorUrl', () => {
  const versioned = new URL(versionedSimulatorUrl('bluesim/index.html?level=reef', 'tab-1'))
  expect(versioned.searchParams.get('level')).toBe('reef')
  expect(versioned.searchParams.get('v')).toBe(appSitlVersion.bluesim === 'none' ? null : appSitlVersion.bluesim)
  expect(versioned.searchParams.get('channel')).toBe('tab-1')
  expect(versioned.searchParams.has('home')).toBe(false)
  expect(versioned.searchParams.has('ping360')).toBe(false)
  expect(versionedSimulatorUrl('https://example.com/sim.html?a=1', 'tab-1')).toBe('https://example.com/sim.html?a=1')
})

test("versionedSimulatorUrl passes the SITL home and the Ping360 option to Cockpit's BlueSim", () => {
  const options = { home: { lat: 33.810313, lon: -118.393867 }, ping360: true }
  const withOptions = new URL(versionedSimulatorUrl('bluesim/index.html?level=reef', 'tab-1', options))
  expect(withOptions.searchParams.get('home')).toBe('33.810313,-118.393867')
  expect(withOptions.searchParams.get('ping360')).toBe('1')
  const withoutOptions = new URL(versionedSimulatorUrl('bluesim/index.html', 'tab-1', { home: null, ping360: false }))
  expect(withoutOptions.searchParams.has('home')).toBe(false)
  expect(withoutOptions.searchParams.has('ping360')).toBe(false)
  // Other simulators do not get Cockpit's BlueSim settings
  expect(versionedSimulatorUrl('https://example.com/sim.html', 'tab-1', options)).toBe('https://example.com/sim.html')
})

test("versionedSimulatorUrl passes the Ping360 range to Cockpit's BlueSim only while the sonar is simulated", () => {
  const ranged = new URL(versionedSimulatorUrl('bluesim/index.html', 'tab-1', { ping360: true, ping360Range: 12 }))
  expect(ranged.searchParams.get('ping360_range')).toBe('12')
  const unranged = new URL(versionedSimulatorUrl('bluesim/index.html', 'tab-1', { ping360: true }))
  expect(unranged.searchParams.has('ping360_range')).toBe(false)
  const disabled = new URL(versionedSimulatorUrl('bluesim/index.html', 'tab-1', { ping360: false, ping360Range: 12 }))
  expect(disabled.searchParams.has('ping360_range')).toBe(false)
  const external = versionedSimulatorUrl('https://example.com/sim.html', 'tab-1', { ping360: true, ping360Range: 12 })
  expect(external).toBe('https://example.com/sim.html')
})
