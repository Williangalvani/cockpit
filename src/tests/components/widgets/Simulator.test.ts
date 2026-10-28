import { mount } from '@vue/test-utils'
import { expect, test, vi } from 'vitest'

import type { Widget } from '@/types/widgets'

// The widget's settings dialog is not under test, and Vuetify's styles cannot load here.
const empty = { render: () => null }
vi.mock('vuetify/lib/components/VDialog/index.mjs', () => ({ VDialog: empty }))
vi.mock('vuetify/lib/components/VCard/index.mjs', () => ({
  VCard: empty,
  VCardTitle: empty,
  VCardText: empty,
  VCardActions: empty,
}))
vi.mock('vuetify/lib/components/VTextField/index.mjs', () => ({ VTextField: empty }))
vi.mock('vuetify/lib/components/VSwitch/index.mjs', () => ({ VSwitch: empty }))
vi.mock('vuetify/lib/components/VBtn/index.mjs', () => ({ VBtn: empty }))
vi.mock('@/composables/usePointsOfInterest', () => ({
  usePointsOfInterest: () => ({ handleExternalPoiMessage: vi.fn() }),
}))
vi.mock('@/libs/connection/sitl-connection', () => ({
  getSitlHome: () => null,
  onSitlStageChange: () => () => undefined,
  sitlPhysicsChannelId: 'tab-1',
}))
vi.mock('@/stores/appInterface', () => ({ useAppInterfaceStore: () => ({ globalGlassMenuStyles: {} }) }))
vi.mock('@/stores/widgetManager', () => ({
  useWidgetManagerStore: () => ({ editingMode: false, widgetManagerVars: () => ({ configMenuOpen: false }) }),
}))
// What the real map mesh handler needs, so the commands go through it rather than through a stand-in.
vi.mock('@/libs/generic-websocket', () => ({ listenToGenericWebSocketJsonMessages: vi.fn() }))
vi.mock('@/libs/map/external-map-meshes-gl', () => ({ mapMeshGlRenderer: () => undefined }))

const { default: Simulator } = await import('@/components/widgets/Simulator.vue')
const { useExternalMapMeshes } = await import('@/composables/map/useExternalMapMeshes')

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10))

test('the simulator widget applies every map mesh command from BlueSim and answers it in BlueSim', async () => {
  const widget = { hash: 'simulator-1', options: {} } as unknown as Widget
  const wrapper = mount(Simulator, { props: { widget }, attachTo: document.body })
  const blueSim = (wrapper.find('iframe').element as HTMLIFrameElement).contentWindow as Window
  const answers: Record<string, unknown>[] = []
  blueSim.addEventListener('message', (event) => answers.push(event.data))
  const fromBlueSim = (data: Record<string, unknown>, source: Window = blueSim): void => {
    window.dispatchEvent(new MessageEvent('message', { data, source, origin: 'null' }))
  }

  const strip = { corners: new Float64Array([-48.55, -27.59, -48.5499, -27.59, -48.5499, -27.5901, -48.55, -27.5901]) }
  const quad = { ...strip, uv: new Float32Array(8).fill(0.5), texels: new Uint8Array(1) }
  const id = 'bluesim-test-mesh'
  const commands = [
    { type: 'cockpit:getMapCapabilities' },
    {
      type: 'cockpit:setMapMesh',
      mesh: { id, name: 'Test', capacity: 4, texels: { format: 'r8', width: 1, height: 1 } },
    },
    { type: 'cockpit:setMapMeshQuads', id, ...quad },
    { type: 'cockpit:setMapMeshPalette', id, palette: new Uint8Array(1024) },
    { type: 'cockpit:removeMapMeshQuads', id, first: 0, count: 1 },
    { type: 'cockpit:clearMapMesh', id },
    { type: 'cockpit:removeMapMesh', id },
  ]
  commands.forEach((command, index) => fromBlueSim({ ...command, requestId: `r-${index}` }))
  // Another window's commands are not this widget's to apply or answer.
  fromBlueSim({ type: 'cockpit:getMapCapabilities', requestId: 'elsewhere' }, window)
  await settle()

  expect(answers.map((answer) => answer.requestId)).toEqual(commands.map((_, index) => `r-${index}`))
  expect(answers[0]).toMatchObject({ type: 'cockpit:mapCapabilities', meshes: { version: 1, drawn: false } })
  expect(answers.slice(1).every((answer) => answer.type === 'cockpit:mapMeshResult' && answer.ok)).toBe(true)
  expect(answers[2]).toMatchObject({ first: 0, count: 1, head: 1, capacity: 4 })
  expect(useExternalMapMeshes().meshes.has(id)).toBe(false)
  wrapper.unmount()
})

test.each([
  [true, {}, '1'],
  [false, { ping360: false }, null],
])('the simulator simulates a Ping360 sonar: %s, with the saved options %o', (simulated, options, param) => {
  const widget = { hash: 'simulator-2', options } as unknown as Widget
  const wrapper = mount(Simulator, { props: { widget } })
  const source = new URL(wrapper.find('iframe').attributes('src') as string)
  wrapper.unmount()
  expect(widget.options.ping360).toBe(simulated)
  expect(source.searchParams.get('ping360')).toBe(param)
})
