import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { nextTick } from 'vue'

import type { CockpitSetting } from '@/types/settings-management'

const stored = new Map<string, unknown>()
const listeners = new Map<string, (setting: CockpitSetting) => void>()
const setKeyValue = vi.fn((key: string, value: unknown) => {
  stored.set(key, value)
  for (const [id, callback] of listeners) if (id.startsWith(key)) callback({ value, epochLastChangedLocally: 0 })
})

vi.mock('@/libs/settings-management', () => ({
  settingsManager: {
    getKeyValue: (key: string) => stored.get(key),
    setKeyValue: (key: string, value: unknown) => setKeyValue(key, value),
    registerListener: (key: string, callback: (setting: CockpitSetting) => void) => {
      const id = `${key}#${listeners.size}`
      listeners.set(id, callback)
      return id
    },
    unregisterListener: (_key: string, id: string) => listeners.delete(id),
  },
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  stored.clear()
  listeners.clear()
  setKeyValue.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('a value changed and changed back within the debounce is not persisted or bounced back', async () => {
  stored.set('cockpit-test-flag', true)
  const { useBlueOsStorage } = await import('@/composables/settingsSyncer')
  const flag = useBlueOsStorage('cockpit-test-flag', false)

  flag.value = false
  await nextTick()
  flag.value = true
  await nextTick()
  vi.advanceTimersByTime(5000)
  await nextTick()

  expect(setKeyValue).not.toHaveBeenCalledWith('cockpit-test-flag', false)
  expect(stored.get('cockpit-test-flag')).toBe(true)
  expect(flag.value).toBe(true)
})

test('a value that stays changed is persisted after the debounce', async () => {
  stored.set('cockpit-test-flag', true)
  const { useBlueOsStorage } = await import('@/composables/settingsSyncer')
  const flag = useBlueOsStorage('cockpit-test-flag', false)

  flag.value = false
  await nextTick()
  vi.advanceTimersByTime(5000)
  await nextTick()

  expect(setKeyValue).toHaveBeenCalledWith('cockpit-test-flag', false)
  expect(flag.value).toBe(false)
})
