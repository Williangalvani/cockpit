import L from 'leaflet'

import type { MapMesh, MapMeshChange, MapMeshStore, MercatorBounds } from '@/libs/map/external-map-meshes'
import type { MapMeshGlRenderer } from '@/libs/map/external-map-meshes-gl'
import { type MapMeshMapStats, mapMeshStats } from '@/libs/map/external-map-meshes-stats'

// Drawn past the view by this fraction of its size on every side, so pans within it move the canvas, not redraw it.
const viewPadding = 0.25

// Highest device pixel ratio meshes are drawn at: sensor data is rarely finer than a CSS pixel, and a padded canvas
// at a ratio of 2 holds four times the pixels.
const maxMeshPixelRatio = 1

// How often a map checks whether it became shown or hidden.
const shownPollMs = 500

const earthCircumference = 2 * Math.PI * 6378137

let layerCount = 0

/**
 * What a {@link ExternalMapMeshesLayer} draws, and with what
 */
export interface ExternalMapMeshesLayerOptions {
  /**
   * The meshes
   */
  store: MapMeshStore
  /**
   * The shared renderer, or undefined where it cannot be created
   */
  renderer: () => MapMeshGlRenderer | undefined
  /**
   * Whether the map is shown, as a map hidden behind another view draws nothing
   */
  isShown: () => boolean
  /**
   * Called for each mesh that cannot be drawn, every time the map tries to
   */
  onUnsupported: (mesh: MapMesh) => void
  /**
   * Pane holding the canvas
   */
  pane: string
}

const intersects = (a: MercatorBounds, b: MercatorBounds): boolean =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY

/**
 * Leaflet layer drawing the map meshes of a {@link MapMeshStore} on one canvas, padded past the view. Every draw
 * is a full redraw, made when the meshes change in view (once per frame), when a pan leaves the padding, when the
 * zoom or size changes, when the map's mesh alpha turns to or from 0, and when the map becomes shown. Zooms scale
 * the last drawing until they end.
 */
export class ExternalMapMeshesLayer extends L.Layer {
  private canvas?: HTMLCanvasElement
  private leafletMap?: L.Map
  private stopListening?: () => void
  private frame?: number
  private pollTimer?: ReturnType<typeof setInterval>
  private shown = false
  private zooming = false
  private drawnTopLeft?: L.Point
  private drawnPadding = L.point(0, 0)
  private drawnOrigin?: L.LatLng
  private drawnZoom = 0
  private drawnBounds?: MercatorBounds
  private mapAlpha = 1
  private readonly statsId = `map-${++layerCount}`
  private readonly stats: MapMeshMapStats = {
    shown: false,
    redraws: 0,
    redrawMsSum: 0,
    redrawMsMax: 0,
    redrawMsLast: 0,
    mapAlpha: 1,
  }

  /**
   * @param {ExternalMapMeshesLayerOptions} config - What to draw, and with what
   */
  constructor(private readonly config: ExternalMapMeshesLayerOptions) {
    super()
  }

  /* eslint-disable jsdoc/require-jsdoc -- Leaflet layer lifecycle methods. */
  onAdd(map: L.Map): this {
    this.leafletMap = map
    this.canvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated')
    this.canvas.style.pointerEvents = 'none'
    this.styleMapAlpha()
    map.getPane(this.config.pane)?.appendChild(this.canvas)
    this.stopListening = this.config.store.subscribe((change) => this.onChange(change))
    mapMeshStats.maps[this.statsId] = this.stats
    this.pollTimer = setInterval(() => this.updateShown(), shownPollMs)
    this.updateShown()
    return this
  }

  onRemove(): this {
    this.stopListening?.()
    clearInterval(this.pollTimer)
    if (this.frame !== undefined) cancelAnimationFrame(this.frame)
    this.frame = undefined
    this.canvas?.remove()
    this.canvas = undefined
    this.leafletMap = undefined
    delete mapMeshStats.maps[this.statsId]
    return this
  }

  getEvents(): Record<string, L.LeafletEventHandlerFn> {
    return {
      moveend: this.onMoveEnd,
      viewreset: this.redraw,
      resize: this.redraw,
      zoomstart: this.onZoomStart,
      zoomend: this.onZoomEnd,
      zoom: this.onZoom,
      zoomanim: this.onZoomAnimation as L.LeafletEventHandlerFn,
    }
  }
  /* eslint-enable jsdoc/require-jsdoc */

  /**
   * Redraws the meshes on the next frame, once however many times it is called in it
   */
  redraw(): void {
    if (this.frame !== undefined || !this.leafletMap || !this.shown) return
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined
      // A zoom in progress scales the last drawing instead, and its end draws again.
      if (!this.zooming && this.shown) this.draw()
    })
  }

  /**
   * Scales the alpha of this map's finished mesh drawing as a whole, on top of each mesh's own opacity, so meshes
   * and quads that overlap do not compound it. Only turning it to or from 0 redraws, on the next frame.
   * @param {number} alpha - From 0, which draws no meshes, to 1; anything else is clamped, and not a number is 1
   */
  setMapAlpha(alpha: number): void {
    const clamped = Number.isFinite(alpha) ? Math.min(Math.max(alpha, 0), 1) : 1
    if (clamped === this.mapAlpha) return
    const wasDrawing = this.mapAlpha > 0
    this.mapAlpha = clamped
    this.stats.mapAlpha = clamped
    this.styleMapAlpha()
    if (wasDrawing !== clamped > 0) this.redraw()
  }

  /* eslint-disable jsdoc/require-jsdoc -- private helpers, commented where they need it. */
  // Applied by the compositor to the canvas, so changing it neither redraws nor re-uploads anything.
  private styleMapAlpha(): void {
    if (this.canvas) this.canvas.style.opacity = this.mapAlpha < 1 ? String(this.mapAlpha) : ''
  }

  private updateShown(): void {
    const shown = this.config.isShown()
    if (shown === this.shown) return
    this.shown = shown
    this.stats.shown = shown
    if (shown) return this.redraw()
    if (this.frame !== undefined) cancelAnimationFrame(this.frame)
    this.frame = undefined
    this.releaseCanvas()
  }

  private releaseCanvas(): void {
    if (!this.canvas) return
    this.canvas.width = 0
    this.canvas.height = 0
    this.drawnTopLeft = undefined
    this.drawnBounds = undefined
  }

  private onChange(change: MapMeshChange): void {
    if (change.bounds && this.drawnBounds && !intersects(change.bounds, this.drawnBounds)) return
    this.redraw()
  }

  // Redraws once the view drifts half its padding from where it was drawn, before a pan can show an undrawn edge.
  private onMoveEnd(): void {
    const map = this.leafletMap
    if (!map || !this.drawnTopLeft) return this.redraw()
    const drift = map.containerPointToLayerPoint([0, 0]).subtract(this.drawnTopLeft).subtract(this.drawnPadding)
    if (Math.abs(drift.x) > this.drawnPadding.x / 2 || Math.abs(drift.y) > this.drawnPadding.y / 2) this.redraw()
  }

  private onZoomStart(): void {
    this.zooming = true
  }

  private onZoomEnd(): void {
    this.zooming = false
    this.redraw()
  }

  // Pinch zooms move the map without a zoom animation, so the last drawing follows them here.
  private onZoom(): void {
    if (this.leafletMap) this.scaleTo(this.leafletMap.getCenter(), this.leafletMap.getZoom())
  }

  private onZoomAnimation(event: L.ZoomAnimEvent): void {
    this.scaleTo(event.center, event.zoom)
  }

  // Scales and moves the last drawing to where a view at that center and zoom shows it, as Leaflet does with its
  // own image overlays, until the zoom ends and the meshes are drawn again.
  private scaleTo(center: L.LatLng, zoom: number): void {
    const map = this.leafletMap
    if (!map || !this.canvas || !this.drawnOrigin) return
    const mapPanePosition = L.DomUtil.getPosition(map.getPane('mapPane') as HTMLElement)
    const pixelOrigin = map.project(center, zoom).subtract(map.getSize().divideBy(2)).add(mapPanePosition).round()
    const offset = map.project(this.drawnOrigin, zoom).subtract(pixelOrigin)
    L.DomUtil.setTransform(this.canvas, offset, map.getZoomScale(zoom, this.drawnZoom))
  }

  private draw(): void {
    const map = this.leafletMap
    const canvas = this.canvas
    const context = canvas?.getContext('2d')
    if (!map || !canvas || !context) return
    const start = performance.now()

    const size = map.getSize()
    const padding = size.multiplyBy(viewPadding).round()
    const topLeft = map.containerPointToLayerPoint(padding.multiplyBy(-1)).round()
    const cssSize = size.add(padding.multiplyBy(2))
    L.DomUtil.setPosition(canvas, topLeft)
    this.drawnTopLeft = topLeft
    this.drawnPadding = padding
    this.drawnOrigin = map.layerPointToLatLng(topLeft)
    this.drawnZoom = map.getZoom()

    // The canvas' top-left corner in EPSG:3857 metres, from the map's own pixel origin rather than through a LatLng.
    const worldPixels = (map.options.crs ?? L.CRS.EPSG3857).scale(this.drawnZoom)
    const metresPerCssPixel = earthCircumference / worldPixels
    const absoluteTopLeft = map.getPixelOrigin().add(topLeft)
    const originX = (absoluteTopLeft.x / worldPixels - 0.5) * earthCircumference
    const originY = (0.5 - absoluteTopLeft.y / worldPixels) * earthCircumference
    this.drawnBounds = {
      minX: originX,
      minY: originY - cssSize.y * metresPerCssPixel,
      maxX: originX + cssSize.x * metresPerCssPixel,
      maxY: originY,
    }

    const meshes =
      this.mapAlpha > 0
        ? [...this.config.store.meshes.values()].filter((mesh) => mesh.highWater > 0 && mesh.opacity > 0)
        : []
    const renderer = meshes.length > 0 ? this.config.renderer() : undefined
    if (!renderer) {
      meshes.forEach((mesh) => this.config.onUnsupported(mesh))
      // Nothing to draw, so the canvas holds no memory until there is.
      canvas.width = 0
      canvas.height = 0
      return
    }

    const pixelRatio = Math.min(window.devicePixelRatio || 1, maxMeshPixelRatio)
    const width = Math.round(cssSize.x * pixelRatio)
    const height = Math.round(cssSize.y * pixelRatio)
    canvas.style.width = `${cssSize.x}px`
    canvas.style.height = `${cssSize.y}px`
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    context.clearRect(0, 0, width, height)
    const view = { width, height, originX, originY, metresPerPixel: metresPerCssPixel / pixelRatio }
    for (const mesh of meshes) {
      if (!renderer.render(mesh, view)) continue
      context.globalAlpha = mesh.opacity
      const source = renderer.canvas
      context.drawImage(source, 0, source.height - height, width, height, 0, 0, width, height)
    }
    context.globalAlpha = 1

    const ms = performance.now() - start
    this.stats.redraws++
    this.stats.redrawMsSum += ms
    this.stats.redrawMsMax = Math.max(this.stats.redrawMsMax, ms)
    this.stats.redrawMsLast = ms
  }
  /* eslint-enable jsdoc/require-jsdoc */
}
