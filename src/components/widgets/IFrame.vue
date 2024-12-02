<template>
  <div class="w-full h-full">
    <teleport to=".widgets-view">
      <iframe
        ref="iframeRef"
        v-show="iframe_loaded"
        :src="widget.options.source"
        :style="iframeStyle"
        frameborder="0"
        @load="loadFinished"
      />
    </teleport>
    <v-dialog v-model="widgetStore.widgetManagerVars(widget.hash).configMenuOpen" min-width="400" max-width="35%">
      <v-card class="pa-2" :style="interfaceStore.globalGlassMenuStyles">
        <v-card-title class="text-center">Settings</v-card-title>
        <v-card-text>
          <p>Iframe Source</p>
          <div class="flex items-center justify-between">
            <v-text-field
              v-model="inputURL"
              variant="filled"
              outlined
              :rules="[validateURL]"
              @keydown.enter="updateURL"
            />
            <v-btn
              v-tooltip.bottom="'Set'"
              icon="mdi-check"
              class="mx-1 mb-5 bg-[#FFFFFF22]"
              rounded="lg"
              flat
              @click="updateURL"
            />
          </div>
        </v-card-text>
        <v-card-text>
          <v-slider v-model="transparency" label="Transparency" color="white" :min="0" :max="90" />
        </v-card-text>
        <v-card-actions class="flex justify-end">
          <v-btn color="white" @click="widgetStore.widgetManagerVars(widget.hash).configMenuOpen = false">
            Close
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
  <Snackbar
    :open-snackbar="openSnackbar"
    :message="snackbarMessage"
    :duration="3000"
    :close-button="false"
    @update:open-snackbar="openSnackbar = $event"
  />
</template>

<script setup lang="ts">
import { useWindowSize } from '@vueuse/core'
import { computed, defineProps, onBeforeMount, ref, toRefs, watch } from 'vue'

import { defaultBlueOsAddress } from '@/assets/defaults'
import Snackbar from '@/components/Snackbar.vue'
import { isValidURL } from '@/libs/utils'
import { useAppInterfaceStore } from '@/stores/appInterface'
import { useWidgetManagerStore } from '@/stores/widgetManager'
import type { Widget } from '@/types/widgets'
import { getAllCockpitActionVariablesInfo } from '@/libs/actions/data-lake'

const interfaceStore = useAppInterfaceStore()
const widgetStore = useWidgetManagerStore()

const props = defineProps<{
  widget: Widget
}>()
const widget = toRefs(props).widget

const iframeRef = ref<HTMLIFrameElement | null>(null)
const iframe_loaded = ref(false)
const transparency = ref(0)
const inputURL = ref(widget.value.options.source)
const openSnackbar = ref(false)
const snackbarMessage = ref('')

const validateURL = (url: string): true | string => {
  return isValidURL(url) ? true : 'URL is not valid.'
}

const updateURL = (): void => {
  const urlValidationResult = validateURL(inputURL.value)
  if (urlValidationResult !== true) {
    snackbarMessage.value = `${urlValidationResult} Please enter a valid URL.`
    openSnackbar.value = true
    return
  }
  widget.value.options.source = inputURL.value
  snackbarMessage.value = `IFrame URL successfully updated to '${inputURL.value}'.`
  openSnackbar.value = true
}

function initializeCockpitAPI(): void {
  console.log('Initializing CockpitAPIv1...')
  try {
    if (!iframeRef.value) {
      throw new Error('IFrame ref is not available')
    }
    
    const iframeWindow = iframeRef.value.contentWindow
    if (!iframeWindow) {
      throw new Error('IFrame contentWindow is not available')
    }
    iframeWindow.CockpitAPIv1 = {
    setPosition: (x: number, y: number) => {
      widget.value.position.x = x
      widget.value.position.y = y
    },
    setSize: (width: number, height: number) => {
      widget.value.size.width = width
      widget.value.size.height = height
    },
    getInfo: () => ({
      id: widget.value.hash,
      position: widget.value.position,
      size: widget.value.size,
      visible: widgetStore.isWidgetVisible(widget.value)
    }),
    getAllCockpitActionVariablesInfo: async () => {
      return await getAllCockpitActionVariablesInfo()
    }
  }
  console.log('CockpitAPIv1 initialized.')
    // Rest of initialization...
  } catch (error) {
    console.error('Failed to initialize CockpitAPIv1:', error)
  }
}

onBeforeMount(() => {
  if (Object.keys(widget.value.options).length !== 0) return
  widget.value.options = { source: defaultBlueOsAddress }
  inputURL.value = defaultBlueOsAddress
})

const { width: windowWidth, height: windowHeight } = useWindowSize()

const iframeStyle = computed<string>(() => {
  let newStyle = ''

  newStyle = newStyle.concat(' ', 'position: absolute;')
  newStyle = newStyle.concat(' ', `left: ${widget.value.position.x * windowWidth.value}px;`)
  newStyle = newStyle.concat(' ', `top: ${widget.value.position.y * windowHeight.value}px;`)
  newStyle = newStyle.concat(' ', `width: ${widget.value.size.width * windowWidth.value}px;`)
  newStyle = newStyle.concat(' ', `height: ${widget.value.size.height * windowHeight.value}px;`)

  if (widgetStore.editingMode) {
    newStyle = newStyle.concat(' ', 'pointer-events:none; border:0;')
  }

  if (!widgetStore.isWidgetVisible(widget.value)) {
    newStyle = newStyle.concat(' ', 'display: none;')
  }

  return newStyle
})

const iframeOpacity = computed<number>(() => {
  return (100 - transparency.value) / 100
})

/**
 * Called when iframe finishes loading
 */
 function loadFinished(): void {
  console.log('loadFinished called', iframeRef.value)
  initializeCockpitAPI()
  iframe_loaded.value = true
}

watch(
  widget,
  () => {
    if (widgetStore.widgetManagerVars(widget.value.hash).configMenuOpen === false) {
      if (validateURL(inputURL.value) !== true) {
        inputURL.value = widget.value.options.source
      }
    }
  },
  { deep: true }
)
</script>

<style scoped>
iframe {
  width: 100%;
  height: 100%;
  border: none;
  flex-grow: 1;
  margin: 0;
  padding: 0;
  opacity: calc(v-bind('iframeOpacity'));
}
</style>
