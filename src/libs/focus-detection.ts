/**
 * Focus detection and auto-focus utilities using Laplacian variance
 */

import { setDataLakeVariableData } from "./actions/data-lake"

export interface FocusSettings {
  threshold: number
  updateInterval: number
  autoFocusStepSize: number // Percentage of focus range (0-100)
  autoFocusWaitFrames: number // Frames to wait after focus change
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

export class FocusDetector {
  private state: FocusState
  private settings: FocusSettings

  constructor(settings: Partial<FocusSettings> = {}) {
    this.settings = {
      threshold: 6000,
      updateInterval: 500,
      autoFocusStepSize: 10,
      autoFocusWaitFrames: 3,
      ...settings
    }

    this.state = {
      currentValue: 0,
      isInFocus: false,
      history: [],
      isAutoFocusing: false,
      autoFocusDirection: 'in',
      autoFocusPosition: 50, // Start at middle
      autoFocusHistory: [],
      autoFocusWaitCounter: 0,
      autoFocusBestPosition: 50,
      autoFocusBestVariance: 0,
      autoFocusPhase: 'first-direction',
      autoFocusStartPosition: 50,
      autoFocusFirstDirectionBest: { position: 50, variance: 0 },
      fineTuningRange: { min: 0, max: 100 },
      fineTuningStepSize: 2,
      fineTuningSteps: 0,
      fineTuningDirectionChanges: 0
    }
  }

  /**
   * Calculate Laplacian variance for focus detection
   * @param imageData - ImageData from canvas
   * @returns Laplacian variance value
   */
  calculateLaplacianVariance(imageData: ImageData): number {
    const { data, width, height } = imageData
    const gray = new Float32Array(width * height)
    
    // Convert to grayscale
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]
      const g = data[i + 1] 
      const b = data[i + 2]
      gray[i / 4] = 0.299 * r + 0.587 * g + 0.114 * b
    }
    
    // Apply Laplacian filter
    const laplacian = new Float32Array(width * height)
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x
        const laplacianValue = 
          -1 * gray[(y - 1) * width + (x - 1)] +
          -1 * gray[(y - 1) * width + x] +
          -1 * gray[(y - 1) * width + (x + 1)] +
          -1 * gray[y * width + (x - 1)] +
           8 * gray[y * width + x] +
          -1 * gray[y * width + (x + 1)] +
          -1 * gray[(y + 1) * width + (x - 1)] +
          -1 * gray[(y + 1) * width + x] +
          -1 * gray[(y + 1) * width + (x + 1)]
        
        laplacian[idx] = laplacianValue
      }
    }
    
    // Calculate variance
    let mean = 0
    let count = 0
    for (let i = 0; i < laplacian.length; i++) {
      mean += laplacian[i]
      count++
    }
    mean /= count
    
    let variance = 0
    for (let i = 0; i < laplacian.length; i++) {
      variance += Math.pow(laplacian[i] - mean, 2)
    }
    variance /= count
    
    return variance
  }

  /**
   * Process a new focus measurement
   * @param variance - Laplacian variance value
   */
  processFocusMeasurement(variance: number): void {
    this.state.currentValue = variance
    this.state.history.push(variance)
    
    // Keep only last 10 measurements for smoothing
    if (this.state.history.length > 10) {
      this.state.history.shift()
    }
    
    // Calculate average for stability
    const avgFocus = this.state.history.reduce((sum, val) => sum + val, 0) / this.state.history.length
    
    // Determine if in focus based on threshold
    this.state.isInFocus = avgFocus > this.settings.threshold

    // Process auto-focus if enabled
    if (this.state.isAutoFocusing) {
      this.processAutoFocus(variance)
    }
  }

  /**
   * Process auto-focus algorithm with bidirectional search
   * @param variance - Current focus variance
   */
  private processAutoFocus(variance: number): void {
    // Wait for focus change to take effect
    if (this.state.autoFocusWaitCounter > 0) {
      this.state.autoFocusWaitCounter--
      return
    }

    // Record current measurement
    this.state.autoFocusHistory.push({
      position: this.state.autoFocusPosition,
      variance: variance
    })

    // Update best position only if this is significantly better (40% improvement)
    const improvementThreshold = 1.4 // 40% improvement required
    if (variance > this.state.autoFocusBestVariance * improvementThreshold) {
      this.state.autoFocusBestVariance = variance
      this.state.autoFocusBestPosition = this.state.autoFocusPosition
      console.log(`[FocusDetector] New best position found: ${this.state.autoFocusPosition}% (variance: ${variance.toFixed(2)})`)
    }

    // Handle bidirectional search logic
    if (this.state.autoFocusPhase === 'first-direction') {
      this.processFirstDirection(variance)
    } else if (this.state.autoFocusPhase === 'second-direction') {
      this.processSecondDirection(variance)
    } else if (this.state.autoFocusPhase === 'fine-tuning') {
      this.processFineTuning(variance)
    }
  }

  /**
   * Process first direction search
   */
  private processFirstDirection(variance: number): void {
    // Check if we found a local maximum in first direction
    if (this.state.autoFocusHistory.length >= 2) {
      const current = this.state.autoFocusHistory[this.state.autoFocusHistory.length - 1]
      const previous = this.state.autoFocusHistory[this.state.autoFocusHistory.length - 2]
      
      // Require a significant decrease (20%) to confirm local maximum and avoid noise
      const decreaseThreshold = 0.8 // 20% decrease threshold
      if (current.variance < previous.variance * decreaseThreshold) {
        console.log(`[FocusDetector] First direction peak found. Current: ${current.variance.toFixed(2)}, Previous: ${previous.variance.toFixed(2)}`)
        
        // Save best from first direction
        this.state.autoFocusFirstDirectionBest = {
          position: this.state.autoFocusBestPosition,
          variance: this.state.autoFocusBestVariance
        }
        
        // Switch to second direction
        this.startSecondDirection()
        return
      }
    }

    // Continue in first direction
    let nextPosition = this.state.autoFocusPosition
    
    if (this.state.autoFocusDirection === 'in') {
      nextPosition += this.settings.autoFocusStepSize
      if (nextPosition >= 100) {
        // Reached limit, switch to second direction
        console.log(`[FocusDetector] Reached upper limit, switching to second direction`)
        this.state.autoFocusFirstDirectionBest = {
          position: this.state.autoFocusBestPosition,
          variance: this.state.autoFocusBestVariance
        }
        this.startSecondDirection()
        return
      }
    } else {
      nextPosition -= this.settings.autoFocusStepSize
      if (nextPosition <= 0) {
        // Reached limit, switch to second direction
        console.log(`[FocusDetector] Reached lower limit, switching to second direction`)
        this.state.autoFocusFirstDirectionBest = {
          position: this.state.autoFocusBestPosition,
          variance: this.state.autoFocusBestVariance
        }
        this.startSecondDirection()
        return
      }
    }

    // Move to next position
    this.goToFocusPosition(nextPosition)
  }

  /**
   * Start searching in the second direction
   */
  private startSecondDirection(): void {
    console.log(`[FocusDetector] Starting second direction search. First direction best: ${this.state.autoFocusFirstDirectionBest.position}% (${this.state.autoFocusFirstDirectionBest.variance.toFixed(2)})`)
    
    this.state.autoFocusPhase = 'second-direction'
    this.state.autoFocusDirection = this.state.autoFocusDirection === 'in' ? 'out' : 'in'
    
    // Go back to start position and begin searching other direction
    this.goToFocusPosition(this.state.autoFocusStartPosition)
  }

  /**
   * Process second direction search
   */
  private processSecondDirection(variance: number): void {
    // Check if we found a local maximum in second direction
    if (this.state.autoFocusHistory.length >= 2) {
      const current = this.state.autoFocusHistory[this.state.autoFocusHistory.length - 1]
      const previous = this.state.autoFocusHistory[this.state.autoFocusHistory.length - 2]
      
      // Require a significant decrease (20%) to confirm local maximum and avoid noise
      const decreaseThreshold = 0.8 // 20% decrease threshold
      if (current.variance < previous.variance * decreaseThreshold) {
        console.log(`[FocusDetector] Second direction peak found. Current: ${current.variance.toFixed(2)}, Previous: ${previous.variance.toFixed(2)}`)
        this.finishBidirectionalSearch()
        return
      }
    }

    // Continue in second direction
    let nextPosition = this.state.autoFocusPosition
    
    if (this.state.autoFocusDirection === 'in') {
      nextPosition += this.settings.autoFocusStepSize
      if (nextPosition >= 100) {
        // Reached limit, finish search
        console.log(`[FocusDetector] Reached upper limit in second direction`)
        this.finishBidirectionalSearch()
        return
      }
    } else {
      nextPosition -= this.settings.autoFocusStepSize
      if (nextPosition <= 0) {
        // Reached limit, finish search
        console.log(`[FocusDetector] Reached lower limit in second direction`)
        this.finishBidirectionalSearch()
        return
      }
    }

    // Move to next position
    this.goToFocusPosition(nextPosition)
  }

  /**
   * Finish bidirectional search and start fine-tuning
   */
  private finishBidirectionalSearch(): void {
    // Compare best from both directions
    const finalBestPosition = this.state.autoFocusBestVariance > this.state.autoFocusFirstDirectionBest.variance
      ? this.state.autoFocusBestPosition
      : this.state.autoFocusFirstDirectionBest.position

    const finalBestVariance = Math.max(this.state.autoFocusBestVariance, this.state.autoFocusFirstDirectionBest.variance)

    console.log(`[FocusDetector] Bidirectional search complete.`)
    console.log(`[FocusDetector] First direction best: ${this.state.autoFocusFirstDirectionBest.position}% (${this.state.autoFocusFirstDirectionBest.variance.toFixed(2)})`)
    console.log(`[FocusDetector] Second direction best: ${this.state.autoFocusBestPosition}% (${this.state.autoFocusBestVariance.toFixed(2)})`)
    console.log(`[FocusDetector] Final best position: ${finalBestPosition}% (${finalBestVariance.toFixed(2)})`)

    // Update final best position
    this.state.autoFocusBestPosition = finalBestPosition
    this.state.autoFocusBestVariance = finalBestVariance

    // Start fine-tuning phase
    this.startFineTuning(finalBestPosition)
  }

  /**
   * Start fine-tuning phase around the best position found
   */
  private startFineTuning(bestPosition: number): void {
    // Set fine-tuning range to ±10% around best position
    const rangeSize = 10 // 10% range
    const minPos = Math.max(0, bestPosition - rangeSize)
    const maxPos = Math.min(100, bestPosition + rangeSize)
    
    // Set fine-tuning step size to 20% of original step size
    const fineTuningStepSize = Math.max(1, Math.round(this.settings.autoFocusStepSize * 0.2))
    
    this.state.fineTuningRange = { min: minPos, max: maxPos }
    this.state.fineTuningStepSize = fineTuningStepSize
    this.state.autoFocusPhase = 'fine-tuning'
    this.state.autoFocusDirection = 'in' // Will be determined by gradient
    this.state.fineTuningSteps = 0
    this.state.fineTuningDirectionChanges = 0
    
    console.log(`[FocusDetector] Starting fine-tuning phase`)
    console.log(`[FocusDetector] Range: ${minPos}% - ${maxPos}% (±${rangeSize}% around ${bestPosition}%)`)
    console.log(`[FocusDetector] Fine-tuning step size: ${fineTuningStepSize}% (was ${this.settings.autoFocusStepSize}%)`)
    
    // Start fine-tuning from the best position found (not the lower bound!)
    this.goToFocusPosition(bestPosition)
  }

  /**
   * Process fine-tuning phase with oscillation detection
   */
  private processFineTuning(variance: number): void {
    this.state.fineTuningSteps++
    
    // Update best position if this is better
    if (variance > this.state.autoFocusBestVariance) {
      this.state.autoFocusBestVariance = variance
      this.state.autoFocusBestPosition = this.state.autoFocusPosition
      console.log(`[FocusDetector] Fine-tuning: New best position found: ${this.state.autoFocusPosition}% (variance: ${variance.toFixed(2)})`)
    }

    // Stop conditions
    const maxFineTuningSteps = 15 // Prevent infinite fine-tuning
    const maxDirectionChanges = 4 // Stop if oscillating too much
    
    if (this.state.fineTuningSteps >= maxFineTuningSteps) {
      console.log(`[FocusDetector] Fine-tuning: Max steps reached (${maxFineTuningSteps}). Best position: ${this.state.autoFocusBestPosition}%`)
      this.finishFineTuning()
      return
    }
    
    if (this.state.fineTuningDirectionChanges >= maxDirectionChanges) {
      console.log(`[FocusDetector] Fine-tuning: Too many direction changes (${maxDirectionChanges}). Converged at: ${this.state.autoFocusBestPosition}%`)
      this.finishFineTuning()
      return
    }

    // Need at least 2 measurements to calculate gradient
    if (this.state.autoFocusHistory.length < 2) {
      // Take first probe step in positive direction to establish gradient
      const nextPosition = Math.min(this.state.fineTuningRange.max, this.state.autoFocusPosition + this.state.fineTuningStepSize)
      console.log(`[FocusDetector] Fine-tuning: Taking initial probe step to ${nextPosition}%`)
      this.goToFocusPosition(nextPosition)
      return
    }

    // Calculate gradient from last two measurements
    const current = this.state.autoFocusHistory[this.state.autoFocusHistory.length - 1]
    const previous = this.state.autoFocusHistory[this.state.autoFocusHistory.length - 2]
    
    const deltaVariance = current.variance - previous.variance
    const deltaPosition = current.position - previous.position
    const gradient = deltaPosition !== 0 ? deltaVariance / deltaPosition : 0
    
    console.log(`[FocusDetector] Fine-tuning step ${this.state.fineTuningSteps}: gradient=${gradient.toFixed(2)}, direction changes=${this.state.fineTuningDirectionChanges}`)

    // Check for convergence: small gradient AND small improvement (both conditions must be met)
    const gradientThreshold = 2 // Very small gradient indicates we're at the peak
    const improvementThreshold = 0.005 // 0.5% improvement threshold (smaller than before)
    const relativeImprovement = Math.abs(deltaVariance) / Math.max(current.variance, previous.variance)
    
    // Only converge if BOTH gradient is small AND improvement is small
    if (Math.abs(gradient) < gradientThreshold && relativeImprovement < improvementThreshold) {
      console.log(`[FocusDetector] Fine-tuning: Converged (gradient=${gradient.toFixed(2)} < ${gradientThreshold} AND improvement=${(relativeImprovement*100).toFixed(2)}% < ${(improvementThreshold*100).toFixed(1)}%). Best: ${this.state.autoFocusBestPosition}%`)
      this.finishFineTuning()
      return
    }

    // Determine step direction based on gradient
    const newStepDirection = gradient > 0 ? 1 : -1
    const previousStepDirection = deltaPosition > 0 ? 1 : -1
    
    // Check for direction change (oscillation detection)
    if (this.state.fineTuningSteps > 1 && newStepDirection !== previousStepDirection) {
      this.state.fineTuningDirectionChanges++
      console.log(`[FocusDetector] Fine-tuning: Direction change detected (#${this.state.fineTuningDirectionChanges})`)
    }

    // Calculate next position
    let nextPosition = this.state.autoFocusPosition + (newStepDirection * this.state.fineTuningStepSize)
    
    // Check if we would go outside the fine-tuning range
    if (nextPosition < this.state.fineTuningRange.min || nextPosition > this.state.fineTuningRange.max) {
      console.log(`[FocusDetector] Fine-tuning: Would exceed range (${nextPosition}% outside ${this.state.fineTuningRange.min}%-${this.state.fineTuningRange.max}%). Converged at: ${this.state.autoFocusBestPosition}%`)
      this.finishFineTuning()
      return
    }

    console.log(`[FocusDetector] Fine-tuning: Moving ${newStepDirection > 0 ? 'up' : 'down'} to ${nextPosition}%`)
    this.goToFocusPosition(nextPosition)
  }

  /**
   * Finish fine-tuning and go to best position
   */
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
    this.state.isAutoFocusing = true
    this.state.autoFocusDirection = 'in'
    this.state.autoFocusHistory = []
    this.state.autoFocusWaitCounter = 0
    this.state.autoFocusBestVariance = 0
    this.state.autoFocusBestPosition = this.state.autoFocusPosition
    this.state.autoFocusPhase = 'first-direction'
    this.state.autoFocusStartPosition = this.state.autoFocusPosition
    this.state.autoFocusFirstDirectionBest = { position: this.state.autoFocusPosition, variance: 0 }
    this.state.fineTuningRange = { min: 0, max: 100 }
    this.state.fineTuningStepSize = Math.max(1, Math.round(this.settings.autoFocusStepSize * 0.2))
    this.state.fineTuningSteps = 0
    this.state.fineTuningDirectionChanges = 0
    
    console.log('[FocusDetector] Starting bidirectional auto-focus from position:', this.state.autoFocusPosition)
    console.log('[FocusDetector] Phase 1: Searching in direction:', this.state.autoFocusDirection)
  }

  /**
   * Stop auto-focus process
   */
  stopAutoFocus(): void {
    this.state.isAutoFocusing = false
    console.log('[FocusDetector] Auto-focus stopped at position:', this.state.autoFocusPosition)
  }

  /**
   * Set focus to specific position (stub - to be implemented)
   * @param position - Focus position (0-100, where 0 is closest, 100 is farthest)
   */
  private goToFocusPosition(position: number): void {
    console.log(`[FocusDetector] Setting focus to position: ${position}%`)
    this.state.autoFocusPosition = position
    this.state.autoFocusWaitCounter = this.settings.autoFocusWaitFrames
    
    setDataLakeVariableData('camera-focus-absolute', position*1000)

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
   * @param position - Focus position (0-100)
   */
  setManualFocusPosition(position: number): void {
    if (this.state.isAutoFocusing) {
      this.stopAutoFocus()
    }
    this.goToFocusPosition(Math.max(0, Math.min(100, position)))
  }
} 