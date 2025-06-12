<template>
  <div ref="videoWidget" class="video-widget">
    <statsForNerds v-if="widget.options.statsForNerds" :stream-name="externalStreamId" />
    <div v-if="widget.options.showFocusStatus" class="focus-status-overlay">
      <div 
        class="focus-indicator" 
        :class="{ 'in-focus': focusState.isInFocus, 'out-of-focus': !focusState.isInFocus, 'auto-focusing': focusState.isAutoFocusing }"
      >
        <span class="focus-text">{{ focusStatusText }}</span>
        <span class="focus-value">{{ focusState.currentValue.toFixed(2) }}</span>
        <span v-if="focusState.isAutoFocusing" class="auto-focus-info">
          AF: {{ focusState.autoFocusPosition }}%
        </span>
      </div>
    </div>
    <div v-if="nameSelectedStream === undefined" class="no-video-alert">
      <span>No video stream selected.</span>
    </div>
    <div
      v-else-if="!namesAvailableStreams.isEmpty() && !namesAvailableStreams.includes(nameSelectedStream)"
      class="no-video-alert"
    >
      <p>The selected stream "{{ nameSelectedStream }}" is not available.</p>
      <p>Available ones are: {{ namesAvailableStreams.map((name) => `"${name}"`).join(', ') }}.</p>
      <br />
      <p>
        This can happen if you changed vehicles and the stream name in the new one is different from the former, or if
        the source is not available at all.
      </p>
      <br />
      <p>
        Please open this video player configuration and select a new stream from the ones available, or check your
        source for issues.
      </p>
    </div>
    <div v-else-if="!streamConnected" class="no-video-alert">
      <div class="no-video-alert">
        <p>
          <span class="text-xl font-bold">Server status: </span>
          <span v-for="(statusParagraph, i) in serverStatus.toString().split('\\n')" :key="i">
            {{ statusParagraph }}
            <br />
          </span>
        </p>
        <p>
          <span class="text-xl font-bold">Stream status: </span>
          <span v-for="(statusParagraph, i) in streamStatus.toString().split('\\n')" :key="i">
            {{ statusParagraph }}
            <br />
          </span>
        </p>
      </div>
    </div>
    <div v-else class="no-video-alert">
      <p>Loading stream...</p>
    </div>
    <video id="mainDisplayStream" ref="videoElement" muted autoplay playsinline disablePictureInPicture>
      Your browser does not support the video tag.
    </video>
    <canvas ref="focusCanvas" class="hidden" width="160" height="120"></canvas>
  </div>
  <v-dialog v-model="widgetStore.widgetManagerVars(widget.hash).configMenuOpen" width="auto">
    <v-card class="pa-4 text-white" style="border-radius: 15px" :style="interfaceStore.globalGlassMenuStyles">
      <v-card-title class="text-center">Video widget config</v-card-title>
      <v-card-text class="flex flex-col gap-y-4">
        <v-select
          v-model="nameSelectedStream"
          label="Stream name"
          class="my-3"
          :items="namesAvailableStreams"
          item-title="name"
          density="compact"
          variant="outlined"
          no-data-text="No streams available."
          hide-details
          return-object
        />
        <v-select
          v-model="widget.options.videoFitStyle"
          label="Fit style"
          class="my-3"
          :items="['cover', 'fill', 'contain']"
          item-title="style"
          density="compact"
          variant="outlined"
          no-data-text="No streams available."
          hide-details
          return-object
        />
        <v-banner-text>Saved stream name: "{{ widget.options.internalStreamName }}"</v-banner-text>
        <v-switch
          v-model="widget.options.flipHorizontally"
          class="my-1"
          label="Flip horizontally"
          :color="widget.options.flipHorizontally ? 'white' : undefined"
          hide-details
        />
        <v-switch
          v-model="widget.options.flipVertically"
          class="my-1"
          label="Flip vertically"
          :color="widget.options.flipVertically ? 'white' : undefined"
          hide-details
        />
        <v-switch
          v-model="widget.options.statsForNerds"
          class="my-1"
          label="Stats for nerds"
          :color="widget.options.statsForNerds ? 'white' : undefined"
          hide-details
        />
        <v-switch
          v-model="widget.options.showFocusStatus"
          class="my-1"
          label="Show focus status"
          :color="widget.options.showFocusStatus ? 'white' : undefined"
          hide-details
        />
        <v-switch
          v-model="widget.options.showFocusChart"
          class="my-1"
          label="Show focus chart"
          :color="widget.options.showFocusChart ? 'white' : undefined"
          hide-details
        />
        <div v-if="widget.options.showFocusStatus || widget.options.showFocusChart" class="focus-config">
          <v-slider
            v-model="widget.options.focusThreshold"
            label="Focus threshold"
            min="10"
            max="10000"
            step="10"
            thumb-label
            hide-details
            class="my-3"
          />
          <v-slider
            v-model="widget.options.focusUpdateInterval"
            label="Update interval (ms)"
            min="100"
            max="2000"
            step="100"
            thumb-label
            hide-details
            class="my-3"
          />
          <v-slider
            v-model="widget.options.autoFocusStepSize"
            label="Auto-focus step size (%)"
            min="5"
            max="25"
            step="5"
            thumb-label
            hide-details
            class="my-3"
          />
          <v-slider
            v-model="widget.options.autoFocusWaitFrames"
            label="Wait frames after focus change"
            min="1"
            max="10"
            step="1"
            thumb-label
            hide-details
            class="my-3"
          />
          <div class="auto-focus-controls mt-4">
            <v-btn
              :disabled="focusState.isAutoFocusing"
              color="primary"
              variant="outlined"
              @click="startAutoFocus"
            >
              Start Auto-Focus
            </v-btn>
            <v-btn
              :disabled="!focusState.isAutoFocusing"
              color="secondary"
              variant="outlined"
              class="ml-2"
              @click="stopAutoFocus"
            >
              Stop Auto-Focus
            </v-btn>
          </div>
          <div v-if="widget.options.showFocusChart" class="focus-chart-container mt-4">
            <FocusVisualization
              :width="500"
              :height="250"
              :focus-history="focusState.autoFocusHistory"
              :current-position="focusState.autoFocusPosition"
              :best-position="focusState.autoFocusBestPosition"
              :is-auto-focusing="focusState.isAutoFocusing"
              :auto-focus-phase="focusState.autoFocusPhase"
            />
          </div>
        </div>
        <div class="flex-wrap justify-center d-flex ga-5">
          <v-btn prepend-icon="mdi-file-rotate-left" variant="outlined" @click="rotateVideo(-90)"> Rotate Left</v-btn>
          <v-btn prepend-icon="mdi-file-rotate-right" variant="outlined" @click="rotateVideo(+90)"> Rotate Right</v-btn>
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onBeforeMount, onBeforeUnmount, ref, toRefs, watch } from 'vue'

import FocusVisualization from '@/components/FocusVisualization.vue'
import StatsForNerds from '@/components/VideoPlayerStatsForNerds.vue'
import { FocusDetector } from '@/libs/focus-detection'
import { isEqual } from '@/libs/utils'
import { useAppInterfaceStore } from '@/stores/appInterface'
import { useVideoStore } from '@/stores/video'
import { useWidgetManagerStore } from '@/stores/widgetManager'
import type { Widget } from '@/types/widgets'
const interfaceStore = useAppInterfaceStore()

const videoStore = useVideoStore()
const widgetStore = useWidgetManagerStore()

const { namessAvailableAbstractedStreams: namesAvailableStreams } = storeToRefs(videoStore)

const props = defineProps<{
  /**
   * Widget reference
   */
  widget: Widget
}>()

const widget = toRefs(props).widget

const nameSelectedStream = ref<string | undefined>()
const videoElement = ref<HTMLVideoElement | undefined>()
const focusCanvas = ref<HTMLCanvasElement | undefined>()
const mediaStream = ref<MediaStream | undefined>()
const streamConnected = ref(false)

// Focus detection
let focusDetector: FocusDetector
let focusDetectionInterval: NodeJS.Timeout | undefined
const focusState = ref({
  currentValue: 0,
  isInFocus: false,
  history: [] as number[],
  isAutoFocusing: false,
  autoFocusDirection: 'in' as 'in' | 'out',
  autoFocusPosition: 50,
  autoFocusHistory: [] as Array<{ position: number; variance: number }>,
  autoFocusWaitCounter: 0,
  autoFocusBestPosition: 50,
  autoFocusBestVariance: 0,
  autoFocusPhase: 'first-direction' as 'first-direction' | 'second-direction' | 'completed',
  autoFocusStartPosition: 50,
  autoFocusFirstDirectionBest: { position: 50, variance: 0 }
})

onBeforeMount(() => {
  // Set the default initial values that are not present in the widget options
  const defaultOptions = {
    videoFitStyle: 'cover',
    flipHorizontally: false,
    flipVertically: false,
    rotationAngle: 0,
    statsForNerds: false,
    showFocusStatus: false,
    showFocusChart: false,
    focusThreshold: 6000,
    focusUpdateInterval: 500,
    autoFocusStepSize: 10,
    autoFocusWaitFrames: 3,
    internalStreamName: undefined as string | undefined,
  }
  widget.value.options = Object.assign({}, defaultOptions, widget.value.options)
  nameSelectedStream.value = widget.value.options.internalStreamName

  // Initialize focus detector
  focusDetector = new FocusDetector({
    threshold: widget.value.options.focusThreshold,
    updateInterval: widget.value.options.focusUpdateInterval,
    autoFocusStepSize: widget.value.options.autoFocusStepSize,
    autoFocusWaitFrames: widget.value.options.autoFocusWaitFrames,
  })
})

const externalStreamId = computed(() => {
  return nameSelectedStream.value ? videoStore.externalStreamId(nameSelectedStream.value) : undefined
})

/**
 * Capture frame from video and analyze focus
 */
const analyzeFocus = (): void => {
  if (!videoElement.value || !focusCanvas.value || !streamConnected.value || !focusDetector) {
    return
  }
  
  const video = videoElement.value
  const canvas = focusCanvas.value
  const ctx = canvas.getContext('2d')
  
  if (!ctx || video.videoWidth === 0 || video.videoHeight === 0) {
    return
  }
  
  // Draw video frame to canvas at reduced resolution for performance
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  
  // Get image data
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  
  // Calculate Laplacian variance using the focus detector
  const variance = focusDetector.calculateLaplacianVariance(imageData)
  
  // Process the measurement
  focusDetector.processFocusMeasurement(variance)
  
  // Update reactive state with deep copy of arrays
  const state = focusDetector.getState()
  focusState.value = { 
    ...state,
    history: [...state.history],
    autoFocusHistory: [...state.autoFocusHistory]
  }
}

/**
 * Start focus detection
 */
const startFocusDetection = (): void => {
  if (focusDetectionInterval) {
    clearInterval(focusDetectionInterval)
  }
  
  if (widget.value.options.showFocusStatus || widget.value.options.showFocusChart) {
    focusDetectionInterval = setInterval(analyzeFocus, widget.value.options.focusUpdateInterval)
  }
}

/**
 * Stop focus detection
 */
const stopFocusDetection = (): void => {
  if (focusDetectionInterval) {
    clearInterval(focusDetectionInterval)
    focusDetectionInterval = undefined
  }
}

/**
 * Start auto-focus process
 */
const startAutoFocus = (): void => {
  if (focusDetector) {
    focusDetector.startAutoFocus()
  }
}

/**
 * Stop auto-focus process
 */
const stopAutoFocus = (): void => {
  if (focusDetector) {
    focusDetector.stopAutoFocus()
  }
}

const focusStatusText = computed(() => {
  if (focusState.value.isAutoFocusing) {
    return 'AUTO FOCUS'
  }
  return focusState.value.isInFocus ? 'IN FOCUS' : 'OUT OF FOCUS'
})

// Watch for focus detection setting changes
watch(() => widget.value.options.showFocusStatus, (newValue) => {
  if (newValue) {
    startFocusDetection()
  } else if (!widget.value.options.showFocusChart) {
    stopFocusDetection()
  }
})

watch(() => widget.value.options.showFocusChart, (newValue) => {
  if (newValue) {
    startFocusDetection()
  } else if (!widget.value.options.showFocusStatus) {
    stopFocusDetection()
  }
})

watch(() => widget.value.options.focusUpdateInterval, () => {
  if (widget.value.options.showFocusStatus) {
    startFocusDetection()
  }
  if (focusDetector) {
    focusDetector.updateSettings({ updateInterval: widget.value.options.focusUpdateInterval })
  }
})

// Watch for focus threshold changes
watch(() => widget.value.options.focusThreshold, () => {
  if (focusDetector) {
    focusDetector.updateSettings({ threshold: widget.value.options.focusThreshold })
  }
})

// Watch for auto-focus settings changes
watch(() => widget.value.options.autoFocusStepSize, () => {
  if (focusDetector) {
    focusDetector.updateSettings({ autoFocusStepSize: widget.value.options.autoFocusStepSize })
  }
})

watch(() => widget.value.options.autoFocusWaitFrames, () => {
  if (focusDetector) {
    focusDetector.updateSettings({ autoFocusWaitFrames: widget.value.options.autoFocusWaitFrames })
  }
})

watch(
  () => videoStore.streamsCorrespondency,
  () => {
    mediaStream.value = undefined

    if (!nameSelectedStream.value) return

    const selectedExternalId = videoStore.externalStreamId(nameSelectedStream.value)
    if (!selectedExternalId) return

    const newStreamCorr = videoStore.streamsCorrespondency.find((stream) => stream.externalId === selectedExternalId)
    if (!newStreamCorr) return

    const newInternalName = newStreamCorr.name

    if (nameSelectedStream.value !== newInternalName) {
      nameSelectedStream.value = newInternalName
      widget.value.options.internalStreamName = newInternalName
    }
  },
  { deep: true }
)

const streamConnectionRoutine = setInterval(() => {
  // If the video player widget is cold booted, assign the first stream to it
  if (widget.value.options.internalStreamName === undefined && !namesAvailableStreams.value.isEmpty()) {
    widget.value.options.internalStreamName = namesAvailableStreams.value[0]
    nameSelectedStream.value = widget.value.options.internalStreamName
  }

  if (externalStreamId.value !== undefined) {
    const updatedMediaStream = videoStore.getMediaStream(externalStreamId.value)
    // If the widget is not connected to the MediaStream, try to connect it
    if (!isEqual(updatedMediaStream, mediaStream.value)) {
      mediaStream.value = updatedMediaStream
    }

    const updatedStreamState = videoStore.getStreamData(externalStreamId.value)?.connected ?? false
    if (updatedStreamState !== streamConnected.value) {
      streamConnected.value = updatedStreamState
      
      // Start/stop focus detection based on stream connection
      if (updatedStreamState && (widget.value.options.showFocusStatus || widget.value.options.showFocusChart)) {
        startFocusDetection()
      } else {
        stopFocusDetection()
      }
    }
  }

  if (!namesAvailableStreams.value.isEmpty() && !namesAvailableStreams.value.includes(nameSelectedStream.value!)) {
    if (videoStore.lastRenamedStreamName !== '') {
      nameSelectedStream.value = videoStore.lastRenamedStreamName
      return
    }
    nameSelectedStream.value = namesAvailableStreams.value[0]
  }
}, 1000)

onBeforeUnmount(() => {
  clearInterval(streamConnectionRoutine)
  stopFocusDetection()
})

watch(nameSelectedStream, () => {
  widget.value.options.internalStreamName = nameSelectedStream.value
  mediaStream.value = undefined
})

watch(mediaStream, () => {
  if (!videoElement.value || !mediaStream.value) return
  videoElement.value.srcObject = mediaStream.value
  videoElement.value
    .play()
    .then(() => console.log('[VideoPlayer] Stream is playing'))
    .catch((reason) => {
      const msg = `Failed to play stream. Reason: ${reason}`
      console.error(`[VideoPlayer] ${msg}`)
    })
})

const rotateVideo = (angle: number): void => {
  widget.value.options.rotationAngle += angle
}

const flipStyle = computed(() => {
  return `scale(${widget.value.options.flipHorizontally ? -1 : 1}, ${widget.value.options.flipVertically ? -1 : 1})`
})

const rotateStyle = computed(() => {
  return `rotate(${widget.value.options.rotationAngle ?? 0}deg)`
})

const transformStyle = computed(() => {
  return `${flipStyle.value} ${rotateStyle.value}`
})

const serverStatus = computed(() => {
  if (externalStreamId.value === undefined) return 'Unknown.'
  return videoStore.getStreamData(externalStreamId.value)?.webRtcManager.signallerStatus ?? 'Unknown.'
})

const streamStatus = computed(() => {
  if (externalStreamId.value === undefined) return 'Unknown.'

  const availableSources = videoStore.availableIceIps
  if (!availableSources.isEmpty() && !availableSources.find((ip) => videoStore.allowedIceIps.includes(ip))) {
    return `Stream is coming from IPs [${availableSources.join(', ')}], which are not in the list of allowed sources
      [${videoStore.allowedIceIps.join(', ')}].\\n Please check your configuration.`
  }
  return videoStore.getStreamData(externalStreamId.value)?.webRtcManager.streamStatus ?? 'Unknown.'
})
</script>

<style scoped>
.video-widget {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
}
video {
  height: 100%;
  width: 100%;
  position: absolute;
  top: 0;
  left: 0;
  object-fit: v-bind('widget.options.videoFitStyle');
  transform: v-bind('transformStyle');
}
.no-video-alert {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  background-color: rgb(0, 20, 60);
  text-align: center;
  vertical-align: middle;
  padding: 3rem;
  color: white;
  border: 2px solid rgb(0, 20, 80);
}

.focus-status-overlay {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 10;
  pointer-events: none;
}

.focus-indicator {
  background: rgba(0, 0, 0, 0.7);
  border-radius: 8px;
  padding: 8px 12px;
  color: white;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  font-weight: bold;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 80px;
  border: 2px solid;
  transition: all 0.3s ease;
}

.focus-indicator.in-focus {
  border-color: #4CAF50;
  background: rgba(76, 175, 80, 0.2);
}

.focus-indicator.out-of-focus {
  border-color: #F44336;
  background: rgba(244, 67, 54, 0.2);
}

.focus-indicator.auto-focusing {
  border-color: #FF9800;
  background: rgba(255, 152, 0, 0.2);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 0.8;
  }
  50% {
    opacity: 1;
  }
}

.focus-text {
  font-size: 11px;
  margin-bottom: 2px;
}

.focus-value {
  font-size: 10px;
  opacity: 0.8;
}

.auto-focus-info {
  font-size: 9px;
  opacity: 0.9;
  color: #FF9800;
}

.focus-config {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 16px;
  margin-top: 8px;
}

.hidden {
  display: none;
}
</style>
