import type { Feature, FeatureCollection } from 'geojson'
import L, { type Map as LeafletMap } from 'leaflet'
import { watch } from 'vue'

import { type ReceivedMapOverlay, useExternalMapOverlays } from '@/composables/map/useExternalMapOverlays'
import { openSnackbar } from '@/composables/snackbar'
import type { MapMesh } from '@/libs/map/external-map-meshes'
import { mapMeshGlRenderer } from '@/libs/map/external-map-meshes-gl'
import { ExternalMapMeshesLayer } from '@/libs/map/external-map-meshes-layer'

const OVERLAY_PANE = 'externalOverlayPane'
const MESH_PANE = 'externalMeshPane'

// Shared by every map, so a mesh that cannot be drawn is reported once rather than once per map and redraw.
const reportedUndrawableMeshes = new Set<string>()
const reportUndrawableMesh = (mesh: MapMesh): void => {
  if (reportedUndrawableMeshes.has(mesh.id)) return
  reportedUndrawableMeshes.add(mesh.id)
  const message = `Map meshes need WebGL2, which is not available here, so ${mesh.name} is not drawn.`
  openSnackbar({ message, variant: 'error' })
}

// Live senders can update many times a second; redrawing more often than this only costs frames.
const syncIntervalMs = 250

/**
 * Mesh opacity the Map and MiniMap widgets start with, so a mesh does not hide the map under it.
 */
export const defaultMeshOpacity = 0.5

const markerRadiusBySize: Record<string, number> = { small: 3, medium: 5, large: 7 }

const stringProperty = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback)

const numberProperty = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

// A point carrying a `radius` in metres is drawn as its true-scale footprint, like a sonar's on the seabed.
const metreRadius = (feature?: Feature): number | undefined => {
  const radius = feature?.properties?.radius
  return typeof radius === 'number' && Number.isFinite(radius) && radius > 0 ? radius : undefined
}

// Styled from the simplestyle-spec properties the sender writes on each feature, falling back to the spec's
// defaults. Points get the same treatment, since Leaflet applies this style to their circle markers too.
const featureStyle = (feature?: Feature): L.PathOptions => {
  const properties = feature?.properties ?? {}
  const geometryType = feature?.geometry.type
  if ((geometryType === 'Point' || geometryType === 'MultiPoint') && metreRadius(feature) === undefined) {
    const color = stringProperty(properties['marker-color'], '#7e7e7e')
    const markerStyle: L.CircleMarkerOptions = {
      radius: markerRadiusBySize[String(properties['marker-size'])] ?? markerRadiusBySize.medium,
      color,
      fillColor: color,
      fillOpacity: 1,
      weight: 0,
    }
    return markerStyle
  }
  return {
    color: stringProperty(properties.stroke, '#555555'),
    weight: numberProperty(properties['stroke-width'], 2),
    opacity: numberProperty(properties['stroke-opacity'], 1),
    fillColor: stringProperty(properties.fill, '#555555'),
    fillOpacity: numberProperty(properties['fill-opacity'], 0.6),
  }
}

/**
 * A received overlay drawn on this map
 */
interface OverlayEntry {
  /**
   * The live Leaflet layer drawing the overlay's features
   */
  layer: L.GeoJSON
  /**
   * Name the layer is listed under in the layer control
   */
  name: string
  /**
   * Revision of the features currently drawn
   */
  revision: number
  /**
   * How many of the overlay's features are drawn, so appended ones are added without redrawing the rest
   */
  drawnCount: number
}

/**
 * Return type of {@link useExternalMapOverlayLayers}.
 */
export interface UseExternalMapOverlayLayersReturn {
  /**
   * Draws the received overlays on a Leaflet map, lists them on its layer control, and keeps them in sync. Meshes
   * are only drawn while `isShown` says the map is.
   */
  init: (map: LeafletMap, layerControl?: L.Control.Layers, isShown?: () => boolean) => void
  /**
   * Scales the alpha of every mesh drawn on this map, from 0 (none drawn) to 1, before or after `init`.
   */
  setMeshOpacity: (opacity: number) => void
  /**
   * Stops syncing and removes the overlays from the map and its layer control.
   */
  destroy: () => void
}

/**
 * Draws the map overlays received from external software on a single Leaflet map. Shared by the dashboard Map
 * widget, the MiniMap and the Mission Planning view.
 * @returns {UseExternalMapOverlayLayersReturn} Methods to bind and tear down the overlays on a map.
 */
export const useExternalMapOverlayLayers = (): UseExternalMapOverlayLayersReturn => {
  const { overlays, meshes } = useExternalMapOverlays()

  const entries = new Map<string, OverlayEntry>()
  let meshLayer: ExternalMapMeshesLayer | undefined
  let meshOpacity = 1
  let mapRef: LeafletMap | undefined
  let controlRef: L.Control.Layers | undefined
  // Canvas rather than SVG, since a survey can carry thousands of soundings.
  const renderer = L.canvas({ pane: OVERLAY_PANE })
  let stopWatch: (() => void) | undefined
  let syncTimer: ReturnType<typeof setTimeout> | undefined

  const removeEntry = (id: string): void => {
    const entry = entries.get(id)
    if (!entry) return
    controlRef?.removeLayer(entry.layer)
    mapRef?.removeLayer(entry.layer)
    entries.delete(id)
  }

  // Not interactive, so clicks reach the map underneath, where Mission Planning places waypoints.
  const addEntry = (overlay: ReceivedMapOverlay): OverlayEntry => {
    const options: L.GeoJSONOptions & L.PathOptions = {
      renderer,
      interactive: false,
      style: featureStyle,
      pointToLayer: (feature, latlng) => {
        const radius = metreRadius(feature)
        return radius === undefined
          ? L.circleMarker(latlng, { renderer, interactive: false, radius: markerRadiusBySize.medium })
          : L.circle(latlng, { renderer, interactive: false, radius })
      },
    }
    const layer = L.geoJSON(undefined, options)
    controlRef?.addOverlay(layer, overlay.name)
    if (mapRef) layer.addTo(mapRef)
    const entry = { layer, name: overlay.name, revision: 0, drawnCount: 0 }
    entries.set(overlay.id, entry)
    return entry
  }

  const sync = (): void => {
    const currentIds = new Set(overlays.value.map((overlay) => overlay.id))
    for (const id of [...entries.keys()]) {
      if (!currentIds.has(id)) removeEntry(id)
    }

    for (const overlay of overlays.value) {
      const entry = entries.get(overlay.id) ?? addEntry(overlay)
      if (entry.name !== overlay.name) {
        controlRef?.removeLayer(entry.layer)
        controlRef?.addOverlay(entry.layer, overlay.name)
        entry.name = overlay.name
      }
      if (entry.revision !== overlay.revision) {
        entry.layer.clearLayers()
        entry.drawnCount = 0
        entry.revision = overlay.revision
      }
      if (entry.drawnCount < overlay.features.length) {
        const features = overlay.features.slice(entry.drawnCount)
        const collection: FeatureCollection = { type: 'FeatureCollection', features }
        entry.layer.addData(collection)
        entry.drawnCount = overlay.features.length
      }
    }
  }

  const scheduleSync = (): void => {
    if (syncTimer !== undefined) return
    syncTimer = setTimeout(() => {
      syncTimer = undefined
      sync()
    }, syncIntervalMs)
  }

  const init = (map: LeafletMap, layerControl?: L.Control.Layers, isShown = (): boolean => true): void => {
    mapRef = map
    controlRef = layerControl
    // Above the GeoTIFF overlays (250), so contours stay readable over a survey raster, and below the mission
    // and vehicle layers.
    if (!map.getPane(OVERLAY_PANE)) map.createPane(OVERLAY_PANE).style.zIndex = '260'
    // Between the GeoTIFFs and the GeoJSON overlays, which annotate the meshes.
    if (!map.getPane(MESH_PANE)) map.createPane(MESH_PANE).style.zIndex = '255'
    sync()
    stopWatch = watch(overlays, scheduleSync)
    meshLayer = new ExternalMapMeshesLayer({
      store: meshes,
      renderer: () => mapMeshGlRenderer(meshes),
      isShown,
      onUnsupported: reportUndrawableMesh,
      pane: MESH_PANE,
    })
    meshLayer.setMapAlpha(meshOpacity)
    map.addLayer(meshLayer)
  }

  const setMeshOpacity = (opacity: number): void => {
    meshOpacity = opacity
    meshLayer?.setMapAlpha(opacity)
  }

  const destroy = (): void => {
    stopWatch?.()
    stopWatch = undefined
    clearTimeout(syncTimer)
    syncTimer = undefined
    for (const id of [...entries.keys()]) removeEntry(id)
    mapRef?.removeLayer(renderer)
    if (meshLayer) mapRef?.removeLayer(meshLayer)
    meshLayer = undefined
    mapRef = undefined
    controlRef = undefined
  }

  return { init, setMeshOpacity, destroy }
}
