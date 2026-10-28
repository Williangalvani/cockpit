<template>
  <div class="relative w-full h-full">
    <iframe
      ref="simulatorFrame"
      :src="source"
      class="w-full h-full"
      :class="{ 'pointer-events-none': !isInteractive }"
      frameborder="0"
    />
    <div
      v-if="sitlStageMessage"
      class="absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-md text-sm text-white text-center pointer-events-none"
      :style="interfaceStore.globalGlassMenuStyles"
    >
      {{ sitlStageMessage }}
    </div>
    <v-dialog v-model="widgetStore.widgetManagerVars(widget.hash).configMenuOpen" min-width="400" max-width="35%">
      <v-card class="pa-2" :style="interfaceStore.globalGlassMenuStyles">
        <v-card-title class="text-center">Simulator</v-card-title>
        <v-card-text>
          <p class="text-sm opacity-70 mb-3">
            Shows a browser simulator, like BlueSim's web build, that provides the physics of a sitl:// connection with
            model=JSON. The simulator only runs while visible.
          </p>
          <v-text-field
            :model-value="widget.options.source"
            label="Simulator URL"
            density="compact"
            variant="outlined"
            hide-details
            @change="widget.options.source = $event.srcElement.value"
          />
          <v-switch
            v-model="widget.options.interactive"
            class="my-1"
            label="Receive mouse and keyboard"
            :color="widget.options.interactive ? 'white' : undefined"
            hide-details
          />
          <v-switch
            v-model="widget.options.ping360"
            class="my-1"
            label="Simulate a Ping360 sonar (drawn on the map)"
            :color="widget.options.ping360 ? 'white' : undefined"
            hint="Toggling it reloads the simulator."
            persistent-hint
            @update:model-value="logPing360Toggle"
          />
          <template v-if="widget.options.ping360">
            <v-text-field
              :model-value="widget.options.ping360Range"
              class="mt-3"
              label="Sonar range (m)"
              type="number"
              :min="PING360_MIN_RANGE"
              :max="PING360_MAX_RANGE"
              step="1"
              density="compact"
              variant="outlined"
              hint="Changing it reloads the simulator."
              persistent-hint
              @change="setPing360Range"
            />
            <div class="flex gap-2 mt-3">
              <v-btn color="#FFFFFF22" @click="clearSonarMap">Clear sonar map</v-btn>
              <v-btn color="#FFFFFF22" @click="exportSonarLog">Export sonar log</v-btn>
            </div>
          </template>
        </v-card-text>
        <v-card-actions class="flex justify-end">
          <v-btn color="white" @click="widgetStore.widgetManagerVars(widget.hash).configMenuOpen = false">
            Close
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { saveAs } from 'file-saver'
import { v4 as uuid } from 'uuid'
import { computed, onBeforeMount, onBeforeUnmount, ref, toRefs } from 'vue'

import { useExternalMapMeshes } from '@/composables/map/useExternalMapMeshes'
import { openSnackbar } from '@/composables/snackbar'
import { usePointsOfInterest } from '@/composables/usePointsOfInterest'
import { type SitlStage, getSitlHome, onSitlStageChange, sitlPhysicsChannelId } from '@/libs/connection/sitl-connection'
import { versionedSimulatorUrl } from '@/libs/sitl-version'
import { constrain, replyToMessageSender } from '@/libs/utils'
import { useAppInterfaceStore } from '@/stores/appInterface'
import { useWidgetManagerStore } from '@/stores/widgetManager'
import type { Widget } from '@/types/widgets'

const interfaceStore = useAppInterfaceStore()
const widgetStore = useWidgetManagerStore()

const props = defineProps<{
  /**
   * Widget reference
   */
  widget: Widget
}>()
const widget = toRefs(props).widget

onBeforeMount(() => {
  const defaultOptions = {
    source: 'bluesim/index.html?level=reef',
    // Like a video, the simulator stays out of the way of Cockpit's own controls unless asked otherwise
    interactive: false,
    ping360: true,
    ping360Range: 30,
  }
  widget.value.options = { ...defaultOptions, ...widget.value.options }
  window.addEventListener('message', forwardSimulatorMessage)
})
onBeforeUnmount(() => window.removeEventListener('message', forwardSimulatorMessage))

const PING360_MIN_RANGE = 1
const PING360_MAX_RANGE = 50
const PING360_LOG_TIMEOUT_MS = 10_000

const simulatorFrame = ref<HTMLIFrameElement>()
const { handleExternalPoiMessage } = usePointsOfInterest()
const { handleExternalMapMeshMessage } = useExternalMapMeshes()
const pendingPing360Logs = new Map<string, ReturnType<typeof setTimeout>>()
onBeforeUnmount(() => {
  pendingPing360Logs.forEach((timeout) => clearTimeout(timeout))
  pendingPing360Logs.clear()
})

const savePing360Log = (data: unknown): void => {
  if (typeof data !== 'object' || data === null) return
  const { type, requestId, log } = data as Record<string, unknown>
  if (type !== 'bluesim:ping360Log' || typeof requestId !== 'string') return
  const timeout = pendingPing360Logs.get(requestId)
  if (timeout === undefined) return
  clearTimeout(timeout)
  pendingPing360Logs.delete(requestId)
  if (log === undefined) {
    openSnackbar({ message: 'The simulator sent an empty sonar log.', variant: 'error' })
    return
  }
  const fileName = `ping360-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  saveAs(new Blob([JSON.stringify(log)], { type: 'application/json' }), fileName)
  openSnackbar({ message: `Saved the sonar log as ${fileName}.`, variant: 'success' })
}

const forwardSimulatorMessage = (event: MessageEvent): void => {
  // Every simulator widget hears every message, so only the one embedding the sender applies a command
  if (event.source !== simulatorFrame.value?.contentWindow) return
  handleExternalPoiMessage(event.data)
  handleExternalMapMeshMessage(event.data, replyToMessageSender(event))
  savePing360Log(event.data)
}

const postToSimulator = (message: Record<string, unknown>): void => {
  const origin = new URL(source.value).origin
  // Pages loaded from file://, like in Electron, have the opaque origin 'null', which postMessage rejects as a target
  const targetOrigin = origin === window.location.origin && origin !== 'null' ? origin : '*'
  simulatorFrame.value?.contentWindow?.postMessage(message, targetOrigin)
}

const logPing360Toggle = (enabled: boolean | null): void => {
  logUserAction(`${enabled ? 'Enabled' : 'Disabled'} the simulated Ping360 sonar`)
}

const setPing360Range = (event: Event): void => {
  const input = event.target as HTMLInputElement
  const typed = Number.parseFloat(input.value)
  const current = widget.value.options.ping360Range
  const range = Number.isFinite(typed) ? constrain(Math.round(typed), PING360_MIN_RANGE, PING360_MAX_RANGE) : current
  input.value = String(range)
  if (range === current) return
  widget.value.options.ping360Range = range
  logUserAction(`Set the simulated Ping360 sonar range to ${range} m`)
}

const clearSonarMap = (): void => {
  logUserAction('Cleared the simulated Ping360 sonar map')
  postToSimulator({ type: 'bluesim:ping360', command: 'clear' })
}

const exportSonarLog = (): void => {
  logUserAction('Exported the simulated Ping360 sonar log')
  const requestId = uuid()
  const timeout = setTimeout(() => {
    pendingPing360Logs.delete(requestId)
    openSnackbar({
      message: 'The simulator did not send the sonar log in time. Make sure it is visible and loaded, then try again.',
      variant: 'error',
    })
  }, PING360_LOG_TIMEOUT_MS)
  pendingPing360Logs.set(requestId, timeout)
  postToSimulator({ type: 'bluesim:ping360', command: 'exportLog', requestId })
}

const source = computed(() =>
  versionedSimulatorUrl(widget.value.options.source, sitlPhysicsChannelId, {
    home: getSitlHome(),
    ping360: widget.value.options.ping360,
    ping360Range: widget.value.options.ping360Range,
  })
)
const isInteractive = computed(() => widget.value.options.interactive && !widgetStore.editingMode)

const sitlStageMessages: Partial<Record<SitlStage, string>> = {
  'loading-autopilot': 'Loading the autopilot...',
  'waiting-for-simulator': 'Autopilot running, waiting for the simulator, which only loads while visible...',
  'failed': 'The autopilot failed to start. See the system logs for details.',
}
const sitlStage = ref<SitlStage>('idle')
const stopFollowingSitl = onSitlStageChange((stage) => (sitlStage.value = stage))
onBeforeUnmount(stopFollowingSitl)
const sitlStageMessage = computed(() => sitlStageMessages[sitlStage.value])
</script>
