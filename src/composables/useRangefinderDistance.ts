import { median } from 'mathjs'
import { type Ref, computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useDataLakeVariable } from '@/composables/useDataLakeVariable'
import {
  getAllDataLakeVariablesInfo,
  getDataLakeVariableData,
  getDataLakeVariableLastUpdateTimestamp,
} from '@/libs/actions/data-lake'
import {
  isRangefinderDistanceVariableId,
  rangefinderOrientationVariableId,
  selectRangefinderVariableId,
} from '@/libs/data-sources/rangefinder'

const staleTimeoutMs = 3000
const selectionIntervalMs = 1000
const sampleCount = 5

/**
 * Distance to the bottom measured by the vehicle's downward-facing rangefinder, discovered from the DISTANCE_SENSOR
 * messages in the data lake so that sensors published by the autopilot and by companion computer drivers both work.
 * @returns {{ distanceInMeters: Ref<number | undefined> }} Filtered distance, undefined while none measures the bottom
 */
export function useRangefinderDistance(): {
  /** @type {Ref<number | undefined>} */
  distanceInMeters: Ref<number | undefined>
} {
  const selectedVariableId = ref<string | undefined>(undefined)
  const samples = ref<number[]>([])
  let selectionInterval: ReturnType<typeof setInterval> | undefined

  const { value: rawDistance } = useDataLakeVariable(selectedVariableId)

  const isPublishing = (variableId: string): boolean => {
    const lastUpdate = getDataLakeVariableLastUpdateTimestamp(variableId)
    return lastUpdate !== undefined && performance.now() - lastUpdate < staleTimeoutMs
  }

  // The data lake keeps the last reading of a rangefinder that was disconnected, so the update timestamps are what
  // tell which sensors are still measuring. They are polled because a sensor going silent raises no event, and the
  // timestamp is used instead of the value, which is constant when parked on the bottom or out of the sensor range.
  const selectRangefinder = (): void => {
    const candidates = Object.keys(getAllDataLakeVariablesInfo())
      .filter(isRangefinderDistanceVariableId)
      .map((variableId) => {
        const orientation = getDataLakeVariableData(rangefinderOrientationVariableId(variableId))
        return {
          variableId,
          isPublishing: isPublishing(variableId),
          orientation: typeof orientation === 'string' ? orientation : undefined,
        }
      })

    selectedVariableId.value = selectRangefinderVariableId(candidates)
  }

  watch(rawDistance, (newDistance) => {
    if (typeof newDistance !== 'number' || newDistance <= 0) return
    // DISTANCE_SENSOR reports centimeters
    samples.value = [...samples.value, newDistance / 100].slice(-sampleCount)
  })

  // Readings from another sensor, or from before a dropout, must not blend into the current distance
  watch(selectedVariableId, () => {
    samples.value = []
  })

  onMounted(() => {
    selectRangefinder()
    selectionInterval = setInterval(selectRangefinder, selectionIntervalMs)
  })

  onUnmounted(() => {
    clearInterval(selectionInterval)
  })

  // The median discards the isolated spikes and dropouts a sonar returns, which an average would instead drag to
  const distanceInMeters = computed(() => (samples.value.length === 0 ? undefined : median(samples.value)))

  return { distanceInMeters }
}
