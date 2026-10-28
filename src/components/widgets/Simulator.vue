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
import { computed, onBeforeMount, onBeforeUnmount, ref, toRefs } from 'vue'

import { useExternalMapMeshes } from '@/composables/map/useExternalMapMeshes'
import { usePointsOfInterest } from '@/composables/usePointsOfInterest'
import { type SitlStage, getSitlHome, onSitlStageChange, sitlPhysicsChannelId } from '@/libs/connection/sitl-connection'
import { versionedSimulatorUrl } from '@/libs/sitl-version'
import { replyToMessageSender } from '@/libs/utils'
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
  }
  widget.value.options = { ...defaultOptions, ...widget.value.options }
  window.addEventListener('message', forwardSimulatorMessage)
})
onBeforeUnmount(() => window.removeEventListener('message', forwardSimulatorMessage))

const simulatorFrame = ref<HTMLIFrameElement>()
const { handleExternalPoiMessage } = usePointsOfInterest()
const { handleExternalMapMeshMessage } = useExternalMapMeshes()

const forwardSimulatorMessage = (event: MessageEvent): void => {
  // Every simulator widget hears every message, so only the one embedding the sender applies a command
  if (event.source !== simulatorFrame.value?.contentWindow) return
  handleExternalPoiMessage(event.data)
  handleExternalMapMeshMessage(event.data, replyToMessageSender(event))
}

const logPing360Toggle = (enabled: boolean | null): void => {
  logUserAction(`${enabled ? 'Enabled' : 'Disabled'} the simulated Ping360 sonar`)
}

const source = computed(() =>
  versionedSimulatorUrl(widget.value.options.source, sitlPhysicsChannelId, {
    home: getSitlHome(),
    ping360: widget.value.options.ping360,
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
