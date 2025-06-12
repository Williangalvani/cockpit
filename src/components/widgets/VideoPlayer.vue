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
    <Transition name="loading-complete">
      <div v-if="showLoadingOverlay" class="loading-overlay">
        <div v-if="showSuccessState" class="success-icon mb-4">
          <v-icon size="48" color="white">mdi-check-circle</v-icon>
        </div>
        <v-progress-circular v-else indeterminate color="white" size="48" width="3" class="mb-4" />
        <p class="loading-text">{{ loadingMessage }}</p>
        <div v-if="shouldShowVerboseLoading && !streamConnected && !showSuccessState" class="verbose-status">
          <p class="status-line">
            <span class="status-label">Server: </span>
            <span v-for="(statusParagraph, i) in serverStatus.toString().split('\\n')" :key="'server-' + i">
              {{ statusParagraph }}
            </span>
          </p>
          <p class="status-line">
            <span class="status-label">Stream: </span>
            <span v-for="(statusParagraph, i) in streamStatus.toString().split('\\n')" :key="'stream-' + i">
              {{ statusParagraph }}
            </span>
          </p>
        </div>
        <v-btn
          v-if="!streamConnected && !showSuccessState"
          variant="text"
          size="small"
          class="mt-3 toggle-details-btn"
          @click="toggleVerboseLoading"
        >
          {{ shouldShowVerboseLoading ? 'Hide details' : 'Show details' }}
        </v-btn>
      </div>
    </Transition>
    <video id="mainDisplayStream" ref="videoElement" muted autoplay playsinline disablePictureInPicture>
      Your browser does not support the video tag.
    </video>
    <div class="video-container" :class="{ 'selecting-aoi': isSelectingAoi }" @mousedown="handleMouseDown" @mousemove="handleMouseMove" @mouseup="handleMouseUp">
      <video id="mainDisplayStream" ref="videoElement" muted autoplay playsinline disablePictureInPicture>
        Your browser does not support the video tag.
      </video>
             <div v-if="widget.options.aoiEnabled && (showAoiRectangle || isSelectingAoi)" class="aoi-overlay">
         <div 
           class="aoi-rectangle" 
           :style="aoiRectangleStyle"
         >
           <div class="aoi-label">Focus Area</div>
         </div>
       </div>
       <div v-if="widget.options.aoiEnabled && focusState.isAutoFocusing" class="roi-chart-overlay">
         <canvas ref="roiChart" width="200" height="80" class="roi-chart"></canvas>
         <div class="chart-debug">AF: {{ focusState.isAutoFocusing }}, Data: {{ roiSharpnessHistory.length }}</div>
       </div>
    </div>
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
          v-model="widget.options.showVerboseLoading"
          class="my-1"
          label="Verbose loading status"
          :color="widget.options.showVerboseLoading ? 'white' : undefined"
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
        <v-switch
          v-model="widget.options.aoiEnabled"
          class="my-1"
          label="Enable ROI Selection"
          :color="widget.options.aoiEnabled ? 'white' : undefined"
          hide-details
        />
        <v-banner-text v-if="widget.options.aoiEnabled" class="text-xs mb-2 text-green-400">
          ROI Active: Drag on video to select focus area. Auto-focus will start automatically.
        </v-banner-text>
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
const roiChart = ref<HTMLCanvasElement | undefined>()
const mediaStream = ref<MediaStream | undefined>()
const streamConnected = ref(false)
const showVerboseLoadingTemporary = ref(false)
const videoPlaying = ref(false)
const showSuccessState = ref(false)
let successTimeoutId: ReturnType<typeof setTimeout> | null = null

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
  autoFocusPhase: 'first-direction' as 'first-direction' | 'second-direction' | 'fine-tuning' | 'completed',
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
    // Area of Interest settings
    aoiEnabled: false,
    aoiX1: 0,
    aoiY1: 0,
    aoiX2: 1,
    aoiY2: 1,
    internalStreamName: undefined as string | undefined,
    showVerboseLoading: false,
  }
  widget.value.options = { ...defaultOptions, ...widget.value.options }
  nameSelectedStream.value = widget.value.options.internalStreamName

  // Initialize focus detector
  focusDetector = new FocusDetector({
    threshold: widget.value.options.focusThreshold,
    updateInterval: widget.value.options.focusUpdateInterval,
    autoFocusStepSize: widget.value.options.autoFocusStepSize,
    autoFocusWaitFrames: widget.value.options.autoFocusWaitFrames,
    aoiEnabled: widget.value.options.aoiEnabled,
    aoiX1: widget.value.options.aoiX1,
    aoiY1: widget.value.options.aoiY1,
    aoiX2: widget.value.options.aoiX2,
    aoiY2: widget.value.options.aoiY2,
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

// Area of Interest functionality
const isSelectingAoi = ref(false)
const aoiStartPoint = ref({ x: 0, y: 0 })
const showAoiRectangle = ref(false)
const roiSharpnessHistory = ref<Array<{ time: number; sharpness: number }>>([])
const roiChartUpdateInterval = ref<NodeJS.Timeout | undefined>()

const aoiRectangleStyle = computed(() => {
  // Handle potentially flipped coordinates
  const x1 = Math.min(widget.value.options.aoiX1, widget.value.options.aoiX2)
  const y1 = Math.min(widget.value.options.aoiY1, widget.value.options.aoiY2)
  const x2 = Math.max(widget.value.options.aoiX1, widget.value.options.aoiX2)
  const y2 = Math.max(widget.value.options.aoiY1, widget.value.options.aoiY2)
  
  return {
    position: 'absolute' as const,
    left: `${x1 * 100}%`,
    top: `${y1 * 100}%`,
    width: `${(x2 - x1) * 100}%`,
    height: `${(y2 - y1) * 100}%`,
    border: '2px solid #00ff00',
    backgroundColor: 'rgba(0, 255, 0, 0.1)',
    pointerEvents: 'none' as const,
  }
})

/**
 * Handle mouse down for AOI drag selection
 */
const handleMouseDown = (event: MouseEvent): void => {
  if (!widget.value.options.aoiEnabled || event.button !== 0) return // Only left mouse button when enabled
  
  isSelectingAoi.value = true
  showAoiRectangle.value = true
  const video = event.currentTarget as HTMLElement
  const rect = video.getBoundingClientRect()
  const x = (event.clientX - rect.left) / rect.width
  const y = (event.clientY - rect.top) / rect.height
  
  // Clamp coordinates to valid range
  const clampedX = Math.max(0, Math.min(1, x))
  const clampedY = Math.max(0, Math.min(1, y))
  
  aoiStartPoint.value = { x: clampedX, y: clampedY }
  
  // Set initial AOI coordinates
  widget.value.options.aoiX1 = clampedX
  widget.value.options.aoiY1 = clampedY
  widget.value.options.aoiX2 = clampedX
  widget.value.options.aoiY2 = clampedY
  
  event.preventDefault()
}

/**
 * Handle mouse move for AOI drag selection
 */
const handleMouseMove = (event: MouseEvent): void => {
  if (!isSelectingAoi.value) return
  
  const video = event.currentTarget as HTMLElement
  const rect = video.getBoundingClientRect()
  const x = (event.clientX - rect.left) / rect.width
  const y = (event.clientY - rect.top) / rect.height
  
  // Clamp coordinates to valid range
  const clampedX = Math.max(0, Math.min(1, x))
  const clampedY = Math.max(0, Math.min(1, y))
  
  // Update the second corner of the AOI
  widget.value.options.aoiX2 = clampedX
  widget.value.options.aoiY2 = clampedY
}

/**
 * Handle mouse up for AOI drag selection
 */
const handleMouseUp = (): void => {
  if (!isSelectingAoi.value) return
  
  isSelectingAoi.value = false
  
  // Calculate area size to check if it meets minimum threshold
  const x1 = Math.min(widget.value.options.aoiX1, widget.value.options.aoiX2)
  const y1 = Math.min(widget.value.options.aoiY1, widget.value.options.aoiY2)
  const x2 = Math.max(widget.value.options.aoiX1, widget.value.options.aoiX2)
  const y2 = Math.max(widget.value.options.aoiY1, widget.value.options.aoiY2)
  
  const width = x2 - x1
  const height = y2 - y1
  const area = width * height
  
  // If area is too small (less than 1% of image), create 10% window around click point
  const minArea = 0.01 // 1% of image
  if (area < minArea) {
    const centerX = (x1 + x2) / 2
    const centerY = (y1 + y2) / 2
    const windowSize = 0.1 // 10% of image size
    
    widget.value.options.aoiX1 = Math.max(0, centerX - windowSize / 2)
    widget.value.options.aoiY1 = Math.max(0, centerY - windowSize * 1.7 / 2)
    widget.value.options.aoiX2 = Math.min(1, centerX + windowSize / 2)
    widget.value.options.aoiY2 = Math.min(1, centerY + windowSize * 1.7 / 2)
  }
  
  updateFocusDetectorAoi()
  
  // Hide the ROI rectangle after selection
  showAoiRectangle.value = false
  
  // Clear previous chart data and start tracking
  roiSharpnessHistory.value = []
  
  // Stop any running auto-focus and start new one
  if (focusDetector) {
    // Stop current auto-focus if running (this will return to best position)
    if (focusState.value.isAutoFocusing) {
      stopAutoFocus()
      // Wait a moment for the focus to settle at the best position before starting new auto-focus
      setTimeout(() => {
        startAutoFocus()
        startRoiChartTracking()
        // Draw initial chart
        setTimeout(() => drawRoiChart(), 100)
      }, 500) // Wait 500ms for focus to settle
    } else {
      // Start new auto-focus immediately if not currently running
      startAutoFocus()
      startRoiChartTracking()
      // Draw initial chart
      setTimeout(() => drawRoiChart(), 100)
    }
  }
}

/**
 * Update focus detector with new AOI settings
 */
const updateFocusDetectorAoi = (): void => {
  if (focusDetector) {
    focusDetector.updateSettings({
      aoiEnabled: widget.value.options.aoiEnabled,
      aoiX1: widget.value.options.aoiX1,
      aoiY1: widget.value.options.aoiY1,
      aoiX2: widget.value.options.aoiX2,
      aoiY2: widget.value.options.aoiY2,
    })
  }
}

/**
 * Start tracking ROI sharpness for chart
 */
const startRoiChartTracking = (): void => {
  // Clear any existing interval
  stopRoiChartTracking()
  
  console.log('[ROI Chart] Starting chart tracking')
  
  roiChartUpdateInterval.value = setInterval(() => {
    if (focusState.value.isAutoFocusing) {
      const currentTime = Date.now()
      const sharpness = focusState.value.currentValue
      
      roiSharpnessHistory.value.push({
        time: currentTime,
        sharpness: sharpness
      })
      
      // Keep only last 50 data points
      if (roiSharpnessHistory.value.length > 50) {
        roiSharpnessHistory.value.shift()
      }
      
      console.log(`[ROI Chart] Data points: ${roiSharpnessHistory.value.length}, Sharpness: ${sharpness.toFixed(2)}`)
      drawRoiChart()
    } else {
      // Stop tracking when auto-focus is done
      console.log('[ROI Chart] Auto-focus stopped, stopping chart tracking')
      stopRoiChartTracking()
    }
  }, 200) // Update every 200ms
}

/**
 * Stop tracking ROI sharpness
 */
const stopRoiChartTracking = (): void => {
  if (roiChartUpdateInterval.value) {
    clearInterval(roiChartUpdateInterval.value)
    roiChartUpdateInterval.value = undefined
    console.log('[ROI Chart] Chart tracking stopped')
    
    // Keep the chart data visible for a few seconds after auto-focus completes
    setTimeout(() => {
      console.log('[ROI Chart] Clearing chart data')
      roiSharpnessHistory.value = []
    }, 3000)
  }
}

/**
 * Draw the ROI sharpness chart
 */
const drawRoiChart = (): void => {
  const canvas = roiChart.value
  if (!canvas) return
  
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  
  const width = canvas.width
  const height = canvas.height
  
  // Clear canvas
  ctx.clearRect(0, 0, width, height)
  
  // Set up chart styling
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
  ctx.fillRect(0, 0, width, height)
  
  // Find min/max values for scaling
  const values = roiSharpnessHistory.value.map(d => d.sharpness)
  const minValue = values.length > 0 ? Math.min(...values) : 0
  const maxValue = values.length > 0 ? Math.max(...values) : 1000
  const valueRange = maxValue - minValue || 1
  
  // Draw grid lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 1; i < 4; i++) {
    const y = (height / 4) * i
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
  }
  ctx.stroke()
  
  // Draw the sharpness line
  if (roiSharpnessHistory.value.length > 0) {
    ctx.strokeStyle = '#00ff00'
    ctx.lineWidth = 2
    ctx.beginPath()
    
    if (roiSharpnessHistory.value.length === 1) {
      // Draw a single point
      const point = roiSharpnessHistory.value[0]
      const x = width / 2
      const y = height - ((point.sharpness - minValue) / valueRange) * height
      ctx.beginPath()
      ctx.arc(x, y, 2, 0, 2 * Math.PI)
      ctx.fillStyle = '#00ff00'
      ctx.fill()
    } else {
      // Draw line for multiple points
      roiSharpnessHistory.value.forEach((point, index) => {
        const x = (index / Math.max(1, roiSharpnessHistory.value.length - 1)) * width
        const y = height - ((point.sharpness - minValue) / valueRange) * height
        
        if (index === 0) {
          ctx.moveTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }
      })
      ctx.stroke()
    }
  }
  
  // Draw current value indicator
  if (roiSharpnessHistory.value.length > 0) {
    const lastPoint = roiSharpnessHistory.value[roiSharpnessHistory.value.length - 1]
    const x = width - 5
    const y = height - ((lastPoint.sharpness - minValue) / valueRange) * height
    
    ctx.fillStyle = '#00ff00'
    ctx.beginPath()
    ctx.arc(x, y, 3, 0, 2 * Math.PI)
    ctx.fill()
  }
  
  // Draw title
  ctx.fillStyle = 'white'
  ctx.font = '12px Arial'
  ctx.fillText('ROI Sharpness', 5, 15)
}

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

// Watch for AOI setting changes
watch(() => widget.value.options.aoiEnabled, () => {
  updateFocusDetectorAoi()
})

watch(() => [widget.value.options.aoiX1, widget.value.options.aoiY1, widget.value.options.aoiX2, widget.value.options.aoiY2], () => {
  updateFocusDetectorAoi()
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
    // Use reference comparison for MediaStream objects, not deep equality, as the media stream can be the same with one
    // or more attributes having changed.
    if (updatedMediaStream !== mediaStream.value) {
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
  if (successTimeoutId) clearTimeout(successTimeoutId)

  clearInterval(streamConnectionRoutine)
  stopFocusDetection()
  stopRoiChartTracking()
})

watch(nameSelectedStream, () => {
  widget.value.options.internalStreamName = nameSelectedStream.value
  mediaStream.value = undefined
  videoPlaying.value = false
  showSuccessState.value = false
  if (successTimeoutId) clearTimeout(successTimeoutId)
})

watch(mediaStream, () => {
  if (!videoElement.value || !mediaStream.value) {
    videoPlaying.value = false
    showSuccessState.value = false
    return
  }
  videoElement.value.srcObject = mediaStream.value
  videoElement.value
    .play()
    .then(() => {
      console.log('[VideoPlayer] Stream is playing')
      videoPlaying.value = true
      showSuccessState.value = true
      if (successTimeoutId) clearTimeout(successTimeoutId)
      successTimeoutId = setTimeout(() => {
        showSuccessState.value = false
      }, 1000)
    })
    .catch((reason) => {
      const msg = `Failed to play stream. Reason: ${reason}`
      console.error(`[VideoPlayer] ${msg}`)
      videoPlaying.value = false
      showSuccessState.value = false
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

const shouldShowVerboseLoading = computed(() => {
  return widget.value.options.showVerboseLoading || showVerboseLoadingTemporary.value
})

const showLoadingOverlay = computed(() => {
  if (nameSelectedStream.value === undefined) return false
  if (!namesAvailableStreams.value.includes(nameSelectedStream.value)) return false
  if (showSuccessState.value) return true
  return !videoPlaying.value
})

const loadingMessage = computed(() => {
  const streamInfo = nameSelectedStream.value
    ? `'${nameSelectedStream.value} (${externalStreamId.value ?? 'unknown'})'`
    : ''
  if (showSuccessState.value) return 'Stream loaded'
  return (streamConnected.value ? 'Loading' : 'Connecting to') + ` stream ${streamInfo}`
})

const toggleVerboseLoading = (): void => {
  showVerboseLoadingTemporary.value = !showVerboseLoadingTemporary.value
}
</script>

<style scoped>
.video-widget {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transform: v-bind('transformStyle');
  position: relative;
}
video {
  height: 100%;
  width: 100%;
  position: absolute;
  top: 0;
  left: 0;
  object-fit: v-bind('widget.options.videoFitStyle');
}
.no-video-alert {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background-color: rgba(30, 40, 50, 0.95);
  text-align: center;
  padding: 1.5rem;
  color: white;
  overflow: hidden;
  position: relative;
  z-index: 1;
}
.loading-overlay {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background-color: rgba(30, 40, 50, 0.7);
  text-align: center;
  padding: 1rem;
  color: white;
  overflow: hidden;
  position: relative;
  z-index: 1;
}
.loading-text {
  font-size: 1rem;
  font-weight: 500;
  margin: 0;
  opacity: 0.9;
}
.verbose-status {
  margin-top: 1rem;
  padding: 0.75rem;
  background-color: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.status-line {
  font-size: 0.85rem;
  margin: 0.25rem 0;
  word-break: break-word;
  opacity: 0.85;
}
.status-label {
  font-weight: 600;
  opacity: 1;
}
.toggle-details-btn {
  opacity: 0.7;
  font-size: 0.75rem;
}
.toggle-details-btn:hover {
  opacity: 1;
}
.success-icon {
  animation: success-pop 0.3s ease-out;
}
@keyframes success-pop {
  0% {
    transform: scale(0.5);
    opacity: 0;
  }
  70% {
    transform: scale(1.1);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
.loading-complete-leave-active {
  transition: all 0.3s ease-out;
}
.loading-complete-leave-to {
  opacity: 0;
  transform: scale(0.95);
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

.aoi-config {
  background: rgba(0, 255, 0, 0.1);
  border-radius: 8px;
  padding: 16px;
  margin-top: 8px;
  border: 1px solid rgba(0, 255, 0, 0.3);
}

.hidden {
  display: none;
}

.video-container {
  position: absolute;
  width: 100%;
  height: 100%;
  cursor: crosshair;
}

.video-container.selecting-aoi {
  cursor: crosshair;
}

.aoi-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 5;
}

.aoi-rectangle {
  position: relative;
  box-sizing: border-box;
}

.aoi-label {
  position: absolute;
  top: -25px;
  left: 0;
  background: rgba(0, 255, 0, 0.8);
  color: black;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: bold;
  white-space: nowrap;
}

.roi-chart-overlay {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 10;
  pointer-events: none;
}

.roi-chart {
  border: 1px solid rgba(0, 255, 0, 0.5);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.8);
}

.chart-debug {
  color: white;
  font-size: 10px;
  background: rgba(0, 0, 0, 0.8);
  padding: 2px 4px;
  border-radius: 2px;
  margin-top: 2px;
}
</style>
