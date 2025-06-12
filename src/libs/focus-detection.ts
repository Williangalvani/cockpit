/**
 * Focus detection and auto-focus utilities using Laplacian variance
 */

import { setDataLakeVariableData } from "./actions/data-lake"

export interface FocusSettings {
  threshold: number
  updateInterval: number
  autoFocusStepSize: number // Percentage of focus range (0-100)
  autoFocusWaitFrames: number // Frames to wait after focus change
  // Area of Interest settings (relative coordinates 0-1)
  aoiEnabled: boolean
  aoiX1: number // X coordinate of first corner (0-1)
  aoiY1: number // Y coordinate of first corner (0-1)
  aoiX2: number // X coordinate of second corner (0-1)
  aoiY2: number // Y coordinate of second corner (0-1)
}

export interface FocusState {
  currentValue: number
  isInFocus: boolean
  history: number[]
  isAutoFocusing: boolean
  autoFocusDirection: 'in' | 'out'
  autoFocusPosition: number // Current focus position (0-100)
  autoFocusHistory: Array<{ position: number; variance: number }>
  autoFocusWaitCounter: number
  autoFocusBestPosition: number
  autoFocusBestVariance: number
  autoFocusPhase: 'first-direction' | 'second-direction' | 'fine-tuning' | 'completed'
  autoFocusStartPosition: number
  autoFocusFirstDirectionBest: { position: number; variance: number }
  fineTuningRange: { min: number; max: number }
  fineTuningStepSize: number
  fineTuningSteps: number
  fineTuningDirectionChanges: number
}

// Constants
const FOCUS_CONSTANTS = {
  // Default settings
  DEFAULT_THRESHOLD: 6000,
  DEFAULT_UPDATE_INTERVAL: 500,
  DEFAULT_AUTO_FOCUS_STEP_SIZE: 10,
  DEFAULT_AUTO_FOCUS_WAIT_FRAMES: 3,
  DEFAULT_AUTO_FOCUS_START_POSITION: 50,
  
  // Focus limits
  MIN_FOCUS_POSITION: 0,
  MAX_FOCUS_POSITION: 100,
  
  // History and smoothing
  MAX_HISTORY_LENGTH: 10,
  
  // Auto-focus thresholds and factors
  IMPROVEMENT_THRESHOLD: 1.4, // 40% improvement required
  DECREASE_THRESHOLD: 0.8, // 20% decrease to confirm peak
  
  // Fine-tuning parameters
  FINE_TUNING_RANGE_SIZE: 10, // ±10% around best position
  FINE_TUNING_STEP_FACTOR: 0.2, // 20% of original step size
  MAX_FINE_TUNING_STEPS: 15,
  MAX_DIRECTION_CHANGES: 4,
  GRADIENT_THRESHOLD: 2,
  CONVERGENCE_IMPROVEMENT_THRESHOLD: 0.005, // 0.5%
  
  // Laplacian kernel
  LAPLACIAN_KERNEL: [
    [-1, -1, -1],
    [-1,  8, -1],
    [-1, -1, -1]
  ],
  
  // RGB to grayscale conversion weights
  GRAYSCALE_WEIGHTS: {
    R: 0.299,
    G: 0.587,
    B: 0.114
  }
} as const

interface FocusRange {
  min: number
  max: number
}

interface FocusMeasurement {
  position: number
  variance: number
}

export class FocusDetector {
  private state: FocusState
  private settings: FocusSettings

  constructor(settings: Partial<FocusSettings> = {}) {
    this.settings = this.initializeSettings(settings)
    this.state = this.initializeState()
  }

  private initializeSettings(settings: Partial<FocusSettings>): FocusSettings {
    return {
      threshold: FOCUS_CONSTANTS.DEFAULT_THRESHOLD,
      updateInterval: FOCUS_CONSTANTS.DEFAULT_UPDATE_INTERVAL,
      autoFocusStepSize: FOCUS_CONSTANTS.DEFAULT_AUTO_FOCUS_STEP_SIZE,
      autoFocusWaitFrames: FOCUS_CONSTANTS.DEFAULT_AUTO_FOCUS_WAIT_FRAMES,
      aoiEnabled: false,
      aoiX1: 0,
      aoiY1: 0,
      aoiX2: 1,
      aoiY2: 1,
      ...settings
    }
  }

  private initializeState(): FocusState {
    return {
      currentValue: 0,
      isInFocus: false,
      history: [],
      isAutoFocusing: false,
      autoFocusDirection: 'in',
      autoFocusPosition: FOCUS_CONSTANTS.DEFAULT_AUTO_FOCUS_START_POSITION,
      autoFocusHistory: [],
      autoFocusWaitCounter: 0,
      autoFocusBestPosition: FOCUS_CONSTANTS.DEFAULT_AUTO_FOCUS_START_POSITION,
      autoFocusBestVariance: 0,
      autoFocusPhase: 'first-direction',
      autoFocusStartPosition: FOCUS_CONSTANTS.DEFAULT_AUTO_FOCUS_START_POSITION,
      autoFocusFirstDirectionBest: { position: FOCUS_CONSTANTS.DEFAULT_AUTO_FOCUS_START_POSITION, variance: 0 },
      fineTuningRange: { min: FOCUS_CONSTANTS.MIN_FOCUS_POSITION, max: FOCUS_CONSTANTS.MAX_FOCUS_POSITION },
      fineTuningStepSize: Math.max(1, Math.round(FOCUS_CONSTANTS.DEFAULT_AUTO_FOCUS_STEP_SIZE * FOCUS_CONSTANTS.FINE_TUNING_STEP_FACTOR)),
      fineTuningSteps: 0,
      fineTuningDirectionChanges: 0
    }
  }

  /**
   * Calculate Laplacian variance for focus detection
   */
  calculateLaplacianVariance(imageData: ImageData): number {
    const { data, width, height } = imageData
    const processingRegion = this.getProcessingRegion(width, height)
    
    const grayscaleData = this.convertToGrayscale(data, width, height)
    const laplacianData = this.applyLaplacianFilter(grayscaleData, width, height, processingRegion)
    
    return this.calculateVariance(laplacianData, width, height, processingRegion)
  }

  private getProcessingRegion(width: number, height: number): FocusRange & { startX: number; startY: number; endX: number; endY: number } {
    if (!this.settings.aoiEnabled) {
      return {
        startX: 0,
        startY: 0,
        endX: width,
        endY: height,
        min: 0,
        max: width * height
      }
    }

    // Handle potentially flipped coordinates
    const x1 = Math.min(this.settings.aoiX1, this.settings.aoiX2)
    const y1 = Math.min(this.settings.aoiY1, this.settings.aoiY2)
    const x2 = Math.max(this.settings.aoiX1, this.settings.aoiX2)
    const y2 = Math.max(this.settings.aoiY1, this.settings.aoiY2)
    
    const startX = Math.max(1, Math.min(Math.floor(x1 * width), width - 2))
    const startY = Math.max(1, Math.min(Math.floor(y1 * height), height - 2))
    const endX = Math.max(startX + 1, Math.min(Math.floor(x2 * width), width - 1))
    const endY = Math.max(startY + 1, Math.min(Math.floor(y2 * height), height - 1))
    
    return { startX, startY, endX, endY, min: 0, max: width * height }
  }

  private convertToGrayscale(data: Uint8ClampedArray, width: number, height: number): Float32Array {
    const grayscale = new Float32Array(width * height)
    const { R, G, B } = FOCUS_CONSTANTS.GRAYSCALE_WEIGHTS
    
    for (let i = 0; i < data.length; i += 4) {
      const pixelIndex = i / 4
      grayscale[pixelIndex] = R * data[i] + G * data[i + 1] + B * data[i + 2]
    }
    
    return grayscale
  }

  private applyLaplacianFilter(
    grayscale: Float32Array, 
    width: number, 
    height: number, 
    region: { startX: number; startY: number; endX: number; endY: number }
  ): Float32Array {
    const laplacian = new Float32Array(width * height)
    const { startX, startY, endX, endY } = region
    
    for (let y = Math.max(1, startY); y < Math.min(height - 1, endY); y++) {
      for (let x = Math.max(1, startX); x < Math.min(width - 1, endX); x++) {
        const centerIdx = y * width + x
        let laplacianValue = 0
        
        // Apply 3x3 Laplacian kernel
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const pixelIdx = (y + ky) * width + (x + kx)
            const kernelValue = FOCUS_CONSTANTS.LAPLACIAN_KERNEL[ky + 1][kx + 1]
            laplacianValue += kernelValue * grayscale[pixelIdx]
          }
        }
        
        laplacian[centerIdx] = laplacianValue
      }
    }
    
    return laplacian
  }

  private calculateVariance(
    laplacian: Float32Array, 
    width: number, 
    height: number, 
    region: { startX: number; startY: number; endX: number; endY: number }
  ): number {
    const { startX, startY, endX, endY } = region
    let mean = 0
    let count = 0
    
    // Calculate mean
    for (let y = Math.max(1, startY); y < Math.min(height - 1, endY); y++) {
      for (let x = Math.max(1, startX); x < Math.min(width - 1, endX); x++) {
        const idx = y * width + x
        mean += laplacian[idx]
        count++
      }
    }
    
    if (count === 0) return 0
    mean /= count
    
    // Calculate variance
    let variance = 0
    for (let y = Math.max(1, startY); y < Math.min(height - 1, endY); y++) {
      for (let x = Math.max(1, startX); x < Math.min(width - 1, endX); x++) {
        const idx = y * width + x
        variance += Math.pow(laplacian[idx] - mean, 2)
      }
    }
    
    return variance / count
  }

  /**
   * Process a new focus measurement
   */
  processFocusMeasurement(variance: number): void {
    this.updateFocusHistory(variance)
    this.updateFocusState()
    
    if (this.state.isAutoFocusing) {
      this.processAutoFocus(variance)
    }
  }

  private updateFocusHistory(variance: number): void {
    this.state.currentValue = variance
    this.state.history.push(variance)
    
    if (this.state.history.length > FOCUS_CONSTANTS.MAX_HISTORY_LENGTH) {
      this.state.history.shift()
    }
  }

  private updateFocusState(): void {
    const avgFocus = this.state.history.reduce((sum, val) => sum + val, 0) / this.state.history.length
    this.state.isInFocus = avgFocus > this.settings.threshold
  }

  private processAutoFocus(variance: number): void {
    if (this.isWaitingForFocusChange()) {
      this.state.autoFocusWaitCounter--
      return
    }

    this.recordFocusMeasurement(variance)
    this.updateBestPosition(variance)

    switch (this.state.autoFocusPhase) {
      case 'first-direction':
        this.processDirectionalSearch(variance, true)
        break
      case 'second-direction':
        this.processDirectionalSearch(variance, false)
        break
      case 'fine-tuning':
        this.processFineTuning(variance)
        break
    }
  }

  private isWaitingForFocusChange(): boolean {
    return this.state.autoFocusWaitCounter > 0
  }

  private recordFocusMeasurement(variance: number): void {
    this.state.autoFocusHistory.push({
      position: this.state.autoFocusPosition,
      variance: variance
    })
  }

  private updateBestPosition(variance: number): void {
    if (variance > this.state.autoFocusBestVariance * FOCUS_CONSTANTS.IMPROVEMENT_THRESHOLD) {
      this.state.autoFocusBestVariance = variance
      this.state.autoFocusBestPosition = this.state.autoFocusPosition
      this.logNewBestPosition(variance)
    }
  }

  private processDirectionalSearch(variance: number, isFirstDirection: boolean): void {
    if (this.hasFoundLocalMaximum()) {
      this.handleDirectionalPeakFound(isFirstDirection)
      return
    }

    const nextPosition = this.calculateNextDirectionalPosition()
    
    if (this.isPositionOutOfBounds(nextPosition)) {
      this.handleDirectionalLimitReached(isFirstDirection)
      return
    }

    this.goToFocusPosition(nextPosition)
  }

  private hasFoundLocalMaximum(): boolean {
    if (this.state.autoFocusHistory.length < 2) return false
    
    const current = this.state.autoFocusHistory[this.state.autoFocusHistory.length - 1]
    const previous = this.state.autoFocusHistory[this.state.autoFocusHistory.length - 2]
    
    return current.variance < previous.variance * FOCUS_CONSTANTS.DECREASE_THRESHOLD
  }

  private calculateNextDirectionalPosition(): number {
    const stepSize = this.state.autoFocusDirection === 'in' 
      ? this.settings.autoFocusStepSize 
      : -this.settings.autoFocusStepSize
    
    return this.state.autoFocusPosition + stepSize
  }

  private isPositionOutOfBounds(position: number): boolean {
    return position <= FOCUS_CONSTANTS.MIN_FOCUS_POSITION || position >= FOCUS_CONSTANTS.MAX_FOCUS_POSITION
  }

  private handleDirectionalPeakFound(isFirstDirection: boolean): void {
    const current = this.state.autoFocusHistory[this.state.autoFocusHistory.length - 1]
    const previous = this.state.autoFocusHistory[this.state.autoFocusHistory.length - 2]
    
    console.log(`[FocusDetector] ${isFirstDirection ? 'First' : 'Second'} direction peak found. Current: ${current.variance.toFixed(2)}, Previous: ${previous.variance.toFixed(2)}`)
    
    if (isFirstDirection) {
      this.saveFirstDirectionBest()
      this.startSecondDirection()
    } else {
      this.finishBidirectionalSearch()
    }
  }

  private handleDirectionalLimitReached(isFirstDirection: boolean): void {
    const direction = this.state.autoFocusDirection === 'in' ? 'upper' : 'lower'
    console.log(`[FocusDetector] Reached ${direction} limit${isFirstDirection ? ', switching to second direction' : ' in second direction'}`)
    
    if (isFirstDirection) {
      this.saveFirstDirectionBest()
      this.startSecondDirection()
    } else {
      this.finishBidirectionalSearch()
    }
  }

  private saveFirstDirectionBest(): void {
    this.state.autoFocusFirstDirectionBest = {
      position: this.state.autoFocusBestPosition,
      variance: this.state.autoFocusBestVariance
    }
  }

  private startSecondDirection(): void {
    const { position, variance } = this.state.autoFocusFirstDirectionBest
    console.log(`[FocusDetector] Starting second direction search. First direction best: ${position}% (${variance.toFixed(2)})`)
    
    this.state.autoFocusPhase = 'second-direction'
    this.state.autoFocusDirection = this.state.autoFocusDirection === 'in' ? 'out' : 'in'
    this.goToFocusPosition(this.state.autoFocusStartPosition)
  }

  private finishBidirectionalSearch(): void {
    const finalBest = this.determineFinalBestPosition()
    this.logBidirectionalResults(finalBest)
    this.updateFinalBestPosition(finalBest)
    this.startFineTuning(finalBest.position)
  }

  private determineFinalBestPosition(): FocusMeasurement {
    return this.state.autoFocusBestVariance > this.state.autoFocusFirstDirectionBest.variance
      ? { position: this.state.autoFocusBestPosition, variance: this.state.autoFocusBestVariance }
      : this.state.autoFocusFirstDirectionBest
  }

  private logBidirectionalResults(finalBest: FocusMeasurement): void {
    console.log(`[FocusDetector] Bidirectional search complete.`)
    console.log(`[FocusDetector] First direction best: ${this.state.autoFocusFirstDirectionBest.position}% (${this.state.autoFocusFirstDirectionBest.variance.toFixed(2)})`)
    console.log(`[FocusDetector] Second direction best: ${this.state.autoFocusBestPosition}% (${this.state.autoFocusBestVariance.toFixed(2)})`)
    console.log(`[FocusDetector] Final best position: ${finalBest.position}% (${finalBest.variance.toFixed(2)})`)
  }

  private updateFinalBestPosition(finalBest: FocusMeasurement): void {
    this.state.autoFocusBestPosition = finalBest.position
    this.state.autoFocusBestVariance = finalBest.variance
  }

  private startFineTuning(bestPosition: number): void {
    const range = this.calculateFineTuningRange(bestPosition)
    const stepSize = this.calculateFineTuningStepSize()
    
    this.initializeFineTuningState(range, stepSize)
    this.logFineTuningStart(bestPosition, range, stepSize)
    this.goToFocusPosition(bestPosition)
  }

  private calculateFineTuningRange(bestPosition: number): FocusRange {
    const halfRange = FOCUS_CONSTANTS.FINE_TUNING_RANGE_SIZE
    return {
      min: Math.max(FOCUS_CONSTANTS.MIN_FOCUS_POSITION, bestPosition - halfRange),
      max: Math.min(FOCUS_CONSTANTS.MAX_FOCUS_POSITION, bestPosition + halfRange)
    }
  }

  private calculateFineTuningStepSize(): number {
    return Math.max(1, Math.round(this.settings.autoFocusStepSize * FOCUS_CONSTANTS.FINE_TUNING_STEP_FACTOR))
  }

  private initializeFineTuningState(range: FocusRange, stepSize: number): void {
    this.state.fineTuningRange = range
    this.state.fineTuningStepSize = stepSize
    this.state.autoFocusPhase = 'fine-tuning'
    this.state.autoFocusDirection = 'in'
    this.state.fineTuningSteps = 0
    this.state.fineTuningDirectionChanges = 0
  }

  private logFineTuningStart(bestPosition: number, range: FocusRange, stepSize: number): void {
    const rangeSize = FOCUS_CONSTANTS.FINE_TUNING_RANGE_SIZE
    console.log(`[FocusDetector] Starting fine-tuning phase`)
    console.log(`[FocusDetector] Range: ${range.min}% - ${range.max}% (±${rangeSize}% around ${bestPosition}%)`)
    console.log(`[FocusDetector] Fine-tuning step size: ${stepSize}% (was ${this.settings.autoFocusStepSize}%)`)
  }

  private processFineTuning(variance: number): void {
    this.state.fineTuningSteps++
    this.updateBestPosition(variance)

    if (this.shouldStopFineTuning()) {
      this.finishFineTuning()
      return
    }

    if (this.needsInitialProbeStep()) {
      this.takeInitialProbeStep()
      return
    }

    const gradient = this.calculateGradient()
    this.logFineTuningStep(gradient)

    if (this.hasConverged(gradient)) {
      this.finishFineTuning()
      return
    }

    const nextPosition = this.calculateNextFineTuningPosition(gradient)
    
    if (this.wouldExceedFineTuningRange(nextPosition)) {
      this.finishFineTuning()
      return
    }

    this.moveToNextFineTuningPosition(nextPosition, gradient)
  }

  private shouldStopFineTuning(): boolean {
    const reachedMaxSteps = this.state.fineTuningSteps >= FOCUS_CONSTANTS.MAX_FINE_TUNING_STEPS
    const tooManyDirectionChanges = this.state.fineTuningDirectionChanges >= FOCUS_CONSTANTS.MAX_DIRECTION_CHANGES

    if (reachedMaxSteps) {
      console.log(`[FocusDetector] Fine-tuning: Max steps reached (${FOCUS_CONSTANTS.MAX_FINE_TUNING_STEPS}). Best position: ${this.state.autoFocusBestPosition}%`)
    }
    
    if (tooManyDirectionChanges) {
      console.log(`[FocusDetector] Fine-tuning: Too many direction changes (${FOCUS_CONSTANTS.MAX_DIRECTION_CHANGES}). Converged at: ${this.state.autoFocusBestPosition}%`)
    }

    return reachedMaxSteps || tooManyDirectionChanges
  }

  private needsInitialProbeStep(): boolean {
    return this.state.autoFocusHistory.length < 2
  }

  private takeInitialProbeStep(): void {
    const nextPosition = Math.min(
      this.state.fineTuningRange.max, 
      this.state.autoFocusPosition + this.state.fineTuningStepSize
    )
    console.log(`[FocusDetector] Fine-tuning: Taking initial probe step to ${nextPosition}%`)
    this.goToFocusPosition(nextPosition)
  }

  private calculateGradient(): number {
    const current = this.state.autoFocusHistory[this.state.autoFocusHistory.length - 1]
    const previous = this.state.autoFocusHistory[this.state.autoFocusHistory.length - 2]
    
    const deltaVariance = current.variance - previous.variance
    const deltaPosition = current.position - previous.position
    
    return deltaPosition !== 0 ? deltaVariance / deltaPosition : 0
  }

  private hasConverged(gradient: number): boolean {
    const current = this.state.autoFocusHistory[this.state.autoFocusHistory.length - 1]
    const previous = this.state.autoFocusHistory[this.state.autoFocusHistory.length - 2]
    
    const relativeImprovement = Math.abs(current.variance - previous.variance) / Math.max(current.variance, previous.variance)
    const gradientSmall = Math.abs(gradient) < FOCUS_CONSTANTS.GRADIENT_THRESHOLD
    const improvementSmall = relativeImprovement < FOCUS_CONSTANTS.CONVERGENCE_IMPROVEMENT_THRESHOLD

    if (gradientSmall && improvementSmall) {
      console.log(`[FocusDetector] Fine-tuning: Converged (gradient=${gradient.toFixed(2)} < ${FOCUS_CONSTANTS.GRADIENT_THRESHOLD} AND improvement=${(relativeImprovement*100).toFixed(2)}% < ${(FOCUS_CONSTANTS.CONVERGENCE_IMPROVEMENT_THRESHOLD*100).toFixed(1)}%). Best: ${this.state.autoFocusBestPosition}%`)
      return true
    }

    return false
  }

  private calculateNextFineTuningPosition(gradient: number): number {
    const stepDirection = gradient > 0 ? 1 : -1
    return this.state.autoFocusPosition + (stepDirection * this.state.fineTuningStepSize)
  }

  private wouldExceedFineTuningRange(nextPosition: number): boolean {
    const wouldExceed = nextPosition < this.state.fineTuningRange.min || nextPosition > this.state.fineTuningRange.max
    
    if (wouldExceed) {
      console.log(`[FocusDetector] Fine-tuning: Would exceed range (${nextPosition}% outside ${this.state.fineTuningRange.min}%-${this.state.fineTuningRange.max}%). Converged at: ${this.state.autoFocusBestPosition}%`)
    }
    
    return wouldExceed
  }

  private moveToNextFineTuningPosition(nextPosition: number, gradient: number): void {
    this.trackDirectionChanges(gradient)
    
    const direction = gradient > 0 ? 'up' : 'down'
    console.log(`[FocusDetector] Fine-tuning: Moving ${direction} to ${nextPosition}%`)
    this.goToFocusPosition(nextPosition)
  }

  private trackDirectionChanges(gradient: number): void {
    if (this.state.fineTuningSteps <= 1) return

    const current = this.state.autoFocusHistory[this.state.autoFocusHistory.length - 1]
    const previous = this.state.autoFocusHistory[this.state.autoFocusHistory.length - 2]
    
    const newStepDirection = gradient > 0 ? 1 : -1
    const previousStepDirection = (current.position - previous.position) > 0 ? 1 : -1
    
    if (newStepDirection !== previousStepDirection) {
      this.state.fineTuningDirectionChanges++
      console.log(`[FocusDetector] Fine-tuning: Direction change detected (#${this.state.fineTuningDirectionChanges})`)
    }
  }

  private logFineTuningStep(gradient: number): void {
    console.log(`[FocusDetector] Fine-tuning step ${this.state.fineTuningSteps}: gradient=${gradient.toFixed(2)}, direction changes=${this.state.fineTuningDirectionChanges}`)
  }

  private finishFineTuning(): void {
    this.state.autoFocusPhase = 'completed'
    console.log(`[FocusDetector] Fine-tuning complete. Final position: ${this.state.autoFocusBestPosition}% (variance: ${this.state.autoFocusBestVariance.toFixed(2)})`)
    this.goToFocusPosition(this.state.autoFocusBestPosition)
    this.stopAutoFocus()
  }

  /**
   * Start auto-focus process with bidirectional search
   */
  startAutoFocus(): void {
    this.initializeAutoFocusState()
    this.logAutoFocusStart()
  }

  private initializeAutoFocusState(): void {
    this.state.isAutoFocusing = true
    this.state.autoFocusDirection = 'in'
    this.state.autoFocusHistory = []
    this.state.autoFocusWaitCounter = 0
    this.state.autoFocusBestVariance = 0
    this.state.autoFocusBestPosition = this.state.autoFocusPosition
    this.state.autoFocusPhase = 'first-direction'
    this.state.autoFocusStartPosition = this.state.autoFocusPosition
    this.state.autoFocusFirstDirectionBest = { position: this.state.autoFocusPosition, variance: 0 }
    this.state.fineTuningRange = { min: FOCUS_CONSTANTS.MIN_FOCUS_POSITION, max: FOCUS_CONSTANTS.MAX_FOCUS_POSITION }
    this.state.fineTuningStepSize = this.calculateFineTuningStepSize()
    this.state.fineTuningSteps = 0
    this.state.fineTuningDirectionChanges = 0
  }

  private logAutoFocusStart(): void {
    console.log('[FocusDetector] Starting bidirectional auto-focus from position:', this.state.autoFocusPosition)
    console.log('[FocusDetector] Phase 1: Searching in direction:', this.state.autoFocusDirection)
  }

  private logNewBestPosition(variance: number): void {
    console.log(`[FocusDetector] New best position found: ${this.state.autoFocusPosition}% (variance: ${variance.toFixed(2)})`)
  }

  /**
   * Stop auto-focus process
   */
  stopAutoFocus(): void {
    const wasAutoFocusing = this.state.isAutoFocusing
    this.state.isAutoFocusing = false
    
    if (wasAutoFocusing && this.state.autoFocusBestVariance > 0) {
      this.returnToBestPosition()
    } else {
      console.log('[FocusDetector] Auto-focus stopped at position:', this.state.autoFocusPosition)
    }
  }

  private returnToBestPosition(): void {
    const currentPosition = this.state.autoFocusPosition
    const bestPosition = this.state.autoFocusBestPosition
    
    if (bestPosition !== currentPosition) {
      console.log(`[FocusDetector] Auto-focus stopped. Returning to best position: ${bestPosition}% (was at ${currentPosition}%)`)
      console.log(`[FocusDetector] Best variance: ${this.state.autoFocusBestVariance.toFixed(2)}`)
      this.goToFocusPosition(bestPosition)
    } else {
      console.log(`[FocusDetector] Auto-focus stopped at best position: ${currentPosition}%`)
    }
  }

  /**
   * Set focus to specific position
   */
  private goToFocusPosition(position: number): void {
    const clampedPosition = Math.max(FOCUS_CONSTANTS.MIN_FOCUS_POSITION, Math.min(FOCUS_CONSTANTS.MAX_FOCUS_POSITION, position))
    console.log(`[FocusDetector] Setting focus to position: ${clampedPosition}%`)
    
    this.state.autoFocusPosition = clampedPosition
    this.state.autoFocusWaitCounter = this.settings.autoFocusWaitFrames
    
    setDataLakeVariableData('camera-focus-absolute', clampedPosition)
  }

  /**
   * Update settings
   */
  updateSettings(newSettings: Partial<FocusSettings>): void {
    this.settings = { ...this.settings, ...newSettings }
  }

  /**
   * Get current state
   */
  getState(): Readonly<FocusState> {
    return { ...this.state }
  }

  /**
   * Get current settings
   */
  getSettings(): Readonly<FocusSettings> {
    return { ...this.settings }
  }

  /**
   * Reset focus detector state
   */
  reset(): void {
    this.state.currentValue = 0
    this.state.isInFocus = false
    this.state.history = []
    this.stopAutoFocus()
  }

  /**
   * Manually set focus position (for manual control)
   */
  setManualFocusPosition(position: number): void {
    if (this.state.isAutoFocusing) {
      this.stopAutoFocus()
    }
    const clampedPosition = Math.max(FOCUS_CONSTANTS.MIN_FOCUS_POSITION, Math.min(FOCUS_CONSTANTS.MAX_FOCUS_POSITION, position))
    this.goToFocusPosition(clampedPosition)
  }
} 