import 'floating-vue/dist/style.css'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import '@/libs/system-logging'

import { library } from '@fortawesome/fontawesome-svg-core'
import { far } from '@fortawesome/free-regular-svg-icons'
import { fas } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import * as Sentry from '@sentry/vue'
import FloatingVue from 'floating-vue'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import VueVirtualScroller from 'vue-virtual-scroller'

import App from './App.vue'
import vuetify from './plugins/vuetify'
import { loadFonts } from './plugins/webfontloader'
import router from './router'
import { useOmniscientLoggerStore } from './stores/omniscientLogger'
import { VRButton } from 'three/addons/webxr/VRButton.js'
import * as THREE from 'three'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { XREstimatedLight } from 'three/addons/webxr/XREstimatedLight.js';

library.add(fas, far)
loadFonts()

const app = createApp(App)

// Initialize Sentry for error tracking
// Only track usage statistics if the user has not opted out and the app is not in development mode
if (window.localStorage.getItem('cockpit-enable-usage-statistics-telemetry') && import.meta.env.DEV === false) {
  console.log('Initializing Sentry telemetry...')
  Sentry.init({
    app,
    dsn: 'https://d7329dcf760fa1cc9fa6c7a5f16f60a1@o4507696465707008.ingest.us.sentry.io/4507762984222720',
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
    sampleRate: 1.0, // Capture all errors
    tracesSampleRate: 1.0, // Capture all traces
    tracePropagationTargets: [],
    replaysOnErrorSampleRate: 1.0, // If you're not already sampling the entire session, change the sample rate to 100% when sampling sessions where errors occur.
    transport: Sentry.makeBrowserOfflineTransport(Sentry.makeFetchTransport), // Cache events and send them when the user comes back online
  })
  Sentry.getCurrentScope().setLevel('info')
}

app.component('FontAwesomeIcon', FontAwesomeIcon)
app.use(router).use(vuetify).use(createPinia()).use(FloatingVue).use(VueVirtualScroller)
app.mount('#app')

// Initialize the logger store
useOmniscientLoggerStore()
let camera, scene, renderer, video, texture, sphereMesh;

function init() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);
    document.body.appendChild(VRButton.createButton(renderer));

    // Create video element
    video = document.getElementById('mainDisplayStream');
    // Create video texture
    texture = new THREE.VideoTexture(video);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.format = THREE.RGBFormat;

    // Create spherical geometry
    const geometry = new THREE.SphereGeometry(500, 60, 40);
    geometry.scale(-1, 1, 1); // Invert the sphere so the video is on the inside

    // Adjust UV mapping for the horizontally split video
    const uvs = geometry.attributes.uv.array;
    for (let i = 0; i < uvs.length; i += 2) {
        const u = uvs[i];
        const v = uvs[i + 1];

        uvs[i] = (u * 2) % 1;
        uvs[i + 1] = (v - 0.5) * 2; // Map 0.5-1 to 0-1
        if (u > 0.5) {
            uvs[i + 1] += 0.5; // Move to the bottom half of the video
        }
    }
    geometry.attributes.uv.needsUpdate = true;

    // Create material and mesh
    const material = new THREE.MeshBasicMaterial({ map: texture });
    sphereMesh = new THREE.Mesh(geometry, material);
    scene.add(sphereMesh);

    window.addEventListener('resize', onWindowResize, false);

}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    renderer.setAnimationLoop(render);
}

function render() {
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        texture.needsUpdate = true;
    }
    renderer.render(scene, camera);
}

let interval = setInterval(() => {
    video = document.getElementById('mainDisplayStream');
    if (video) {
        init();
        animate();
        clearInterval(interval);
    }
}, 500);