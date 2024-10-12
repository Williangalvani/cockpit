<template>
  <div class="canvas-container">
    <canvas ref="canvasRef" :width="width" :height="height"></canvas>
  </div>
</template>

<script lang="ts" setup>
import { WebRTCStats } from '@peermetrics/webrtc-stats'
import { onMounted, onUnmounted, ref, watch } from 'vue'

import { useVideoStore } from '@/stores/video'
import { WebRTCStatsEvent } from '@/types/video'
const videoStore = useVideoStore()

const props = defineProps({
  width: {
    type: Number,
    default: 110,
  },
  height: {
    type: Number,
    default: 140,
  },
  updateInterval: {
    type: Number,
    default: 20,
  },
  streamName: {
    type: String,
    default: '',
  },
})

const canvasRef = ref(null)
const data = ref([])
let animationFrameId = null
let intervalId = null
let bitrate = 0
let packetsLost = 0
let jitterBufferLatency = 0
let freezes = 0
let frozenTime = 0
let framedrops = 0
let framerate = 0

/**
 * Draws the line plots and text
 */
function draw(): void {
  const canvas = canvasRef.value
  const ctx = canvas.getContext('2d')
  const { width, height } = props

  ctx.clearRect(0, 0, width, height)

  // Draw line plot
  ctx.strokeStyle = 'rgb(0, 255, 0)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i < data.value.length; i++) {
    const x = (i / (data.value.length - 1)) * width
    const y = height - (data.value[i] / 100) * height
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  // Display current value
  const currentValue = data.value[data.value.length - 1] || 0
  ctx.fillStyle = 'rgb(0, 255, 0)'
  ctx.font = '12px Arial'
  ctx.fillText(`FPS: ${currentValue.toFixed(2)}`, 5, 15)
  ctx.fillStyle = 'yellow'
  ctx.fillText(`Bitrate: ${bitrate.toFixed(0)}kbps`, 5, 27)
  ctx.fillStyle = 'white'
  ctx.fillText(`Packets Lost: ${packetsLost}`, 5, 39)
  ctx.fillText(`Framedrops: ${framedrops}`, 5, 51)
  ctx.fillText(`Jitter(ms): ${jitterBufferLatency.toFixed(0)}`, 5, 63)
  ctx.fillText(`Freezes: ${freezes}(${frozenTime.toFixed(1)}s)`, 5, 75)

  animationFrameId = requestAnimationFrame(draw)
}
const webrtcStats = new WebRTCStats({ getStatsInterval: 250 })

/**
 * Updates the line plot with the current framerate
 * @returns {void}
 */
function update(): void {
  if (!props.mediaStream) return 0
  data.value.push(framerate)
  if (data.value.length > 100) data.value.shift()
}

// Monitor the active streams to add the connections to the WebRTC statistics
watch(videoStore.activeStreams, (streams): void => {
  Object.keys(streams).forEach((streamName) => {
    if (streamName !== props.streamName) return
    const session = streams[streamName]?.webRtcManager.session
    if (!session || !session.peerConnection) return
    if (webrtcStats.peersToMonitor[session.consumerId]) return
    webrtcStats.addConnection({
      pc: session.peerConnection, // RTCPeerConnection instance
      peerId: session.consumerId, // any string that helps you identify this peer,
      connectionId: session.id, // optional, an id that you can use to keep track of this connection
      remote: false, // optional, override the global remote flag
    })
  })
})

onMounted(() => {
  intervalId = setInterval(update, props.updateInterval)
  draw()
  webrtcStats.on('stats', (ev: WebRTCStatsEvent) => {
    try {
      const videoData = ev.data.video.inbound[0]
      if (videoData === undefined) return
      if (videoData.bitrate) {
        const newBitrate = videoData.bitrate / 1000
        bitrate = bitrate * 0.8 + newBitrate * 0.2
        jitterBufferLatency = (1000 * videoData.jitterBufferDelay) / videoData.jitterBufferEmittedCount
        packetsLost = videoData.packetsLost
        freezes = videoData.freezeCount
        frozenTime = videoData.totalFreezesDuration
        framedrops = videoData.framesDropped
        framerate = videoData.framesPerSecond
      }
    } catch (e) {
      console.error(e)
    }
  })
})

onUnmounted(() => {
  clearInterval(intervalId)
  cancelAnimationFrame(animationFrameId)
})
</script>

<style scoped>
.canvas-container {
  position: absolute;
  top: 50px;
  left: 10px;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 2;
}
</style>
