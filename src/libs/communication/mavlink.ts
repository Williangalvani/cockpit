import { ConnectionManager } from '@/libs/connection/connection-manager'
import type { Message as MavMessage, Package } from '@/libs/connection/m2r/messages/mavlink2rest'

import { MavComponent, MAVLinkType } from '../connection/m2r/messages/mavlink2rest-enum'
import { type Message } from '../connection/m2r/messages/mavlink2rest-message'
import { MavlinkManualControlState } from '../joystick/protocols/mavlink-manual-control'

let lastTimeLoggedConnectionError = new Date(0)

const packageHasNaN = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isNaN(value)
  if (Array.isArray(value)) return value.some(packageHasNaN)
  if (value !== null && typeof value === 'object') return Object.values(value).some(packageHasNaN)
  return false
}

const mavlink2RestPostUrl = (): string | undefined => {
  const uri = ConnectionManager.mainConnection()?.uri()
  if (!uri) return undefined
  const protocol = uri.protocol === 'wss:' ? 'https:' : 'http:'
  return `${protocol}//${uri.host}/mavlink2rest/v1/mavlink`
}

const serializeMavlinkJson5 = (pack: Package): string => {
  const nanPlaceholder = '__COCKPIT_NAN__'
  return JSON.stringify(pack, (_key, value) =>
    typeof value === 'number' && Number.isNaN(value) ? nanPlaceholder : value
  ).replaceAll(`"${nanPlaceholder}"`, 'NaN')
}

/**
 * Send a mavlink message
 * @param {MavMessage} message
 */
export const sendMavlinkMessage = (message: MavMessage): void => {
  const pack: Package = {
    header: {
      system_id: 255, // GCS system ID
      component_id: Number(MavComponent.MAV_COMP_ID_UDP_BRIDGE), // Used by historical reasons (Check QGC)
      sequence: 0,
    },
    message: message,
  }
  const textEncoder = new TextEncoder()
  try {
    // The websocket endpoint parses strict JSON and rejects a NaN token. REST accepts JSON5, which
    // is required for MAVLink floats that must be NaN on the wire (e.g. unused COMMAND_INT.z).
    if (packageHasNaN(pack)) {
      const url = mavlink2RestPostUrl()
      if (!url) throw new Error('No MAVLink connection to post a NaN-containing message.')
      const payload = serializeMavlinkJson5(pack)
      void fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }).catch(
        (error) => {
          console.error('Error sending MAVLink message:', error)
        }
      )
      return
    }
    ConnectionManager.write(textEncoder.encode(JSON.stringify(pack)))
  } catch (error) {
    // Don't log the error if it's too frequent
    if (Date.now() < lastTimeLoggedConnectionError.getTime() + 10000) return
    console.error('Error sending MAVLink message:', error)
    lastTimeLoggedConnectionError = new Date()
  }
}

/**
 * Send manual control
 * @param {'MavlinkManualControlState'} controllerState Current state of the controller
 * @param {number} targetId
 */
export const sendManualControl = (controllerState: MavlinkManualControlState, targetId: number): void => {
  const state = controllerState as MavlinkManualControlState
  const manualControlMessage: Message.ManualControl = {
    type: MAVLinkType.MANUAL_CONTROL,
    x: state.x,
    y: state.y,
    z: state.z,
    r: state.r,
    s: state.s,
    t: state.t,
    buttons: state.buttons,
    buttons2: state.buttons2,
    target: targetId,
  }
  sendMavlinkMessage(manualControlMessage)
}
