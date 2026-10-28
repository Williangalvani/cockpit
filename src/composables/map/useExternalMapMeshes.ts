import { listenToGenericWebSocketJsonMessages } from '@/libs/generic-websocket'
import {
  type ExternalMapMeshCommand,
  type ExternalMapMeshResult,
  type ExternalMapReply,
  externalMapCapabilities,
  externalMapMeshCommandSchema,
  externalMapRequestIdSchema,
  isExternalMapMeshCommand,
} from '@/libs/map/external-map-mesh-api'
import { type MapMeshWrittenSlots, MapMeshStore } from '@/libs/map/external-map-meshes'
import { mapMeshGlRenderer } from '@/libs/map/external-map-meshes-gl'
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
   * Applies a map mesh command from external software, ignoring any other message. Mesh commands carrying a
   * `requestId`, and capability queries, are answered through `reply`.
   */
  handleExternalMapMeshMessage: (message: unknown, reply?: ExternalMapReply) => void
}

type MeshCommandOutcome = Omit<ExternalMapMeshResult, 'type' | 'requestId'>

// The mesh a command names, read before validation, so even a malformed command can be reported against it.
const sentMeshId = (message: Record<string, unknown>): string => {
  const id = message.id ?? (message.mesh as Record<string, unknown> | null | undefined)?.id
  return typeof id === 'string' ? id : ''
}

let state: ExternalMapMeshesState | undefined

const createState = (): ExternalMapMeshesState => {
  const meshes = new MapMeshStore()
  setMapMeshCpuByteSize(() => meshes.byteSize())

  const applyCommand = (command: ExternalMapMeshCommand): MapMeshWrittenSlots | undefined => {
    switch (command.type) {
      case 'cockpit:setMapMesh':
        meshes.set(command.mesh)
        return
      case 'cockpit:setMapMeshQuads': {
        const written = meshes.writeQuads(command.id, command)
        mapMeshStats.quadsWritten += written.count
        return written
      }
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

  // A sender repeats its commands many times a second, so a rejected mesh is only worth one warning.
  const warnedMeshIds = new Set<string>()
  const rejectMeshCommand = (id: string, error: string, answer: (outcome: MeshCommandOutcome) => void): void => {
    answer({ id, ok: false, error })
    if (warnedMeshIds.has(id)) return
    warnedMeshIds.add(id)
    console.warn(`[ExternalMapMeshes] Ignoring command for mesh '${id}'. ${error}`)
  }

  const applyMeshCommand = (
    command: ExternalMapMeshCommand,
    id: string,
    answer: (outcome: MeshCommandOutcome) => void
  ): void => {
    const applyStart = performance.now()
    let written: MapMeshWrittenSlots | undefined
    try {
      written = applyCommand(command)
    } catch (error) {
      rejectMeshCommand(id, messageFromError(error), answer)
      return
    }
    mapMeshStats.messagesApplied++
    recordMapMeshMs('apply', performance.now() - applyStart)
    const mesh = meshes.meshes.get(id)
    const slots = mesh ? { head: mesh.head % mesh.capacity, capacity: mesh.capacity } : {}
    answer({ id, ok: true, ...written, ...slots })
  }

  const handleExternalMapMeshMessage = (message: unknown, reply?: ExternalMapReply): void => {
    if (!isExternalMapMeshCommand(message)) return
    const sent = message as Record<string, unknown>
    const isMeshCommand = String(sent.type).includes('MapMesh')
    const requestId = externalMapRequestIdSchema.safeParse(sent.requestId).data
    const answer = (outcome: MeshCommandOutcome): void => {
      if (requestId !== undefined) reply?.({ type: 'cockpit:mapMeshResult', requestId, ...outcome })
    }
    const parseStart = performance.now()
    const parsed = externalMapMeshCommandSchema.safeParse(message)
    if (parsed.success && isMeshCommand) recordMapMeshMs('parse', performance.now() - parseStart)
    if (!parsed.success) {
      // A malformed mesh can fail on every position, so only the first problem is worth reading.
      const [issue] = parsed.error.issues
      const others = parsed.error.issues.length - 1
      const more = others > 0 ? ` (and ${others} more)` : ''
      const problem = `${issue.path.join('.')}: ${issue.message}${more}`
      if (!isMeshCommand) {
        console.warn(`[ExternalMapMeshes] Ignoring invalid command. ${problem}`)
        return
      }
      rejectMeshCommand(sentMeshId(sent), `Invalid command. ${problem}`, answer)
      return
    }
    const command = parsed.data
    // Creates the renderer every map shares, which a sender asking is about to need anyway.
    if (command.type === 'cockpit:getMapCapabilities') {
      reply?.(externalMapCapabilities(command.requestId, mapMeshGlRenderer(meshes) !== undefined))
      return
    }
    applyMeshCommand(command, sentMeshId(sent), answer)
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
