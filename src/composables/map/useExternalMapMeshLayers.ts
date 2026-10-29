import type { Map as LeafletMap } from 'leaflet'

import { useExternalMapMeshes } from '@/composables/map/useExternalMapMeshes'
import { openSnackbar } from '@/composables/snackbar'
import type { MapMesh } from '@/libs/map/external-map-meshes'
import { mapMeshGlRenderer } from '@/libs/map/external-map-meshes-gl'
import { ExternalMapMeshesLayer } from '@/libs/map/external-map-meshes-layer'

const MESH_PANE = 'externalMeshPane'

// Shared by every map, so a mesh that cannot be drawn is reported once rather than once per map and redraw.
const reportedUndrawableMeshes = new Set<string>()
const reportUndrawableMesh = (mesh: MapMesh): void => {
  if (reportedUndrawableMeshes.has(mesh.id)) return
  reportedUndrawableMeshes.add(mesh.id)
  const message = `Map meshes need WebGL2, which is not available here, so ${mesh.name} is not drawn.`
  openSnackbar({ message, variant: 'error' })
}

/**
 * Mesh opacity the Map and MiniMap widgets start with, so a mesh does not hide the map under it.
 */
export const defaultMeshOpacity = 0.5

/**
 * Return type of {@link useExternalMapMeshLayers}.
 */
export interface UseExternalMapMeshLayersReturn {
  /**
   * Draws the received meshes on a Leaflet map, while `isShown` says the map is.
   */
  init: (map: LeafletMap, isShown?: () => boolean) => void
  /**
   * Scales the alpha of every mesh drawn on this map, from 0 (none drawn) to 1, before or after `init`.
   */
  setMeshOpacity: (opacity: number) => void
  /**
   * Shows or hides the meshes on this map, before or after `init`, leaving the other layers drawn.
   */
  setMeshesShown: (shown: boolean) => void
  /**
   * Removes the meshes from the map.
   */
  destroy: () => void
}

/**
 * Draws the map meshes received from external software on a single Leaflet map. Shared by the dashboard Map
 * widget, the MiniMap and the Mission Planning view.
 * @returns {UseExternalMapMeshLayersReturn} Methods to bind and tear down the meshes on a map.
 */
export const useExternalMapMeshLayers = (): UseExternalMapMeshLayersReturn => {
  const { meshes } = useExternalMapMeshes()

  let meshLayer: ExternalMapMeshesLayer | undefined
  let meshOpacity = 1
  let meshesShown = true
  let mapRef: LeafletMap | undefined

  const init = (map: LeafletMap, isShown = (): boolean => true): void => {
    mapRef = map
    // Above the GeoTIFF overlays (250), and below the mission and vehicle layers.
    if (!map.getPane(MESH_PANE)) map.createPane(MESH_PANE).style.zIndex = '255'
    meshLayer = new ExternalMapMeshesLayer({
      store: meshes,
      renderer: () => mapMeshGlRenderer(meshes),
      isShown,
      onUnsupported: reportUndrawableMesh,
      pane: MESH_PANE,
    })
    meshLayer.setMapAlpha(meshOpacity)
    if (meshesShown) map.addLayer(meshLayer)
  }

  const setMeshOpacity = (opacity: number): void => {
    meshOpacity = opacity
    meshLayer?.setMapAlpha(opacity)
  }

  // The uploaded meshes belong to the shared renderer, so re-adding the layer only redraws them.
  const setMeshesShown = (shown: boolean): void => {
    meshesShown = shown
    if (!meshLayer || !mapRef) return
    if (shown) mapRef.addLayer(meshLayer)
    else mapRef.removeLayer(meshLayer)
  }

  const destroy = (): void => {
    if (meshLayer) mapRef?.removeLayer(meshLayer)
    meshLayer = undefined
    mapRef = undefined
  }

  return { init, setMeshOpacity, setMeshesShown, destroy }
}
