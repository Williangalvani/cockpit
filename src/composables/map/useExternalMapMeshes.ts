import { listenToGenericWebSocketJsonMessages } from '@/libs/generic-websocket'
import {
  type ExternalMapMeshCommand,
  externalMapMeshCommandSchema,
  isExternalMapMeshCommand,
} from '@/libs/map/external-map-mesh-api'
import { MapMeshStore } from '@/libs/map/external-map-meshes'
import { mapMeshStats, recordMapMeshMs, setMapMeshCpuByteSize } from '@/libs/map/external-map-meshes-stats'
import { messageFromError } from '@/libs/utils'

/**
 * Shared state of the map meshes received from external software
 */
export interface ExternalMapMeshesState {
  /**
   * Every received map mesh, kept in memory only
   */
  meshes: MapMeshStore
  /**
   * Applies a map mesh command from external software, ignoring any other message
   */
  handleExternalMapMeshMessage: (message: unknown) => void
}

let state: ExternalMapMeshesState | undefined

const createState = (): ExternalMapMeshesState => {
  const meshes = new MapMeshStore()
  setMapMeshCpuByteSize(() => meshes.byteSize())

  const applyCommand = (command: ExternalMapMeshCommand): void => {
    switch (command.type) {
      case 'cockpit:setMapMesh':
        meshes.set(command.mesh)
        return
      case 'cockpit:setMapMeshQuads':
        mapMeshStats.quadsWritten += meshes.writeQuads(command.id, command)
        return
      case 'cockpit:removeMapMeshQuads':
        meshes.removeQuads(command.id, command.first, command.count)
        return
      case 'cockpit:clearMapMesh':
        meshes.clear(command.id)
        return
      case 'cockpit:removeMapMesh':
        meshes.remove(command.id)
        return
      case 'cockpit:setMapMeshPalette':
        meshes.setPalette(command.id, command.palette)
    }
  }

  const handleExternalMapMeshMessage = (message: unknown): void => {
    if (!isExternalMapMeshCommand(message)) return
    const parseStart = performance.now()
    const parsed = externalMapMeshCommandSchema.safeParse(message)
    if (parsed.success) recordMapMeshMs('parse', performance.now() - parseStart)
    if (!parsed.success) {
      // A malformed mesh can fail on every position, so only the first problem is worth reading.
      const [issue] = parsed.error.issues
      const others = parsed.error.issues.length - 1
      const more = others > 0 ? ` (and ${others} more)` : ''
      console.warn(`[ExternalMapMeshes] Ignoring invalid command. ${issue.path.join('.')}: ${issue.message}${more}`)
      return
    }
    const applyStart = performance.now()
    try {
      applyCommand(parsed.data)
    } catch (error) {
      console.warn(`[ExternalMapMeshes] Ignoring command. ${messageFromError(error)}`)
      return
    }
    mapMeshStats.messagesApplied++
    recordMapMeshMs('apply', performance.now() - applyStart)
  }

  // The singleton outlives every consumer, so this listener is never removed.
  listenToGenericWebSocketJsonMessages(handleExternalMapMeshMessage)

  return { meshes, handleExternalMapMeshMessage }
}

/**
 * Map meshes sent by external software (BlueOS extensions through a WebSocket connection, or pages embedded in an
 * iframe widget), kept in memory only. State is created once and shared across all callers.
 * @returns {ExternalMapMeshesState} The shared meshes and the command handler
 */
export const useExternalMapMeshes = (): ExternalMapMeshesState => {
  if (!state) state = createState()
  return state
}
