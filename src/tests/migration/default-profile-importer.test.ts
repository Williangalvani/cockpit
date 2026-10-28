import { expect, test, vi } from 'vitest'

import { defaultProfileVehicleCorrespondency, widgetProfiles } from '@/assets/defaults'
import { MavType } from '@/libs/connection/m2r/messages/mavlink2rest-enum'
import { buildFreshSimulatorViewsGroupFromDefault } from '@/migration/default-profile-importer'
import { type Profile, WidgetType } from '@/types/widgets'

// Only the views are under test, and the joystick defaults reach Vuetify's components, whose styles cannot load here.
vi.mock('@/assets/joystick-profiles', () => ({
  blankMapping: {},
  cockpitStandardToProtocols: {},
  defaultProtocolMappingVehicleCorrespondency: {},
}))

test('the views seeded for a simulated vehicle start the simulator with its Ping360 sonar on', () => {
  const rovHash = defaultProfileVehicleCorrespondency[MavType.MAV_TYPE_SUBMARINE]
  const rovDefault = widgetProfiles.find((profile) => profile.hash === rovHash) as Profile
  const seeded = buildFreshSimulatorViewsGroupFromDefault(rovDefault, 'bluesim-reef')
  const simulators = seeded.views.flatMap((view) => view.widgets).filter((w) => w.component === WidgetType.Simulator)
  expect(simulators.map((simulator) => simulator.options)).toEqual([{ ping360: true }])
})
