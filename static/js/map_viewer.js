/**
 * MapLibre GL map for the roadway spatial overlay tool.
 * Each overlay layer has its own GeoJSON source and paint properties so a
 * color pick updates only that layer — never CSS theme tokens or sibling layers.
 */

const PALETTES = {
  forest: {
    name: "Forest & Slate",
    matched: "#16a34a",
    matchedBg: "#f0fdf4",
    matchedBorder: "#bbf7d0",
    unmatched: "#ea580c",
    unmatchedBg: "#fff7ed",
    unmatchedBorder: "#fed7aa",
    ref: "#64748b",
    refBg: "#f8fafc",
    refBorder: "#e2e8f0",
    highlight: "#15803d",
  },
  nordic: {
    name: "Nordic Teal & Amber",
    matched: "#0891b2",
    matchedBg: "#ecfeff",
    matchedBorder: "#a5f3fc",
    unmatched: "#f59e0b",
    unmatchedBg: "#fffbeb",
    unmatchedBorder: "#fde68a",
    ref: "#64748b",
    refBg: "#f8fafc",
    refBorder: "#e2e8f0",
    highlight: "#0e7490",
  },
  indigo: {
    name: "Indigo & Burgundy",
    matched: "#4f46e5",
    matchedBg: "#eef2ff",
    matchedBorder: "#c7d2fe",
    unmatched: "#e11d48",
    unmatchedBg: "#fff1f2",
    unmatchedBorder: "#fecdd3",
    ref: "#64748b",
    refBg: "#f8fafc",
    refBorder: "#e2e8f0",
    highlight: "#4338ca",
  },
  olive: {
    name: "Charcoal & Olive",
    matched: "#65a30d",
    matchedBg: "#f7fee7",
    matchedBorder: "#d9f99d",
    unmatched: "#d97706",
    unmatchedBg: "#fffbeb",
    unmatchedBorder: "#fde68a",
    ref: "#64748b",
    refBg: "#f8fafc",
    refBorder: "#e2e8f0",
    highlight: "#4d7c0f",
  },
};

const LINE_DASH = {
  solid: null,
  dashed: [2, 1.4],
  dotted: [0.2, 1.6],
  dashdot: [2.4, 1.2, 0.4, 1.2],
};

const BASEMAPS = {
  liberty: {
    label: "Liberty",
    styleUrl: "https://tiles.openfreemap.org/styles/liberty",
  },
  positron: {
    label: "Positron",
    styleUrl: "https://tiles.openfreemap.org/styles/positron",
  },
  bright: {
    label: "Bright",
    styleUrl: "https://tiles.openfreemap.org/styles/bright",
  },
  dark: {
    label: "Dark",
    styleUrl: "https://tiles.openfreemap.org/styles/dark",
  },
  satellite: {
    label: "Aerial",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    attribution: "Tiles © Esri — Esri, Maxar, Earthstar Geographics",
    maxzoom: 19,
  },
  none: {
    label: "None",
    empty: true,
    background: "#f4f4f5",
  },
};

const BASEMAP_ALIASES = {
  light: "positron",
  streets: "liberty",
  non: "none",
  off: "none",
  blank: "none",
};

const PREFS_KEY = "overlay.mapStyles.v3";
const LAYER_KEYS = ["matched", "unmatched", "reference"];
const EMPTY_FC = { type: "FeatureCollection", features: [] };

const OVERLAY_LAYERS = {
  destination: "lyr-destination",
  unmatched: "lyr-unmatched",
  matched: "lyr-matched",
  reference: "lyr-reference",
  highlight: "lyr-highlight",
};

function defaultLayerStyles(paletteKey) {
  const pal = PALETTES[paletteKey] || PALETTES.forest;
  return {
    matched: { visible: true, color: pal.matched, width: 3.5, opacity: 0.92, pattern: "solid" },
    unmatched: { visible: true, color: pal.unmatched, width: 2.5, opacity: 0.8, pattern: "solid" },
    reference: { visible: true, color: pal.ref, width: 2, opacity: 0.4, pattern: "dashed" },
  };
}

function emptyCollection() {
  return { type: "FeatureCollection", features: [] };
}

function featureKey(props, fallback) {
  if (props && props._feat_id !== undefined) return String(props._feat_id);
  if (props && props._orig_fid !== undefined) return `${props._orig_fid}:${props._part_id ?? 0}`;
  return fallback !== undefined ? String(fallback) : "";
}

function boundsFromGeoJSON(geojson) {
  if (!geojson || !geojson.features || !geojson.features.length || typeof turf === "undefined") return null;
  try {
    const b = turf.bbox(geojson);
    if (!b.every(Number.isFinite)) return null;
    return [[b[0], b[1]], [b[2], b[3]]];
  } catch (err) {
    return null;
  }
}

function resolveBasemapId(id) {
  const mapped = BASEMAP_ALIASES[id] || id;
  return BASEMAPS[mapped] ? mapped : "liberty";
}

function basemapOnlyStyle(basemapId) {
  const spec = BASEMAPS[basemapId] || BASEMAPS.liberty;
  if (spec.empty) {
    return {
      version: 8,
      name: spec.label || "None",
      sources: {},
      layers: [{
        id: "background",
        type: "background",
        paint: { "background-color": spec.background || "#f4f4f5" },
      }],
    };
  }
  if (spec.styleUrl) return spec.styleUrl;
  return {
    version: 8,
    name: spec.label || "Aerial",
    sources: {
      basemap: {
        type: "raster",
        tiles: spec.tiles,
        tileSize: 256,
        attribution: spec.attribution,
        maxzoom: spec.maxzoom || 19,
      },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
  };
}

const OVERLAY_SOURCES = {
  destination: "src-destination",
  reference: "src-reference",
  results: "src-results",
  highlight: "src-highlight",
};

const MEASURE_SOURCE = "src-measure";
const MEASURE_LINE = "lyr-measure-line";
const MEASURE_POINTS = "lyr-measure-points";

function pathLengthFeet(coords) {
  if (!coords || coords.length < 2 || typeof turf === "undefined") return 0;
  let miles = 0;
  for (let i = 1; i < coords.length; i += 1) {
    miles += turf.distance(turf.point(coords[i - 1]), turf.point(coords[i]), { units: "miles" });
  }
  return miles * 5280;
}

function formatFeetDistance(feet) {
  if (!Number.isFinite(feet) || feet <= 0) return "0 ft";
  const rounded = feet >= 100 ? Math.round(feet) : Math.round(feet * 10) / 10;
  const ftText = `${rounded.toLocaleString()} ft`;
  if (feet < 5280) return ftText;
  const miles = Math.round((feet / 5280) * 100) / 100;
  return `${miles.toLocaleString()} mi (${ftText})`;
}

function overlayLayerSpecs() {
  return [
    {
      id: OVERLAY_LAYERS.destination,
      type: "line",
      source: OVERLAY_SOURCES.destination,
      paint: { "line-color": "#ea580c", "line-width": 2.5, "line-opacity": 0.8 },
      layout: { "line-join": "round", "line-cap": "round" },
    },
    {
      id: OVERLAY_LAYERS.unmatched,
      type: "line",
      source: OVERLAY_SOURCES.results,
      filter: ["!=", ["get", "Match_Stat"], "On Corridor"],
      paint: { "line-color": "#ea580c", "line-width": 2.5, "line-opacity": 0.8 },
      layout: { "line-join": "round", "line-cap": "round" },
    },
    {
      id: OVERLAY_LAYERS.matched,
      type: "line",
      source: OVERLAY_SOURCES.results,
      filter: ["==", ["get", "Match_Stat"], "On Corridor"],
      paint: { "line-color": "#16a34a", "line-width": 3.5, "line-opacity": 0.92 },
      layout: { "line-join": "round", "line-cap": "round" },
    },
    {
      id: OVERLAY_LAYERS.reference,
      type: "line",
      source: OVERLAY_SOURCES.reference,
      paint: { "line-color": "#64748b", "line-width": 2, "line-opacity": 0.4, "line-dasharray": [2, 1.4] },
      layout: { "line-join": "round", "line-cap": "round" },
    },
    {
      id: OVERLAY_LAYERS.highlight,
      type: "line",
      source: OVERLAY_SOURCES.highlight,
      paint: { "line-color": "#15803d", "line-width": 10, "line-opacity": 0.28 },
      layout: { "line-join": "round", "line-cap": "round" },
    },
  ];
}

class MapViewer {
  constructor(containerId = "map-container") {
    this.containerId = containerId;
    this.map = null;
    this.popup = null;
    this.inspectorEl = document.getElementById("map-inspector");
    this.inspectorBody = document.getElementById("map-inspector-body");
    this.inspectorTitle = document.getElementById("map-inspector-title");
    this.currentPalette = "forest";
    this.currentBasemap = "liberty";
    this.drawOrder = "destination";
    this.latestResultGeoJSON = null;
    this.latestRefGeoJSON = null;
    this.latestTargetGeoJSON = null;
    this.unitMode = "ft";
    this.featureLayerMap = new Map();
    this.layerStyles = defaultLayerStyles(this.currentPalette);
    this.panelOpen = false;
    this.stackOpen = true;
    this.styleReady = false;
    this.onResultFeatureClick = null;
    this.measure = { active: false, points: [], cursor: null };
    this._lastMeasureClick = 0;

    this.loadPrefs();
    this.initMap();
    this.bindStyleUi();
    this.syncStyleUi();
    this.updateThemeCssVars();
    this.updateLegendChips();
  }

  loadPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      if (raw.palette && PALETTES[raw.palette]) this.currentPalette = raw.palette;
      if (raw.basemap) this.currentBasemap = resolveBasemapId(raw.basemap);
      if (raw.drawOrder === "destination" || raw.drawOrder === "reference") this.drawOrder = raw.drawOrder;
      if (typeof raw.stackOpen === "boolean") this.stackOpen = raw.stackOpen;
      this.layerStyles = defaultLayerStyles(this.currentPalette);
      if (raw.styles) {
        LAYER_KEYS.forEach((key) => {
          if (!raw.styles[key]) return;
          const next = { ...this.layerStyles[key], ...raw.styles[key] };
          this.layerStyles[key] = next;
        });
      }
    } catch (err) {
      this.layerStyles = defaultLayerStyles(this.currentPalette);
    }
  }

  savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        palette: this.currentPalette,
        basemap: this.currentBasemap,
        drawOrder: this.drawOrder,
        stackOpen: this.stackOpen,
        styles: this.layerStyles,
      }));
    } catch (err) {
      /* ignore quota / private mode */
    }
  }

  initMap() {
    this.map = new maplibregl.Map({
      container: this.containerId,
      style: basemapOnlyStyle(this.currentBasemap),
      center: [-81.3792, 28.5383],
      zoom: 8,
      attributionControl: true,
    });
    this.map.addControl(new maplibregl.NavigationControl({
      showCompass: true,
      showZoom: true,
      visualizePitch: false,
    }), "top-right");
    this.map.addControl(new maplibregl.ScaleControl({
      maxWidth: 120,
      unit: "imperial",
    }), "bottom-left");
    this.popup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: true,
      maxWidth: "300px",
      className: "overlay-map-popup",
    });
    const closeInspectorBtn = document.getElementById("btn-close-inspector");
    if (closeInspectorBtn) {
      closeInspectorBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        this.closeInspector();
      });
    }

    this.map.on("style.load", () => this.onStyleReady());
    if (this.map.isStyleLoaded()) this.onStyleReady();
    this.map.on("load", () => {
      requestAnimationFrame(() => this.resize());
    });

    this.map.on("click", (event) => this.handleMapClick(event));
    this.map.on("dblclick", (event) => this.handleMeasureDblClick(event));
    this.map.on("mousemove", (event) => this.handleMeasureMove(event));
    document.addEventListener("keydown", (event) => this.handleMeasureKey(event));
    this.map.on("mouseenter", OVERLAY_LAYERS.matched, () => this.setHoverCursor("pointer"));
    this.map.on("mouseenter", OVERLAY_LAYERS.unmatched, () => this.setHoverCursor("pointer"));
    this.map.on("mouseenter", OVERLAY_LAYERS.reference, () => this.setHoverCursor("pointer"));
    this.map.on("mouseleave", OVERLAY_LAYERS.matched, () => this.setHoverCursor(""));
    this.map.on("mouseleave", OVERLAY_LAYERS.unmatched, () => this.setHoverCursor(""));
    this.map.on("mouseleave", OVERLAY_LAYERS.reference, () => this.setHoverCursor(""));
    const measureBtn = document.getElementById("btn-measure");
    if (measureBtn) measureBtn.addEventListener("click", () => this.toggleMeasure());
    const undoBtn = document.getElementById("btn-measure-undo");
    if (undoBtn) undoBtn.addEventListener("click", (event) => { event.stopPropagation(); this.undoMeasurePoint(); });
    const clearBtn = document.getElementById("btn-measure-clear");
    if (clearBtn) clearBtn.addEventListener("click", (event) => { event.stopPropagation(); this.stopMeasure(true); });
  }

  setHoverCursor(cursor) {
    if (!this.map) return;
    if (this.measure.active) {
      this.map.getCanvas().style.cursor = "crosshair";
      return;
    }
    this.map.getCanvas().style.cursor = cursor;
  }

  resize() {
    if (this.map) this.map.resize();
  }

  onStyleReady() {
    this.ensureOverlays();
    this.styleReady = true;
    this.applyAllLayerPaints();
    this.applyDrawOrder();
    this.restoreSources();
    this.resize();
  }

  ensureOverlays() {
    if (!this.map) return;
    const sourceData = {
      [OVERLAY_SOURCES.destination]: this.latestResultGeoJSON ? emptyCollection() : (this.latestTargetGeoJSON || emptyCollection()),
      [OVERLAY_SOURCES.reference]: this.latestRefGeoJSON || emptyCollection(),
      [OVERLAY_SOURCES.results]: this.latestResultGeoJSON || emptyCollection(),
      [OVERLAY_SOURCES.highlight]: emptyCollection(),
    };
    Object.entries(sourceData).forEach(([id, data]) => {
      if (!this.map.getSource(id)) {
        this.map.addSource(id, { type: "geojson", data: data || emptyCollection() });
      }
    });
    overlayLayerSpecs().forEach((spec) => {
      if (!this.map.getLayer(spec.id)) this.map.addLayer(spec);
    });
    this.ensureMeasureLayers();
  }

  ensureMeasureLayers() {
    if (!this.map) return;
    if (!this.map.getSource(MEASURE_SOURCE)) {
      this.map.addSource(MEASURE_SOURCE, { type: "geojson", data: this.measureGeoJSON() });
    }
    if (!this.map.getLayer(MEASURE_LINE)) {
      this.map.addLayer({
        id: MEASURE_LINE,
        type: "line",
        source: MEASURE_SOURCE,
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": "#1d4ed8", "line-width": 2.5, "line-opacity": 0.9 },
        layout: { "line-join": "round", "line-cap": "round" },
      });
    }
    if (!this.map.getLayer(MEASURE_POINTS)) {
      this.map.addLayer({
        id: MEASURE_POINTS,
        type: "circle",
        source: MEASURE_SOURCE,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 4.5,
          "circle-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#1d4ed8",
        },
      });
    }
  }

  setSourceData(sourceId, geojson) {
    if (!this.map || !this.styleReady || !this.map.getSource(sourceId)) return;
    this.map.getSource(sourceId).setData(geojson || emptyCollection());
  }

  restoreSources() {
    this.setSourceData(OVERLAY_SOURCES.reference, this.latestRefGeoJSON);
    this.setSourceData(OVERLAY_SOURCES.destination, this.latestResultGeoJSON ? emptyCollection() : this.latestTargetGeoJSON);
    this.setSourceData(OVERLAY_SOURCES.results, this.latestResultGeoJSON);
    this.setSourceData(OVERLAY_SOURCES.highlight, emptyCollection());
    this.syncMeasureSource();
  }

  setBasemap(id, persist = true) {
    const next = resolveBasemapId(id);
    this.currentBasemap = next;
    this.styleReady = false;
    this.map.setStyle(basemapOnlyStyle(this.currentBasemap), { diff: false });
    const select = document.getElementById("basemap-select");
    if (select) select.value = this.currentBasemap;
    if (persist) this.savePrefs();
  }

  setUnitMode(mode) {
    this.unitMode = mode;
  }

  paletteColors() {
    const pal = PALETTES[this.currentPalette];
    return { matched: pal.matched, unmatched: pal.unmatched, reference: pal.ref };
  }

  setPalette(paletteKey) {
    if (!PALETTES[paletteKey]) return;
    this.currentPalette = paletteKey;
    const colors = this.paletteColors();
    LAYER_KEYS.forEach((key) => {
      this.layerStyles[key].color = colors[key];
    });
    this.updateThemeCssVars();
    this.syncStyleUi();
    this.applyAllLayerPaints();
    this.savePrefs();
  }

  resetLayerStyles() {
    this.layerStyles = defaultLayerStyles(this.currentPalette);
    this.drawOrder = "destination";
    this.syncStyleUi();
    this.applyAllLayerPaints();
    this.applyDrawOrder();
    this.savePrefs();
  }

  updateThemeCssVars() {
    const pal = PALETTES[this.currentPalette] || PALETTES.forest;
    const root = document.documentElement;
    root.style.setProperty("--match-color", pal.matched);
    root.style.setProperty("--match-bg", pal.matchedBg);
    root.style.setProperty("--match-border", pal.matchedBorder);
    root.style.setProperty("--unmatch-color", pal.unmatched);
    root.style.setProperty("--unmatch-bg", pal.unmatchedBg);
    root.style.setProperty("--unmatch-border", pal.unmatchedBorder);
    root.style.setProperty("--ref-color", pal.ref);
    root.style.setProperty("--ref-bg", pal.refBg);
    root.style.setProperty("--ref-border", pal.refBorder);
  }

  paintOneLayer(layerId, style, extra = {}) {
    if (!this.map || !this.styleReady || !this.map.getLayer(layerId)) return;
    const visible = style.visible !== false && extra.visible !== false;
    this.map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
    this.map.setLayoutProperty(layerId, "line-cap", style.pattern === "dotted" ? "butt" : "round");
    this.map.setPaintProperty(layerId, "line-color", extra.color || style.color);
    this.map.setPaintProperty(layerId, "line-width", extra.width ?? style.width);
    this.map.setPaintProperty(layerId, "line-opacity", extra.opacity ?? (visible ? style.opacity : 0));
    const dash = LINE_DASH[style.pattern];
    try {
      this.map.setPaintProperty(layerId, "line-dasharray", dash);
    } catch (err) {
      this.map.setPaintProperty(layerId, "line-dasharray", dash || [1]);
    }
  }

  applyLayerPaint(key) {
    const style = this.layerStyles[key];
    if (!style) return;
    if (key === "matched") this.paintOneLayer(OVERLAY_LAYERS.matched, style);
    if (key === "unmatched") {
      this.paintOneLayer(OVERLAY_LAYERS.unmatched, style);
      this.paintOneLayer(OVERLAY_LAYERS.destination, style);
    }
    if (key === "reference") this.paintOneLayer(OVERLAY_LAYERS.reference, style);
    this.updateSwatch(key);
  }

  applyAllLayerPaints() {
    LAYER_KEYS.forEach((key) => this.applyLayerPaint(key));
    const pal = PALETTES[this.currentPalette] || PALETTES.forest;
    this.paintOneLayer(OVERLAY_LAYERS.highlight, {
      visible: true,
      color: pal.highlight,
      width: 10,
      opacity: 0.28,
      pattern: "solid",
    });
  }

  applyDrawOrder() {
    if (!this.map || !this.styleReady) return;
    const destOnTop = this.drawOrder !== "reference";
    const order = destOnTop
      ? [OVERLAY_LAYERS.reference, OVERLAY_LAYERS.destination, OVERLAY_LAYERS.unmatched, OVERLAY_LAYERS.matched, OVERLAY_LAYERS.highlight]
      : [OVERLAY_LAYERS.destination, OVERLAY_LAYERS.unmatched, OVERLAY_LAYERS.matched, OVERLAY_LAYERS.reference, OVERLAY_LAYERS.highlight];
    order.forEach((id) => {
      if (this.map.getLayer(id)) this.map.moveLayer(id);
    });
    [MEASURE_LINE, MEASURE_POINTS].forEach((id) => {
      if (this.map.getLayer(id)) this.map.moveLayer(id);
    });
  }

  updateSwatch(key) {
    const style = this.layerStyles[key];
    if (!style) return;
    [`legend-swatch-${key}`, `panel-swatch-${key}`].forEach((id) => {
      const swatch = document.getElementById(id);
      if (!swatch) return;
      swatch.style.opacity = String(style.opacity);
      if (style.pattern === "solid") {
        swatch.style.background = style.color;
        swatch.style.borderTop = "none";
        swatch.style.height = id.startsWith("panel") ? "4px" : "4px";
      } else {
        swatch.style.background = "transparent";
        swatch.style.height = "0";
        swatch.style.borderTop = `${Math.max(2, style.width)}px dashed ${style.color}`;
      }
    });
  }

  updateLegendChips() {
    LAYER_KEYS.forEach((key) => this.updateSwatch(key));
  }

  bindStyleUi() {
    const stack = document.getElementById("map-tool-stack");
    const stackToggle = document.getElementById("btn-toggle-map-stack");
    const panel = document.getElementById("map-style-panel");
    const toggle = document.getElementById("btn-toggle-styles");
    const reset = document.getElementById("btn-reset-map-styles");
    const order = document.getElementById("map-draw-order");
    const basemap = document.getElementById("basemap-select");
    const palette = document.getElementById("palette-select");

    const syncStack = () => {
      if (stack) stack.classList.toggle("is-collapsed", !this.stackOpen);
      if (stackToggle) {
        stackToggle.setAttribute("aria-expanded", this.stackOpen ? "true" : "false");
        stackToggle.title = this.stackOpen ? "Hide map tools" : "Show map tools";
      }
    };
    syncStack();
    if (stackToggle) {
      stackToggle.addEventListener("click", () => {
        this.stackOpen = !this.stackOpen;
        syncStack();
        this.savePrefs();
      });
    }

    if (panel) panel.classList.toggle("is-hidden", !this.panelOpen);
    if (toggle) {
      toggle.classList.toggle("is-active", this.panelOpen);
      toggle.setAttribute("aria-pressed", this.panelOpen ? "true" : "false");
      toggle.addEventListener("click", () => {
        this.panelOpen = !this.panelOpen;
        if (panel) panel.classList.toggle("is-hidden", !this.panelOpen);
        toggle.classList.toggle("is-active", this.panelOpen);
        toggle.setAttribute("aria-pressed", this.panelOpen ? "true" : "false");
      });
    }

    if (reset) reset.addEventListener("click", () => this.resetLayerStyles());

    if (order) {
      order.addEventListener("change", () => {
        this.drawOrder = order.value === "destination" ? "destination" : "reference";
        this.applyDrawOrder();
        this.savePrefs();
      });
    }

    if (basemap) {
      basemap.addEventListener("change", () => this.setBasemap(basemap.value));
    }

    if (palette) palette.value = this.currentPalette;

    LAYER_KEYS.forEach((key) => {
      const toggleEl = document.getElementById(`map-toggle-${key}`);
      const colorEl = document.getElementById(`map-color-${key}`);
      const widthEl = document.getElementById(`map-width-${key}`);
      const opacityEl = document.getElementById(`map-opacity-${key}`);
      const patternEl = document.getElementById(`map-pattern-${key}`);

      if (toggleEl) {
        toggleEl.addEventListener("change", () => {
          this.layerStyles[key].visible = toggleEl.checked;
          this.applyLayerPaint(key);
          this.savePrefs();
        });
      }
      if (colorEl) {
        const applyColor = () => {
          this.layerStyles[key].color = colorEl.value;
          this.applyLayerPaint(key);
          this.savePrefs();
        };
        colorEl.addEventListener("input", applyColor);
        colorEl.addEventListener("change", applyColor);
      }
      if (widthEl) {
        widthEl.addEventListener("input", () => {
          this.layerStyles[key].width = Number(widthEl.value);
          const val = document.getElementById(`map-width-${key}-val`);
          if (val) val.textContent = String(this.layerStyles[key].width);
          this.applyLayerPaint(key);
          this.savePrefs();
        });
      }
      if (opacityEl) {
        opacityEl.addEventListener("input", () => {
          this.layerStyles[key].opacity = Number(opacityEl.value) / 100;
          const val = document.getElementById(`map-opacity-${key}-val`);
          if (val) val.textContent = `${opacityEl.value}%`;
          this.applyLayerPaint(key);
          this.savePrefs();
        });
      }
      if (patternEl) {
        patternEl.addEventListener("change", () => {
          this.layerStyles[key].pattern = patternEl.value;
          this.applyLayerPaint(key);
          this.savePrefs();
        });
      }
    });
  }

  syncStyleUi() {
    const order = document.getElementById("map-draw-order");
    if (order) order.value = this.drawOrder;
    const palette = document.getElementById("palette-select");
    if (palette) palette.value = this.currentPalette;
    const basemap = document.getElementById("basemap-select");
    if (basemap) basemap.value = this.currentBasemap;

    LAYER_KEYS.forEach((key) => {
      const style = this.layerStyles[key];
      const toggleEl = document.getElementById(`map-toggle-${key}`);
      const colorEl = document.getElementById(`map-color-${key}`);
      const widthEl = document.getElementById(`map-width-${key}`);
      const widthVal = document.getElementById(`map-width-${key}-val`);
      const opacityEl = document.getElementById(`map-opacity-${key}`);
      const opacityVal = document.getElementById(`map-opacity-${key}-val`);
      const patternEl = document.getElementById(`map-pattern-${key}`);
      if (toggleEl) toggleEl.checked = style.visible;
      if (colorEl) colorEl.value = style.color;
      if (widthEl) widthEl.value = String(style.width);
      if (widthVal) widthVal.textContent = String(style.width);
      if (opacityEl) opacityEl.value = String(Math.round(style.opacity * 100));
      if (opacityVal) opacityVal.textContent = `${Math.round(style.opacity * 100)}%`;
      if (patternEl) patternEl.value = style.pattern;
    });
    this.updateLegendChips();
  }

  clearAll() {
    this.latestRefGeoJSON = null;
    this.latestTargetGeoJSON = null;
    this.latestResultGeoJSON = null;
    this.featureLayerMap.clear();
    this.setSourceData("src-reference", emptyCollection());
    this.setSourceData("src-destination", emptyCollection());
    this.setSourceData("src-results", emptyCollection());
    this.setSourceData("src-highlight", emptyCollection());
    this.stopMeasure(true);
    this.closeInspector();
  }

  displayReferenceLayer(geojson, autoFit = true) {
    this.latestRefGeoJSON = geojson;
    this.setSourceData("src-reference", geojson);
    if (autoFit) this.fitBounds();
  }

  displayTargetPreview(geojson, autoFit = true) {
    this.latestTargetGeoJSON = geojson;
    if (!this.latestResultGeoJSON) {
      this.setSourceData("src-destination", geojson);
    }
    if (autoFit) this.fitBounds();
  }

  displayOverlayResults(geojson, onFeatureClick, autoFit = true) {
    this.latestResultGeoJSON = geojson;
    this.onResultFeatureClick = onFeatureClick;
    this.featureLayerMap.clear();
    this.setSourceData("src-destination", emptyCollection());
    this.setSourceData("src-results", geojson);
    this.setSourceData("src-highlight", emptyCollection());

    (geojson.features || []).forEach((feature, idx) => {
      const key = featureKey(feature.properties, idx);
      if (key) this.featureLayerMap.set(key, feature);
    });

    this.applyAllLayerPaints();
    if (autoFit) this.fitBounds();
  }

  toggleMeasure() {
    if (this.measure.active) this.stopMeasure(true);
    else this.startMeasure();
  }

  startMeasure() {
    this.measure = { active: true, points: [], cursor: null };
    this.closeInspector();
    if (this.map && this.map.doubleClickZoom) this.map.doubleClickZoom.disable();
    this.setHoverCursor("crosshair");
    const btn = document.getElementById("btn-measure");
    if (btn) {
      btn.classList.add("is-active");
      btn.setAttribute("aria-pressed", "true");
    }
    this.syncMeasureSource();
    this.updateMeasureReadout();
  }

  stopMeasure(clearPoints) {
    this.measure.active = false;
    this.measure.cursor = null;
    if (clearPoints) this.measure.points = [];
    if (this.map && this.map.doubleClickZoom) this.map.doubleClickZoom.enable();
    this.setHoverCursor("");
    const btn = document.getElementById("btn-measure");
    if (btn) {
      btn.classList.remove("is-active");
      btn.setAttribute("aria-pressed", "false");
    }
    this.syncMeasureSource();
    this.updateMeasureReadout();
  }

  finishMeasure() {
    this.measure.cursor = null;
    this.measure.active = false;
    if (this.map && this.map.doubleClickZoom) this.map.doubleClickZoom.enable();
    this.setHoverCursor("");
    const btn = document.getElementById("btn-measure");
    if (btn) {
      btn.classList.remove("is-active");
      btn.setAttribute("aria-pressed", "false");
    }
    this.syncMeasureSource();
    this.updateMeasureReadout();
  }

  addMeasurePoint(lngLat) {
    if (!lngLat) return;
    this.measure.points.push([lngLat.lng, lngLat.lat]);
    this._lastMeasureClick = Date.now();
    this.syncMeasureSource();
    this.updateMeasureReadout();
  }

  undoMeasurePoint() {
    if (!this.measure.points.length) return;
    this.measure.points.pop();
    this.syncMeasureSource();
    this.updateMeasureReadout();
  }

  handleMeasureDblClick(event) {
    if (!this.measure.active) return;
    event.preventDefault();
    if (Date.now() - this._lastMeasureClick < 400 && this.measure.points.length) {
      this.measure.points.pop();
    }
    if (this.measure.points.length >= 2) this.finishMeasure();
  }

  handleMeasureMove(event) {
    if (!this.measure.active || !this.measure.points.length) return;
    this.measure.cursor = [event.lngLat.lng, event.lngLat.lat];
    this.syncMeasureSource();
    this.updateMeasureReadout();
  }

  handleMeasureKey(event) {
    if (!this.measure.active) return;
    const tag = event.target && event.target.tagName;
    if (tag && /INPUT|TEXTAREA|SELECT/.test(tag)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.stopMeasure(true);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (this.measure.points.length >= 2) this.finishMeasure();
    } else if (event.key === "Backspace") {
      event.preventDefault();
      this.undoMeasurePoint();
    }
  }

  measureCoords() {
    const coords = this.measure.points.slice();
    if (this.measure.active && this.measure.cursor) coords.push(this.measure.cursor);
    return coords;
  }

  measureGeoJSON() {
    const coords = this.measureCoords();
    const features = coords.map((pt) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: pt },
    }));
    if (coords.length >= 2) {
      features.unshift({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: coords },
      });
    }
    return { type: "FeatureCollection", features };
  }

  syncMeasureSource() {
    if (!this.map || !this.map.getSource(MEASURE_SOURCE)) return;
    this.map.getSource(MEASURE_SOURCE).setData(this.measureGeoJSON());
  }

  updateMeasureReadout() {
    const box = document.getElementById("map-measure-readout");
    const text = document.getElementById("map-measure-text");
    if (!box || !text) return;
    const hasPath = this.measure.points.length > 0;
    const show = this.measure.active || hasPath;
    box.hidden = !show;
    box.classList.toggle("is-hidden", !show);
    const coords = this.measureCoords();
    const feet = pathLengthFeet(coords);
    if (!this.measure.points.length) {
      text.textContent = "Click to start a path";
    } else if (this.measure.points.length === 1 && this.measure.active) {
      text.textContent = feet > 0 ? formatFeetDistance(feet) : "Click next point";
    } else {
      const segs = Math.max(0, coords.length - 1);
      text.textContent = `${formatFeetDistance(feet)} · ${segs} seg`;
    }
  }

  handleMapClick(event) {
    if (!this.styleReady) return;
    if (this.measure.active) {
      this.addMeasurePoint(event.lngLat);
      return;
    }
    const layers = [OVERLAY_LAYERS.matched, OVERLAY_LAYERS.unmatched, OVERLAY_LAYERS.reference]
      .filter((id) => this.map.getLayer(id));
    const hits = this.map.queryRenderedFeatures(event.point, { layers });
    if (!hits.length) {
      this.closeInspector();
      return;
    }
    const feature = hits[0];
    if (feature.source === "src-results") {
      this.highlightFeature(feature);
      if (this.onResultFeatureClick) this.onResultFeatureClick(feature);
    }
    this.openInspector(feature);
  }

  openInspector(feature) {
    if (!feature) return;
    const html = feature.source === "src-results"
      ? this.generateDualLayerPopupContent(feature)
      : this.generateSimplePopup(feature);
    if (this.inspectorEl && this.inspectorBody) {
      const props = feature.properties || {};
      if (this.inspectorTitle) {
        this.inspectorTitle.textContent = props.Match_Stat
          || (feature.source === "src-reference" ? "Reference" : "Destination");
      }
      this.inspectorBody.innerHTML = html;
      this.inspectorEl.hidden = false;
      this.inspectorEl.classList.remove("is-hidden");
      if (this.popup) this.popup.remove();
      return;
    }
    if (!this.popup) return;
    const mid = feature.geometry && typeof turf !== "undefined" ? turf.centroid(feature) : null;
    const lngLat = mid && mid.geometry ? mid.geometry.coordinates : null;
    if (!lngLat) return;
    this.popup.setLngLat(lngLat).setHTML(html).addTo(this.map);
  }

  closeInspector() {
    if (this.inspectorEl) {
      this.inspectorEl.hidden = true;
      this.inspectorEl.classList.add("is-hidden");
    }
    if (this.inspectorBody) this.inspectorBody.innerHTML = "";
    if (this.popup) this.popup.remove();
  }

  generateSimplePopup(feature) {
    const props = feature.properties || {};
    const isRef = feature.source === "src-reference";
    let html = `<div class="map-popup-card">`;
    html += `<div class="popup-header ${isRef ? "ref-hdr" : "target-hdr"}"><i class="fa-solid ${isRef ? "fa-road" : "fa-bullseye"}"></i> ${isRef ? "Reference Segment" : "Destination Segment"}</div>`;
    html += `<table class="popup-attr-table">`;
    for (const [k, v] of Object.entries(props)) {
      if (!k.startsWith("_") && k !== "geometry") {
        html += `<tr><td><b>${k}</b></td><td>${v !== null && v !== undefined ? v : "-"}</td></tr>`;
      }
    }
    html += `</table></div>`;
    return html;
  }

  generateDualLayerPopupContent(feature) {
    const props = feature.properties || {};
    const isMatched = props.Match_Stat === "On Corridor" || props.Match_Status === "On Corridor";
    const refs = (() => {
      if (Array.isArray(props._matched_refs)) return props._matched_refs;
      if (typeof props._matched_refs === "string") {
        try { return JSON.parse(props._matched_refs); } catch (err) { return []; }
      }
      return [];
    })();

    let html = `<div class="dual-popup-container">`;
    html += `
      <div class="dual-popup-status-bar" style="border-left: 4px solid ${isMatched ? this.layerStyles.matched.color : this.layerStyles.unmatched.color};">
        <div>
          <span class="popup-badge ${isMatched ? "match" : "unmatch"}">${props.Match_Stat || "Segment"}</span>
          <span class="popup-qc-badge">${props.QC_Flag || "Verified"}</span>
        </div>
        <div class="popup-sub-metrics font-mono">
          ${props.Ovl_Ft !== undefined ? `<span><b>${props.Ovl_Pct}%</b> ovl (${Number(props.Ovl_Ft).toLocaleString()} ft)</span>` : ""}
        </div>
      </div>
      <div class="popup-tabs">
        <button type="button" class="popup-tab-btn active" onclick="window._switchPopupTab(this, 'tab-target')">
          <i class="fa-solid fa-bullseye"></i> Destination Attributes
        </button>
        <button type="button" class="popup-tab-btn" onclick="window._switchPopupTab(this, 'tab-ref')">
          <i class="fa-solid fa-road"></i> Matched References (${refs.length})
        </button>
      </div>
    `;

    html += `<div class="popup-tab-pane active" id="tab-target"><table class="popup-attr-table">`;
    for (const [k, v] of Object.entries(props)) {
      if (!k.startsWith("_") && k !== "geometry" && k !== "Match_Stat" && k !== "QC_Flag" && k !== "Matched_ID") {
        html += `<tr><td><b>${k}</b></td><td>${v !== null && v !== undefined ? v : "-"}</td></tr>`;
      }
    }
    html += `</table></div>`;

    html += `<div class="popup-tab-pane" id="tab-ref">`;
    if (refs.length > 0) {
      refs.forEach((refItem, idx) => {
        html += `
          <div class="ref-match-item">
            <div class="ref-item-title">
              <strong>#${idx + 1}: ${refItem.tag || "Ref Match"}</strong>
              <span class="font-mono text-muted">${Number(refItem.overlap_ft || 0).toLocaleString()} ft (${refItem.overlap_pct}%) • ∠${refItem.angle_diff}°</span>
            </div>
            <table class="popup-attr-table">
        `;
        for (const [rk, rv] of Object.entries(refItem.properties || {})) {
          if (!rk.startsWith("_") && rk !== "geometry") {
            html += `<tr><td><b>${rk}</b></td><td>${rv !== null && rv !== undefined ? rv : "-"}</td></tr>`;
          }
        }
        html += `</table></div>`;
      });
    } else {
      html += `<div class="popup-empty-msg"><i class="fa-solid fa-info-circle"></i> No reference features overlapped within buffer and angle tolerances.</div>`;
    }
    html += `</div></div>`;
    return html;
  }

  highlightFeature(feature) {
    if (!feature || !feature.geometry) {
      this.setSourceData("src-highlight", emptyCollection());
      return;
    }
    this.setSourceData("src-highlight", {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: feature.geometry }],
    });
    this.applyDrawOrder();
  }

  clearOverlayResults() {
    this.latestResultGeoJSON = null;
    this.featureLayerMap.clear();
    this.setSourceData("src-results", emptyCollection());
    this.setSourceData("src-highlight", emptyCollection());
    this.setSourceData("src-destination", this.latestTargetGeoJSON);
    this.closeInspector();
  }

  zoomToFeatureById(origFid, targetProps) {
    const props = targetProps || {};
    const key = featureKey(props, origFid);
    const feature = this.featureLayerMap.get(key) || this.featureLayerMap.get(String(origFid));
    if (!feature) return;
    const bounds = boundsFromGeoJSON({ type: "FeatureCollection", features: [feature] });
    if (bounds) {
      this.map.fitBounds(bounds, {
        padding: { top: 36, bottom: 36, left: 36, right: 320 },
        maxZoom: 16,
        duration: 600,
      });
    }
    this.highlightFeature(feature);
    this.openInspector(Object.assign({ source: "src-results" }, feature));
  }

  fitBounds() {
    const collections = [
      this.latestRefGeoJSON,
      this.latestResultGeoJSON || this.latestTargetGeoJSON,
    ].filter((g) => g && g.features && g.features.length);
    if (!collections.length) return;
    const merged = {
      type: "FeatureCollection",
      features: collections.flatMap((g) => g.features),
    };
    const bounds = boundsFromGeoJSON(merged);
    if (bounds) this.map.fitBounds(bounds, { padding: 28, duration: 400 });
  }
}

window._switchPopupTab = function (btn, tabId) {
  const container = btn.closest(".dual-popup-container");
  if (!container) return;
  container.querySelectorAll(".popup-tab-btn").forEach((b) => b.classList.remove("active"));
  container.querySelectorAll(".popup-tab-pane").forEach((p) => p.classList.remove("active"));
  btn.classList.add("active");
  const targetPane = container.querySelector(`#${tabId}`);
  if (targetPane) targetPane.classList.add("active");
};

window.PALETTES = PALETTES;
window.MapViewer = MapViewer;
window.EMPTY_FC = EMPTY_FC;
