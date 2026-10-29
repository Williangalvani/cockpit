import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

describe('window.__cockpitMapMeshStats', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    localStorage.clear()
    delete window.__cockpitMapMeshStats
  })

  test('is not set unless asked for', async () => {
    await import('@/libs/map/external-map-meshes-stats')
    expect(window.__cockpitMapMeshStats).toBeUndefined()
  })

  test('holds the statistics with cockpit-debug-map-mesh-stats set to true', async () => {
    localStorage.setItem('cockpit-debug-map-mesh-stats', 'true')
    const { mapMeshStats } = await import('@/libs/map/external-map-meshes-stats')
    expect(window.__cockpitMapMeshStats).toBe(mapMeshStats)
  })

  test('is not set with cockpit-debug-map-mesh-stats set to anything else', async () => {
    localStorage.setItem('cockpit-debug-map-mesh-stats', '1')
    await import('@/libs/map/external-map-meshes-stats')
    expect(window.__cockpitMapMeshStats).toBeUndefined()
  })
})
