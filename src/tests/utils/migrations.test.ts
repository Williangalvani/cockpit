import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  type SettingsPackage,
  fallbackUsername,
  fallbackVehicleId,
  localSyncedSettingsKey,
} from '@/types/settings-management'
import type { Profile, Widget } from '@/types/widgets'

// Only the Ping360 migration is under test; the other migrations' data-lake and telemetry systems stay out.
vi.mock('@/composables/snackbar', () => ({ openSnackbar: vi.fn() }))
vi.mock('@/libs/blueos', () => ({
  getKeyDataFromCockpitVehicleStorage: vi.fn(),
  setKeyDataOnCockpitVehicleStorage: vi.fn(),
}))
vi.mock('@/libs/actions/data-lake', () => ({
  createDataLakeVariable: vi.fn(),
  deleteDataLakeVariable: vi.fn(),
  getDataLakeVariableData: vi.fn(),
}))
vi.mock('@/libs/actions/data-lake-transformations', () => ({
  getAllTransformingFunctions: () => [],
  updateTransformingFunction: vi.fn(),
}))
vi.mock('@/libs/data-lake-logging', () => ({ recordedDataLakeVariablesKey: 'cockpit-data-lake-recorded-variables' }))
vi.mock('@/libs/external-telemetry/event-tracking', () => ({ shareHardwareDetailsKey: 'cockpit-share-hardware' }))
vi.mock('@/utils/data-lake-recorded-variables-migration', () => ({ collectOverlayRecordedVariableIds: () => [] }))

const viewsGroupKey = 'cockpit-views-group-v1'
const migrationsKey = 'cockpit-migrations'
const savedEpoch = 1700000000000

const widget = (hash: string, component: string, options: Record<string, unknown>): Widget =>
  ({ hash, name: component, component, position: { x: 0, y: 0 }, size: { width: 1, height: 1 }, options } as Widget)

const layout = (...widgets: Widget[]): Profile =>
  ({
    name: 'User',
    hash: 'profile',
    views: [{ name: 'Video View', hash: 'view', widgets, miniWidgetContainers: [] }],
  } as unknown as Profile)

const storeSettings = (settings: Record<string, unknown>): void => {
  const pack = Object.fromEntries(
    Object.entries(settings).map(([key, value]) => [key, { epochLastChangedLocally: savedEpoch, value }])
  )
  localStorage.setItem(localSyncedSettingsKey, JSON.stringify({ [fallbackUsername]: { [fallbackVehicleId]: pack } }))
}

const storedSettings = (): SettingsPackage =>
  JSON.parse(localStorage.getItem(localSyncedSettingsKey) as string)[fallbackUsername][fallbackVehicleId]

const storedOptions = (hash: string): Record<string, unknown> | undefined =>
  (storedSettings()[viewsGroupKey].value as Profile).views[0].widgets.find((w) => w.hash === hash)?.options

// Runs a fresh boot, like a page load: the settings manager reads the stored settings, then the migrations run.
const boot = async (): Promise<typeof import('@/libs/settings-management').settingsManager> => {
  vi.resetModules()
  const { settingsManager } = await import('@/libs/settings-management')
  const { runMigrations } = await import('@/utils/migrations')
  runMigrations()
  vi.advanceTimersByTime(1000)
  return settingsManager
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  localStorage.clear()
})

describe('simulator Ping360 migration', () => {
  test('turns Ping360 on in Simulators saved with it off or without it, leaving everything else alone', async () => {
    const map = widget('map', 'Map', { ping360: false })
    storeSettings({
      [viewsGroupKey]: layout(
        widget('off', 'Simulator', { source: 'bluesim/index.html?level=reef', ping360: false, ping360Range: 12 }),
        widget('missing', 'Simulator', { interactive: true }),
        map
      ),
      [migrationsKey]: { 'camera-speed-factor-removed': true },
    })

    await boot()

    expect(storedOptions('off')).toEqual({ source: 'bluesim/index.html?level=reef', ping360: true, ping360Range: 12 })
    expect(storedOptions('missing')).toEqual({ interactive: true, ping360: true })
    expect(storedOptions('map')).toEqual(map.options)
    expect(storedSettings()[viewsGroupKey].epochLastChangedLocally).toBe(savedEpoch)
    expect(storedSettings()[migrationsKey].value).toEqual({
      'camera-speed-factor-removed': true,
      'recorded-variables-from-overlay': true,
      'simulator-ping360-on': true,
    })
  })

  test('readers of the layout during the same boot already get the migrated one', async () => {
    storeSettings({ [viewsGroupKey]: layout(widget('off', 'Simulator', { ping360: false })) })
    vi.resetModules()
    const { settingsManager } = await import('@/libs/settings-management')
    const { runMigrations } = await import('@/utils/migrations')
    runMigrations()

    const read = settingsManager.getKeyValue<Profile>(viewsGroupKey)
    expect(read?.views[0].widgets[0].options.ping360).toBe(true)
  })

  test('runs once, so a sonar turned off after the migration stays off', async () => {
    storeSettings({ [viewsGroupKey]: layout(widget('sim', 'Simulator', { ping360: false })) })
    const settingsManager = await boot()
    expect(storedOptions('sim')?.ping360).toBe(true)

    const turnedOff = layout(widget('sim', 'Simulator', { ping360: false }))
    settingsManager.setKeyValue(viewsGroupKey, turnedOff)
    vi.advanceTimersByTime(1000)
    await boot()
    await boot()

    expect(storedOptions('sim')?.ping360).toBe(false)
  })

  test('only marks itself as run when there is no layout or no Simulator to migrate', async () => {
    await boot()
    expect(storedSettings()[viewsGroupKey]).toBeUndefined()
    expect(storedSettings()[migrationsKey].value).toMatchObject({ 'simulator-ping360-on': true })

    localStorage.clear()
    const untouched = layout(widget('sim', 'Simulator', { ping360: true }), widget('map', 'Map', {}))
    storeSettings({ [viewsGroupKey]: untouched })
    await boot()
    expect(storedSettings()[viewsGroupKey]).toEqual({ epochLastChangedLocally: savedEpoch, value: untouched })
  })
})
