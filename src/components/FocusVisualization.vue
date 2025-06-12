<template>
  <div class="focus-visualization">
    <div class="chart-header">
      <h3>Focus Sharpness vs Position</h3>
      <div class="data-info">{{ focusHistory.length }} data points</div>
    </div>
    <canvas
      ref="canvas"
      :width="width"
      :height="height"
      class="chart-canvas"
    />
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'

interface FocusPoint {
  position: number
  variance: number
}

interface Props {
  width: number
  height: number
  focusHistory: FocusPoint[]
  currentPosition: number
  bestPosition: number
  isAutoFocusing: boolean
  autoFocusPhase: string
}

const props = defineProps<Props>()
const canvas = ref<HTMLCanvasElement>()

// Just watch the focus history and redraw - no processing, no filtering
watch(() => props.focusHistory, () => {
  console.log(`[FocusChart] Focus history changed, redrawing with ${props.focusHistory.length} points`)
  nextTick(() => drawChart())
}, { deep: true })

// Redraw when dimensions change
watch([() => props.width, () => props.height], () => {
  nextTick(() => drawChart())
})

function drawChart() {
  if (!canvas.value) return
  
  const ctx = canvas.value.getContext('2d')
  if (!ctx) return
  
  const { width, height } = props
  
  // Clear canvas
  ctx.clearRect(0, 0, width, height)
  
  // Background
  ctx.fillStyle = '#2b2b2b'
  ctx.fillRect(0, 0, width, height)
  
  // Setup margins
  const margin = { top: 20, right: 20, bottom: 40, left: 60 }
  const chartWidth = width - margin.left - margin.right
  const chartHeight = height - margin.top - margin.bottom
  
  const dataPoints = props.focusHistory
  console.log(`[FocusChart] Drawing with ${dataPoints.length} points:`, dataPoints)
  
  if (dataPoints.length === 0) {
    // Show empty state
    ctx.fillStyle = '#888'
    ctx.font = '16px Arial'
    ctx.textAlign = 'center'
    ctx.fillText('No data yet - start auto-focus to see plot', width / 2, height / 2)
    return
  }
  
  // Find data ranges
  const minPos = 0
  const maxPos = 100
  const minVar = Math.min(...dataPoints.map(p => p.variance))
  const maxVar = Math.max(...dataPoints.map(p => p.variance))
  const varRange = maxVar - minVar || 1
  
  // Scale functions
  const scaleX = (pos: number) => margin.left + (pos / 100) * chartWidth
  const scaleY = (variance: number) => margin.top + chartHeight - ((variance - minVar) / varRange) * chartHeight
  
  // Draw grid
  ctx.strokeStyle = '#444'
  ctx.lineWidth = 1
  
  // Vertical grid lines (positions)
  for (let pos = 0; pos <= 100; pos += 20) {
    const x = scaleX(pos)
    ctx.beginPath()
    ctx.moveTo(x, margin.top)
    ctx.lineTo(x, margin.top + chartHeight)
    ctx.stroke()
  }
  
  // Horizontal grid lines (variance)
  for (let i = 0; i <= 5; i++) {
    const variance = minVar + (i / 5) * varRange
    const y = scaleY(variance)
    ctx.beginPath()
    ctx.moveTo(margin.left, y)
    ctx.lineTo(margin.left + chartWidth, y)
    ctx.stroke()
  }
  
  // Draw axes
  ctx.strokeStyle = '#888'
  ctx.lineWidth = 2
  ctx.beginPath()
  // X-axis
  ctx.moveTo(margin.left, margin.top + chartHeight)
  ctx.lineTo(margin.left + chartWidth, margin.top + chartHeight)
  // Y-axis
  ctx.moveTo(margin.left, margin.top)
  ctx.lineTo(margin.left, margin.top + chartHeight)
  ctx.stroke()
  
  // Draw axis labels
  ctx.fillStyle = '#ccc'
  ctx.font = '12px Arial'
  ctx.textAlign = 'center'
  
  // X-axis labels
  for (let pos = 0; pos <= 100; pos += 20) {
    const x = scaleX(pos)
    ctx.fillText(`${pos}%`, x, height - 10)
  }
  
  // Y-axis labels
  ctx.textAlign = 'right'
  for (let i = 0; i <= 5; i++) {
    const variance = minVar + (i / 5) * varRange
    const y = scaleY(variance)
    ctx.fillText(variance.toFixed(0), margin.left - 10, y + 4)
  }
  
  // Axis titles
  ctx.textAlign = 'center'
  ctx.fillText('Focus Position (%)', width / 2, height - 5)
  
  ctx.save()
  ctx.translate(15, height / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.fillText('Sharpness (variance)', 0, 0)
  ctx.restore()
  
  // Draw data line connecting points in chronological order (as they were measured)
  if (dataPoints.length > 1) {
    ctx.strokeStyle = '#4CAF50'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    
    const first = dataPoints[0]
    ctx.moveTo(scaleX(first.position), scaleY(first.variance))
    
    for (let i = 1; i < dataPoints.length; i++) {
      const point = dataPoints[i]
      ctx.lineTo(scaleX(point.position), scaleY(point.variance))
    }
    ctx.stroke()
  }
  
  // Draw data points in chronological order
  for (const point of dataPoints) {
    const x = scaleX(point.position)
    const y = scaleY(point.variance)
    
    // Point background
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(x, y, 5, 0, 2 * Math.PI)
    ctx.fill()
    
    // Point foreground
    ctx.fillStyle = '#4CAF50'
    ctx.beginPath()
    ctx.arc(x, y, 3, 0, 2 * Math.PI)
    ctx.fill()
  }
  
  console.log(`[FocusChart] Drew chart with ${dataPoints.length} points`)
}

onMounted(() => {
  console.log('[FocusChart] Component mounted with props:', {
    focusHistoryLength: props.focusHistory?.length || 0,
    focusHistory: props.focusHistory,
    currentPosition: props.currentPosition,
    bestPosition: props.bestPosition,
    autoFocusPhase: props.autoFocusPhase
  })
  nextTick(() => drawChart())
})

// Watch all props to debug what's being passed
watch(() => [props.focusHistory, props.currentPosition, props.bestPosition, props.autoFocusPhase], 
  ([focusHistory, currentPosition, bestPosition, autoFocusPhase]) => {
    console.log('[FocusChart] Props updated:', {
      focusHistoryLength: Array.isArray(focusHistory) ? focusHistory.length : 0,
      currentPosition,
      bestPosition,
      autoFocusPhase
    })
  }, { deep: true }
)
</script>

<style scoped>
.focus-visualization {
  background: #1e1e1e;
  border-radius: 8px;
  padding: 16px;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.chart-header h3 {
  color: #fff;
  margin: 0;
  font-size: 16px;
}

.data-info {
  color: #888;
  font-size: 12px;
}

.chart-canvas {
  border: 1px solid #444;
  border-radius: 4px;
}
</style> 