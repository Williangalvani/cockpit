import type { Map as LeafletMap } from 'leaflet'
import { getCurrentScope, onScopeDispose } from 'vue'

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
  const problem = 'this browser or graphics driver does not support WebGL2. Try enabling hardware acceleration.'
  const message = `Cannot draw the map mesh "${mesh.name}": ${problem}`
  openSnackbar({ message, variant: 'error' })
}

/**
 * Mesh opacity every map starts with: the faintest texels are drawn at about half opacity, so the map shows through
 * them, while opaque texels keep full contrast.
 */
export const defaultMeshOpacity = 0.5

/**
 * Return type of {@link useExternalMapMeshLayers}.
 */
export interface UseExternalMapMeshLayersReturn {
  /**
   * Draws the received meshes on a Leaflet map, while `isShown` says the map is. Does nothing if the component using it
   * has already unmounted, which can happen when the caller awaits other layers first.
   */
  init: (map: LeafletMap, isShown?: () => boolean) => void
  /**
   * Sets, before or after `init`, how this map draws its meshes' faint texels, from 0 (faintest hidden) to 1 (every
   * non-empty texel opaque). Empty texels are never drawn.
   */
  setMeshOpacity: (opacity: number) => void
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
  let meshOpacity = defaultMeshOpacity
  let mapRef: LeafletMap | undefined
  let unmounted = false
  if (getCurrentScope()) onScopeDispose(() => (unmounted = true))

  const init = (map: LeafletMap, isShown = (): boolean => true): void => {
    if (unmounted) return
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
    map.addLayer(meshLayer)
  }

  const setMeshOpacity = (opacity: number): void => {
    meshOpacity = opacity
    meshLayer?.setMapAlpha(opacity)
  }

  const destroy = (): void => {
    if (meshLayer) mapRef?.removeLayer(meshLayer)
    meshLayer = undefined
    mapRef = undefined
  }

  return { init, setMeshOpacity, destroy }
}
