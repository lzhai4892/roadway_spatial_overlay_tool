/**
 * Roadway Line-to-Line Overlay Tool • 100% Pure Client-Side Static App Controller
 * No backend server, Python, or port required!
 * Features:
 * - Pure In-browser spatial overlay engine (Turf.js, Proj4js, shpjs, SheetJS, PapaParse)
 * - Dynamic interactive column buttons & automatic ID expression generation
 * - Visual Scientific Matching Logic Guide Modal with vector diagrams
 * - Default scientific sort (Matched -> Angle Mismatch -> Unmatched)
 * - Dynamic interactive column sorting (ascending / descending) on all columns including Overlap (ft) and Overlap (mi)
 * - Dual-layer attribute inspection popup & smooth map zoom
 * - Export results located in Table toolbar (Excel .xlsx, GeoJSON .geojson, CSV .csv)
 * - Responsive sliding panel with flexible wrapping
 */

document.addEventListener("DOMContentLoaded", () => {
  let targetLayerData = null;
  let refLayerData = null;
  let currentResults = null;
  let currentTableData = [];
  let resultsStale = false;
  let mapViewer = null;

  // Sorting State
  let activeSortColumn = null;
  let activeSortDirection = "asc"; // "asc" or "desc"

  try {
    mapViewer = new MapViewer("map-container");
    setTimeout(() => {
      if (mapViewer && typeof mapViewer.resize === "function") mapViewer.resize();
    }, 250);
  } catch (err) {
    console.error("Map initialization error:", err);
  }

  window.addEventListener("resize", () => {
    if (mapViewer && typeof mapViewer.resize === "function") mapViewer.resize();
  });

  function initHelpTips() {
    const bubble = document.getElementById("help-tip-bubble");
    if (!bubble) return;
    let activeBtn = null;
    let pinned = false;

    function hideTip() {
      bubble.hidden = true;
      bubble.textContent = "";
      if (activeBtn) activeBtn.setAttribute("aria-expanded", "false");
      activeBtn = null;
      pinned = false;
    }

    function placeTip(btn) {
      const text = (btn.getAttribute("data-tip") || "").trim();
      if (!text) {
        hideTip();
        return;
      }
      bubble.textContent = text;
      bubble.hidden = false;
      const rect = btn.getBoundingClientRect();
      const pad = 8;
      const width = Math.min(280, window.innerWidth - 16);
      bubble.style.width = `${width}px`;
      const tipH = bubble.offsetHeight;
      const tipW = bubble.offsetWidth;
      let left = rect.left;
      if (left + tipW > window.innerWidth - pad) left = window.innerWidth - tipW - pad;
      if (left < pad) left = pad;
      let top = rect.bottom + 6;
      if (top + tipH > window.innerHeight - pad) top = rect.top - tipH - 6;
      if (top < pad) top = pad;
      bubble.style.left = `${left}px`;
      bubble.style.top = `${top}px`;
      if (activeBtn && activeBtn !== btn) activeBtn.setAttribute("aria-expanded", "false");
      activeBtn = btn;
      btn.setAttribute("aria-expanded", "true");
    }

    document.querySelectorAll(".help-tip").forEach((btn) => {
      btn.setAttribute("aria-expanded", "false");
      btn.addEventListener("mouseenter", () => {
        if (!pinned) placeTip(btn);
      });
      btn.addEventListener("mouseleave", () => {
        if (!pinned) hideTip();
      });
      btn.addEventListener("focus", () => placeTip(btn));
      btn.addEventListener("blur", () => {
        if (!pinned) hideTip();
      });
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (pinned && activeBtn === btn) {
          hideTip();
          return;
        }
        pinned = true;
        placeTip(btn);
      });
    });

    document.addEventListener("click", (e) => {
      if (!pinned) return;
      if (e.target.closest(".help-tip") || e.target.closest("#help-tip-bubble")) return;
      hideTip();
    });
    window.addEventListener("resize", hideTip);
    document.addEventListener("scroll", hideTip, true);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && (pinned || activeBtn)) hideTip();
    });
  }

  initHelpTips();

  // DOM Elements
  const sidebarPane = document.getElementById("sidebar-pane");
  const sidebarResizer = document.getElementById("sidebar-resizer");
  const mapPane = document.getElementById("map-pane");
  const gridPane = document.getElementById("grid-pane");
  const rowResizer = document.getElementById("row-resizer");

  const targetBlock = document.getElementById("target-block");
  const targetFileInput = document.getElementById("target-file-input");
  const targetFilename = document.getElementById("target-filename");
  const targetMeta = document.getElementById("target-meta");
  const targetCount = document.getElementById("target-count");
  const targetMultipart = document.getElementById("target-multipart");
  const targetCrs = document.getElementById("target-crs");
  const targetAlert = document.getElementById("target-alert");

  const refBlock = document.getElementById("ref-block");
  const refFileInput = document.getElementById("ref-file-input");
  const refFilename = document.getElementById("ref-filename");
  const refMeta = document.getElementById("ref-meta");
  const refCount = document.getElementById("ref-count");
  const refMultipart = document.getElementById("ref-multipart");
  const refCrs = document.getElementById("ref-crs");
  const refAlert = document.getElementById("ref-alert");

  const columnButtonsContainer = document.getElementById("column-buttons-container");
  const customExprInput = document.getElementById("custom-expr-input");
  const btnClearColumns = document.getElementById("btn-clear-columns");
  const btnResetExpr = document.getElementById("btn-reset-expr");

  const btnOpenGuide = document.getElementById("btn-open-guide");
  const btnOpenGuideHeader = document.getElementById("btn-open-guide-header");
  const btnCloseGuide = document.getElementById("btn-close-guide");
  const guideModal = document.getElementById("guide-modal");
  const fallbackToggle = document.getElementById("param-fallback-toggle");
  const fallbackRatioInput = document.getElementById("param-fallback-ratio");
  const fallbackDistanceInput = document.getElementById("param-fallback-distance");
  const fallbackOptions = document.getElementById("fallback-options");
  const mapEmptyHint = document.getElementById("map-empty-hint");
  const samplePresetBanner = document.getElementById("sample-preset-banner");
  const runHint = document.getElementById("run-hint");

  const btnLoadSample = document.getElementById("btn-load-sample");
  const btnRunOverlay = document.getElementById("btn-run-overlay");
  const progressContainer = document.getElementById("progress-container");
  const progressBarFill = document.getElementById("progress-bar-fill");
  const progressLabel = document.getElementById("progress-label");

  const paletteSelect = document.getElementById("palette-select");
  const btnZoomExtent = document.getElementById("btn-zoom-extent");

  const tableSearchInput = document.getElementById("table-search-input");
  const statusFilter = document.getElementById("status-filter");
  const resultsTable = document.getElementById("results-table");
  const tableBody = document.getElementById("table-body");
  const tableCountDisplay = document.getElementById("table-count-display");
  const tableSortIndicator = document.getElementById("table-sort-indicator");

  // ----------------------------------------------------
  // Toast Helper
  // ----------------------------------------------------
  function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    const icon = type === "success" ? "check" : type === "error" ? "circle-exclamation" : "circle-info";
    toast.innerHTML = `<i class="fa-solid fa-${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 250);
    }, 4500);
  }

  // ----------------------------------------------------
  // Tolerance Visual Guide Modal
  // ----------------------------------------------------
  let guideOpener = null;

  function openGuide() {
    if (!guideModal) return;
    guideOpener = document.activeElement;
    guideModal.classList.remove("hidden");
    const closeBtn = document.getElementById("btn-close-guide");
    if (closeBtn) closeBtn.focus();
  }

  function closeGuide() {
    if (guideModal) guideModal.classList.add("hidden");
    if (guideOpener && typeof guideOpener.focus === "function") {
      guideOpener.focus();
    }
  }

  if (btnOpenGuide && guideModal) {
    btnOpenGuide.addEventListener("click", openGuide);
  }
  if (btnOpenGuideHeader && guideModal) {
    btnOpenGuideHeader.addEventListener("click", openGuide);
  }

  function syncFallbackOptions() {
    const on = !fallbackToggle || fallbackToggle.checked;
    [fallbackRatioInput, fallbackDistanceInput].forEach((el) => {
      if (el) el.disabled = !on;
    });
    if (fallbackOptions) fallbackOptions.classList.toggle("is-disabled", !on);
    const tip = document.getElementById("help-fallback");
    const maxAngle = parseFloat(document.getElementById("param-max-angle")?.value);
    const cap = Math.max(Number.isFinite(maxAngle) ? maxAngle : 30, 45);
    if (tip) {
      tip.setAttribute(
        "data-tip",
        on
          ? `Second chance for short destination lines that fail Min Overlap. Still needs Min Coverage and Max Distance. Heading can be looser than Max Angle: fallback allows up to the larger of Max Angle and 45° (now ${cap}°). Primary matches still use Max Angle only.`
          : "Fallback is off. Only the primary rules apply: Min Overlap, Min Target Ratio, and Max Angle."
      );
    }
  }

  if (fallbackToggle) {
    fallbackToggle.addEventListener("change", syncFallbackOptions);
    syncFallbackOptions();
  }
  const maxAngleInput = document.getElementById("param-max-angle");
  if (maxAngleInput) {
    maxAngleInput.addEventListener("input", syncFallbackOptions);
    maxAngleInput.addEventListener("change", syncFallbackOptions);
  }

  function featureKey(props, fallback) {
    if (props && props._feat_id !== undefined) return String(props._feat_id);
    if (props && props._orig_fid !== undefined) return `${props._orig_fid}:${props._part_id ?? 0}`;
    return String(fallback ?? "");
  }

  function resetStats() {
    document.getElementById("stat-total").textContent = "0";
    document.getElementById("stat-matched").textContent = "0";
    document.getElementById("stat-unmatched").textContent = "0";
    document.getElementById("stat-rate").textContent = "0%";
    document.getElementById("stat-time").textContent = "0.00s";
  }

  function clearOverlayResults(note) {
    currentResults = null;
    currentTableData = [];
    if (tableBody) {
      tableBody.innerHTML = `<tr><td colspan="10" class="table-empty-msg">${note || "No results. Load layers and run overlay."}</td></tr>`;
    }
    if (tableCountDisplay) tableCountDisplay.textContent = "Showing 0 of 0 records";
    resetStats();
    if (mapViewer && typeof mapViewer.clearOverlayResults === "function") {
      mapViewer.clearOverlayResults();
    }
    const exportBtn = document.getElementById("btn-table-export");
    if (exportBtn) exportBtn.disabled = true;
  }

  let showLoadLayersHint = false;

  function syncRunButton() {
    const ready = Boolean(targetLayerData && refLayerData);
    if (ready) showLoadLayersHint = false;
    if (btnRunOverlay) {
      btnRunOverlay.disabled = false;
      btnRunOverlay.classList.toggle("is-inactive", !ready);
      btnRunOverlay.setAttribute("aria-disabled", ready ? "false" : "true");
      btnRunOverlay.title = ready ? "Run spatial overlay" : "Load both layers first";
    }
    if (runHint) {
      if (!ready) {
        if (showLoadLayersHint) {
          runHint.textContent = "Load destination and reference to enable Run.";
          runHint.classList.remove("hidden");
          runHint.classList.add("is-stale");
        } else {
          runHint.textContent = "";
          runHint.classList.add("hidden");
          runHint.classList.remove("is-stale");
        }
      } else if (resultsStale) {
        runHint.textContent = "Inputs changed — run again.";
        runHint.classList.remove("hidden");
        runHint.classList.add("is-stale");
      } else if (!currentResults) {
        runHint.textContent = "Ready. Run overlay to match the current rules.";
        runHint.classList.remove("hidden");
        runHint.classList.remove("is-stale");
      } else {
        runHint.classList.add("hidden");
        runHint.classList.remove("is-stale");
      }
    }
  }

  function invalidateResults(note) {
    if (!currentResults && currentTableData.length === 0) {
      syncRunButton();
      return;
    }
    resultsStale = true;
    clearOverlayResults(note || "Inputs changed — run again.");
    syncRunButton();
  }

  function syncMapEmptyHint() {
    if (!mapEmptyHint) return;
    const hide = Boolean(targetLayerData && refLayerData);
    mapEmptyHint.classList.toggle("hidden", hide);
    mapEmptyHint.setAttribute("aria-hidden", hide ? "true" : "false");
  }

  if (btnCloseGuide && guideModal) {
    btnCloseGuide.addEventListener("click", closeGuide);
  }

  if (guideModal) {
    guideModal.addEventListener("click", (e) => {
      if (e.target === guideModal) closeGuide();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && guideModal && !guideModal.classList.contains("hidden")) {
      closeGuide();
    }
  });

  // ----------------------------------------------------
  // Draggable Splitters (Sidebar Width & Map/Table Height)
  // ----------------------------------------------------
  function initResizers() {
    if (sidebarResizer && sidebarPane) {
      let isDraggingSidebar = false;

      sidebarResizer.addEventListener("mousedown", (e) => {
        isDraggingSidebar = true;
        sidebarResizer.classList.add("dragging");
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        e.preventDefault();
      });

      window.addEventListener("mousemove", (e) => {
        if (!isDraggingSidebar) return;
        const newWidth = Math.max(270, Math.min(window.innerWidth - 340, e.clientX));
        sidebarPane.style.width = `${newWidth}px`;
        if (mapViewer && typeof mapViewer.resize === "function") {
          mapViewer.resize();
        }
      });

      window.addEventListener("mouseup", () => {
        if (isDraggingSidebar) {
          isDraggingSidebar = false;
          sidebarResizer.classList.remove("dragging");
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          if (mapViewer && typeof mapViewer.resize === "function") {
            mapViewer.resize();
          }
        }
      });
    }

    if (rowResizer && mapPane && gridPane) {
      let isDraggingRow = false;
      const workstation = document.getElementById("workstation-pane");

      rowResizer.addEventListener("mousedown", (e) => {
        isDraggingRow = true;
        rowResizer.classList.add("dragging");
        document.body.style.cursor = "row-resize";
        document.body.style.userSelect = "none";
        e.preventDefault();
      });

      window.addEventListener("mousemove", (e) => {
        if (!isDraggingRow) return;
        const workstationRect = workstation.getBoundingClientRect();
        const offsetTop = e.clientY - workstationRect.top;
        const totalHeight = workstationRect.height;
        const mapHeight = Math.max(160, Math.min(totalHeight - 140, offsetTop));
        
        mapPane.style.flex = "none";
        mapPane.style.height = `${mapHeight}px`;
        gridPane.style.flex = "1";

        if (mapViewer && typeof mapViewer.resize === "function") {
          mapViewer.resize();
        }
      });

      window.addEventListener("mouseup", () => {
        if (isDraggingRow) {
          isDraggingRow = false;
          rowResizer.classList.remove("dragging");
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          if (mapViewer && typeof mapViewer.resize === "function") {
            mapViewer.resize();
          }
        }
      });
    }
  }

  initResizers();

  // ----------------------------------------------------
  // Color Palette Selector
  // ----------------------------------------------------
  if (paletteSelect) {
    paletteSelect.addEventListener("change", (e) => {
      if (mapViewer) {
        mapViewer.setPalette(e.target.value);
        showToast(`Theme updated to ${PALETTES[e.target.value].name}`, "info");
      }
    });
  }

  // ----------------------------------------------------
  // Drag & Drop and File Ingestion (100% In-Browser)
  // ----------------------------------------------------
  function setupDropZone(dropElement, fileInput, role) {
    if (!dropElement) return;

    ["dragenter", "dragover"].forEach((eventName) => {
      dropElement.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropElement.classList.add("drag-over");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      dropElement.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropElement.classList.remove("drag-over");
      });
    });

    dropElement.addEventListener("drop", (e) => {
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length > 0) {
        handleClientFileUpload(dt.files, role);
      }
    });

    if (fileInput) {
      fileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files.length > 0) {
          handleClientFileUpload(e.target.files, role);
        }
      });
    }
  }

  setupDropZone(targetBlock, targetFileInput, "target");
  setupDropZone(refBlock, refFileInput, "reference");

  function getSourceCrsHint() {
    const crsSelect = document.getElementById("param-crs-select");
    return crsSelect ? crsSelect.value : "4326";
  }

  async function handleClientFileUpload(fileList, role) {
    const displayName = fileList.length === 1 ? fileList[0].name : `${fileList[0].name} (+${fileList.length - 1} files)`;
    showToast(`Parsing ${displayName} in browser...`, "info");

    try {
      const layerInfo = await ClientGISEngine.parseUploadedFiles(fileList, {
        source_crs: getSourceCrsHint(),
      });

      if (role === "target") {
        targetLayerData = layerInfo;
        updateTargetUI(layerInfo);
        if (mapViewer) mapViewer.displayTargetPreview(layerInfo.geojson);
        if (targetFileInput) targetFileInput.value = "";
      } else {
        refLayerData = layerInfo;
        updateRefUI(layerInfo);
        if (mapViewer) mapViewer.displayReferenceLayer(layerInfo.geojson);
        populateReferenceColumns(layerInfo.columns);
        if (refFileInput) refFileInput.value = "";
      }

      const minOverlap = document.getElementById("param-min-overlap");
      if (minOverlap) minOverlap.value = "300";
      const keepDup = document.querySelector('input[name="duplicate-mode"][value="keep"]');
      if (keepDup) keepDup.checked = true;
      if (samplePresetBanner) samplePresetBanner.classList.add("hidden");
      resultsStale = false;
      clearOverlayResults("New layer loaded — run overlay.");
      syncRunButton();
      showToast(`Loaded ${layerInfo.feature_count} features from ${layerInfo.layer_name}`, "success");
    } catch (err) {
      console.error("Client GIS Parse Error:", err);
      showToast(`Layer parsing error: ${err.message}`, "error");
    }
  }

  function updateTargetUI(info) {
    targetFilename.textContent = info.layer_name;
    targetFilename.title = info.layer_name;
    targetFilename.classList.remove("is-empty");
    targetCount.textContent = info.feature_count.toLocaleString();
    targetMultipart.textContent = info.multipart_count.toLocaleString();
    targetCrs.textContent = info.source_crs;
    targetCrs.title = info.source_crs;
    targetMeta.classList.remove("hidden");

    if (info.warnings && info.warnings.length > 0) {
      targetAlert.classList.remove("hidden");
      targetAlert.textContent = info.warnings[0];
    } else {
      targetAlert.classList.add("hidden");
    }
    populateDestIdFields(info.columns);
    syncMapEmptyHint();
  }

  function populateDestIdFields(columns) {
    const destIdRow = document.getElementById("dest-id-row");
    const destIdSelect = document.getElementById("dest-id-field");
    if (!destIdRow || !destIdSelect) return;
    destIdSelect.innerHTML = "";
    const cols = columns || [];
    if (!cols.length) {
      destIdRow.classList.add("hidden");
      return;
    }
    const guessed = ClientGISEngine.pickDefaultDestIdField(cols);
    cols.forEach((col) => {
      const opt = document.createElement("option");
      opt.value = col;
      opt.textContent = col;
      destIdSelect.appendChild(opt);
    });
    destIdSelect.value = guessed || cols[0];
    destIdRow.classList.remove("hidden");
  }

  function selectedDestIdField() {
    const destIdSelect = document.getElementById("dest-id-field");
    return destIdSelect && destIdSelect.value ? destIdSelect.value : "";
  }

  function restampDestIds() {
    const field = selectedDestIdField();
    if (!currentTableData.length) return;
    currentTableData.forEach((row) => {
      row.Dest_ID = ClientGISEngine.resolveDestId(row, field);
    });
    if (currentResults && currentResults.geojson && currentResults.geojson.features) {
      currentResults.geojson.features.forEach((feat) => {
        if (feat && feat.properties) {
          feat.properties.Dest_ID = ClientGISEngine.resolveDestId(feat.properties, field);
        }
      });
    }
    applyTableFiltersAndSort();
  }

  function updateRefUI(info) {
    refFilename.textContent = info.layer_name;
    refFilename.title = info.layer_name;
    refFilename.classList.remove("is-empty");
    refCount.textContent = info.feature_count.toLocaleString();
    refMultipart.textContent = info.multipart_count.toLocaleString();
    refCrs.textContent = info.source_crs;
    refCrs.title = info.source_crs;
    refMeta.classList.remove("hidden");

    if (info.warnings && info.warnings.length > 0) {
      refAlert.classList.remove("hidden");
      refAlert.textContent = info.warnings[0];
    } else {
      refAlert.classList.add("hidden");
    }
    syncMapEmptyHint();
  }

  // ----------------------------------------------------
  // Section 2: Combined Column Buttons & Expression Sync
  // ----------------------------------------------------
  function populateReferenceColumns(columns) {
    columnButtonsContainer.innerHTML = "";

    if (!columns || columns.length === 0) {
      columnButtonsContainer.innerHTML = '<span class="empty-hint">No attributes found in reference layer</span>';
      return;
    }

    // Default active columns
    const preferredCols = ["ITEMSEG", "WPITEM", "WPITMSEG", "high_yr_ph", "PHASE", "FISCAL_YR"];
    const defaultActives = [];

    columns.forEach((col) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sci-col-btn";
      btn.dataset.col = col;
      btn.innerHTML = `<span class="col-name">${col}</span>`;

      // Check default selection
      if (preferredCols.includes(col)) {
        if (defaultActives.length < 2) {
          btn.classList.add("active");
          defaultActives.push(col);
        }
      }

      btn.addEventListener("click", () => {
        btn.classList.toggle("active");
        updateExpressionFromActiveButtons();
        invalidateResults();
      });

      columnButtonsContainer.appendChild(btn);
    });

    // If no preferred columns matched, activate first column
    if (defaultActives.length === 0 && columns.length > 0) {
      const firstBtn = columnButtonsContainer.querySelector(".sci-col-btn");
      if (firstBtn) firstBtn.classList.add("active");
    }

    updateExpressionFromActiveButtons();
  }

  function updateExpressionFromActiveButtons() {
    const activeBtns = columnButtonsContainer.querySelectorAll(".sci-col-btn.active");
    const activeCols = Array.from(activeBtns).map((b) => b.dataset.col);

    if (activeCols.length === 0) {
      customExprInput.value = "";
    } else {
      customExprInput.value = activeCols.map((c) => `{${c}}`).join(" - ");
    }
  }

  function syncActiveButtonsFromExpression() {
    const text = customExprInput.value;
    const tokens = (text.match(/\{([^}]+)\}/g) || []).map((t) => t.replace(/[{}]/g, "").trim());

    columnButtonsContainer.querySelectorAll(".sci-col-btn").forEach((btn) => {
      const col = btn.dataset.col;
      if (tokens.includes(col)) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }

  if (customExprInput) {
    customExprInput.addEventListener("input", syncActiveButtonsFromExpression);
  }

  if (btnClearColumns) {
    btnClearColumns.addEventListener("click", () => {
      columnButtonsContainer.querySelectorAll(".sci-col-btn").forEach((b) => b.classList.remove("active"));
      customExprInput.value = "";
      invalidateResults();
    });
  }

  if (btnResetExpr) {
    btnResetExpr.addEventListener("click", () => {
      updateExpressionFromActiveButtons();
      invalidateResults();
    });
  }

  // ----------------------------------------------------
  // Load example-case layers (real WP + treatment linework)
  // ----------------------------------------------------
  const SAMPLE_DEST_ZIP = "./example_case/candidates/Left-Turn ProtPerm to Prot Only_shp.zip";
  const SAMPLE_REF_ZIP = "./example_case/work-programs/Work_Program_Identify.zip";

  async function fetchExampleAsFile(relPath, fileName) {
    const res = await fetch(encodeURI(relPath));
    if (!res.ok) {
      throw new Error(
        `Could not load ${fileName} (${res.status}). Serve the app from the project folder so example_case/ is available.`
      );
    }
    return new File([await res.arrayBuffer()], fileName, { type: "application/octet-stream" });
  }

  function applyExampleJobSettings(columns) {
    const minOverlap = document.getElementById("param-min-overlap");
    if (minOverlap) minOverlap.value = "75";
    const uniqueIds = document.querySelector('input[name="duplicate-mode"][value="dedup"]');
    if (uniqueIds) uniqueIds.checked = true;
    if (columns.includes("WPITEM") && columns.includes("WPITMSEG")) {
      customExprInput.value = "{WPITEM}-{WPITMSEG}";
      syncActiveButtonsFromExpression();
    }
    if (samplePresetBanner) samplePresetBanner.classList.remove("hidden");
  }

  btnLoadSample.addEventListener("click", async () => {
    btnLoadSample.disabled = true;
    try {
      showToast("Loading example Left-Turn ProtPerm layer…", "info");
      const destFile = await fetchExampleAsFile(
        SAMPLE_DEST_ZIP,
        "Left-Turn ProtPerm to Prot Only_shp.zip"
      );
      const targetInfo = await ClientGISEngine.parseUploadedFiles([destFile], {
        source_crs: "4326",
      });
      targetLayerData = targetInfo;
      updateTargetUI(targetInfo);
      if (mapViewer) mapViewer.displayTargetPreview(targetInfo.geojson);

      showToast("Loading example Work Program Identify layer…", "info");
      const refFile = await fetchExampleAsFile(
        SAMPLE_REF_ZIP,
        "Work_Program_Identify.zip"
      );
      const refInfo = await ClientGISEngine.parseUploadedFiles([refFile], {
        source_crs: "3087",
      });
      refLayerData = refInfo;
      updateRefUI(refInfo);
      if (mapViewer) mapViewer.displayReferenceLayer(refInfo.geojson);
      populateReferenceColumns(refInfo.columns);
      applyExampleJobSettings(refInfo.columns);
      resultsStale = false;
      clearOverlayResults("Sample layers loaded — run overlay.");
      syncRunButton();

      showToast(
        `Sample loaded (${targetInfo.feature_count.toLocaleString()} dest, ${refInfo.feature_count.toLocaleString()} WP). Min overlap set to 75 ft, Unique Matched IDs, {WPITEM}-{WPITMSEG}.`,
        "success"
      );
    } catch (err) {
      console.error("Load sample error:", err);
      showToast(`Failed to load example data: ${err.message}`, "error");
    } finally {
      btnLoadSample.disabled = false;
    }
  });

  // ----------------------------------------------------
  // Run Line-to-Line Overlay (100% In-Browser Engine)
  // ----------------------------------------------------
  btnRunOverlay.addEventListener("click", async () => {
    if (!targetLayerData || !refLayerData) {
      showLoadLayersHint = true;
      syncRunButton();
      return;
    }

    const activeBtns = columnButtonsContainer.querySelectorAll(".sci-col-btn.active");
    const selectedCols = Array.from(activeBtns).map((b) => b.dataset.col);
    const customTemplate = customExprInput.value.trim();
    const duplicateMode = document.querySelector('input[name="duplicate-mode"]:checked').value;
    const angleModeEl = document.querySelector('input[name="angle-mode"]:checked');
    const readParam = (id, fallback, min, max) => {
      const el = document.getElementById(id);
      let value = parseFloat(el?.value);
      if (!Number.isFinite(value)) value = fallback;
      if (min !== undefined) value = Math.max(min, value);
      if (max !== undefined) value = Math.min(max, value);
      if (el && String(el.value) !== String(value)) el.value = String(value);
      return value;
    };
    const bufferDist = readParam("param-buffer", 300, 10, 2000);
    const minOverlap = readParam("param-min-overlap", 300, 10, 5000);
    const targetRatio = readParam("param-target-ratio", 10, 1, 100);
    const maxAngle = readParam("param-max-angle", 30, 1, 180);
    const bearingWindow = readParam("param-bearing-window", 500, 50, 5000);
    const enableFallback = document.getElementById("param-fallback-toggle")?.checked;
    const fallbackRatio = readParam("param-fallback-ratio", 75, 1, 100);
    const fallbackDistance = readParam("param-fallback-distance", 30, 1, 300);

    btnRunOverlay.disabled = true;
    progressContainer.classList.remove("hidden");
    progressBarFill.style.width = "4%";
    progressLabel.textContent = "Computing spatial overlay in browser...";

    try {
      const options = {
        buffer_distance: Number.isFinite(bufferDist) ? bufferDist : 300,
        min_overlap_length: Number.isFinite(minOverlap) ? minOverlap : 300,
        min_target_overlap_ratio: Number.isFinite(targetRatio) ? targetRatio : 10,
        max_angle_diff_deg: Number.isFinite(maxAngle) ? maxAngle : 30,
        bearing_window_length: Number.isFinite(bearingWindow) ? bearingWindow : 500,
        angle_mode: angleModeEl ? angleModeEl.value : "undirected",
        enable_strong_fallback: enableFallback !== false,
        fallback_min_ratio: Number.isFinite(fallbackRatio) ? fallbackRatio : 75,
        fallback_max_distance: Number.isFinite(fallbackDistance) ? fallbackDistance : 30,
        reference_columns: selectedCols,
        custom_expression_template: customTemplate || null,
        keep_duplicates: duplicateMode === "keep",
        destination_id_column: selectedDestIdField()
      };

      const result = await ClientGISEngine.runOverlayAnalysis(
        targetLayerData.geojson,
        refLayerData.geojson,
        options,
        (pct, msg) => {
          progressBarFill.style.width = `${pct}%`;
          progressLabel.textContent = msg;
        }
      );

      currentResults = result;
      currentResults.export_rules = {
        ...options,
        destination_layer: targetLayerData && targetLayerData.layer_name,
        reference_layer: refLayerData && refLayerData.layer_name,
        ran_at: new Date().toISOString(),
      };
      currentTableData = result.table_data;
      resultsStale = false;

      activeSortColumn = null;
      activeSortDirection = "asc";

      document.getElementById("stat-total").textContent = result.stats.total_targets;
      document.getElementById("stat-matched").textContent = result.stats.matched_targets;
      document.getElementById("stat-unmatched").textContent = result.stats.unmatched_targets;
      document.getElementById("stat-rate").textContent = `${result.stats.match_percentage}%`;
      document.getElementById("stat-time").textContent = `${result.stats.duration_seconds}s`;

      if (mapViewer) {
        mapViewer.displayOverlayResults(result.geojson, (feature) => {
          highlightTableRow(feature.properties);
        });
      }

      applyTableFiltersAndSort();
      if (btnTableExport) btnTableExport.disabled = false;
      syncRunButton();

      showToast(`Matched ${result.stats.matched_targets} of ${result.stats.total_targets} segments in ${result.stats.duration_seconds}s.`, "success");
    } catch (err) {
      console.error("Overlay calculation error:", err);
      showToast(`Overlay Error: ${err.message}`, "error");
    } finally {
      setTimeout(() => progressContainer.classList.add("hidden"), 600);
      syncRunButton();
    }
  });

  // ----------------------------------------------------
  // Scientific Sorting Logic (Matched -> Angle Mismatch -> Unmatched)
  // ----------------------------------------------------
  function getScientificRank(row) {
    const stat = (row.Match_Stat || row.Match_Status || "").toLowerCase();
    const qc = (row.QC_Flag || "").toLowerCase();
    if (stat.includes("on corridor") || qc.includes("verified")) return 1;
    if (qc.includes("angle")) return 2;
    if (qc.includes("overlap") || qc.includes("low")) return 3;
    return 4; // Unmatched / other
  }

  function sortRecords(records) {
    const sorted = [...records];

    if (!activeSortColumn) {
      // Default Scientific Sort
      sorted.sort((a, b) => {
        const rankA = getScientificRank(a);
        const rankB = getScientificRank(b);
        if (rankA !== rankB) return rankA - rankB;
        // Secondary sort by overlap length descending
        return (b.Ovl_Ft || 0) - (a.Ovl_Ft || 0);
      });
      if (tableSortIndicator) {
        tableSortIndicator.textContent = "Sorted: Matched → Angle mismatch → Unmatched";
      }
      return sorted;
    }

    // Dynamic Column Sorting
    sorted.sort((a, b) => {
      let valA = a[activeSortColumn];
      let valB = b[activeSortColumn];

      if (valA === undefined || valA === null) valA = "";
      if (valB === undefined || valB === null) valB = "";

      let comparison = 0;
      if (typeof valA === "number" && typeof valB === "number") {
        comparison = valA - valB;
      } else {
        comparison = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: "base" });
      }

      return activeSortDirection === "asc" ? comparison : -comparison;
    });

    if (tableSortIndicator) {
      tableSortIndicator.textContent = `Sorted by ${activeSortColumn} (${activeSortDirection.toUpperCase()})`;
    }
    return sorted;
  }

  // ----------------------------------------------------
  // Table Column Header Click to Sort
  // ----------------------------------------------------
  if (resultsTable) {
    resultsTable.querySelectorAll("th.sortable").forEach((th) => {
      th.addEventListener("click", () => {
        const col = th.getAttribute("data-col");
        if (!col) return;

        if (activeSortColumn === col) {
          activeSortDirection = activeSortDirection === "asc" ? "desc" : "asc";
        } else {
          activeSortColumn = col;
          const isNumeric = ["Match_Cnt", "Ovl_Ft", "Ovl_Mi", "Ovl_Pct", "Ang_Dif", "Min_Ft"].includes(col);
          activeSortDirection = isNumeric ? "desc" : "asc";
        }

        // Update header sort icons
        resultsTable.querySelectorAll("th.sortable").forEach((h) => {
          h.classList.remove("sorted-asc", "sorted-desc");
          const icon = h.querySelector(".sort-icon");
          if (icon) icon.className = "fa-solid fa-sort sort-icon";
        });

        th.classList.add(activeSortDirection === "asc" ? "sorted-asc" : "sorted-desc");
        const activeIcon = th.querySelector(".sort-icon");
        if (activeIcon) {
          activeIcon.className = `fa-solid fa-sort-${activeSortDirection === "asc" ? "up" : "down"} sort-icon`;
        }

        applyTableFiltersAndSort();
      });
    });
  }

  // ----------------------------------------------------
  // Table Rendering & Filters
  // ----------------------------------------------------
  function applyTableFiltersAndSort() {
    const query = tableSearchInput.value.toLowerCase().trim();
    const statusVal = statusFilter.value;

    const filtered = currentTableData.filter((row) => {
      const status = row.Match_Stat || row.Match_Status || "Off Corridor";
      if (statusVal !== "ALL" && status !== statusVal) return false;
      if (query) {
        const rowStr = Object.values(row).join(" ").toLowerCase();
        return rowStr.includes(query);
      }
      return true;
    });

    const sorted = sortRecords(filtered);
    renderTable(sorted);
  }

  function renderTable(records) {
    tableBody.innerHTML = "";
    if (!records || records.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="10" class="table-empty-msg">No records match the current filter.</td></tr>`;
      tableCountDisplay.textContent = `Showing 0 of ${currentTableData.length} records`;
      return;
    }

    records.forEach((row, idx) => {
      const tr = document.createElement("tr");
      tr.id = `row-${idx}`;
      tr.dataset.origFid = featureKey(row, idx);

      const status = row.Match_Stat || row.Match_Status || "Off Corridor";
      const isMatched = status === "On Corridor";
      const statusBadge = `<span class="table-badge ${isMatched ? 'on' : 'off'}">${status}</span>`;

      const overlapFtStr = row.Ovl_Ft !== undefined && row.Ovl_Ft !== null ? `${row.Ovl_Ft.toLocaleString()}` : "-";
      const overlapMiStr = row.Ovl_Mi !== undefined && row.Ovl_Mi !== null ? `${row.Ovl_Mi.toFixed(2)}` : (row.Ovl_Ft !== undefined ? `${(row.Ovl_Ft / 5280).toFixed(2)}` : "-");
      const minDistStr = row.Min_Ft !== undefined && row.Min_Ft !== null ? `${row.Min_Ft}` : "-";

      const destId = row.Dest_ID || ClientGISEngine.resolveDestId(row, selectedDestIdField()) || "-";
      const splitIds = (raw) => String(raw || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      const displayIds = splitIds(row.Matched_ID);
      let allMatchIds = displayIds;
      if (Array.isArray(row._matched_refs) && row._matched_refs.length) {
        allMatchIds = row._matched_refs.map((ref) => ref && ref.tag).filter(Boolean);
      }
      const matchCount = Number(row.Match_Cnt);
      const totalIds = Number.isFinite(matchCount) && matchCount > 0 ? matchCount : allMatchIds.length;
      const matchedFull = allMatchIds.join(", ");
      const matchedCollapsed = displayIds.length > 5 || allMatchIds.length > 5 || totalIds > 5;
      const matchedPreview = displayIds.length > 5
        ? `${displayIds.slice(0, 5).join(", ")}…`
        : (displayIds.join(", ") || "-");

      tr.innerHTML = `
        <td>${statusBadge}</td>
        <td>${destId}</td>
        <td class="matched-id-col">
          <div class="matched-id-cell${isMatched ? " is-match" : ""}">
            <span class="matched-id-text">${matchedPreview}</span>
            ${matchedCollapsed ? `<button type="button" class="matched-id-toggle" aria-expanded="false">See all (${totalIds})</button>` : ""}
          </div>
        </td>
        <td>${row.Match_Cnt !== undefined ? row.Match_Cnt : '-'}</td>
        <td>${overlapFtStr}</td>
        <td>${overlapMiStr}</td>
        <td>${row.Ovl_Pct !== undefined && row.Ovl_Pct !== null ? row.Ovl_Pct : '-'}</td>
        <td>${row.Ang_Dif !== undefined && row.Ang_Dif !== null ? row.Ang_Dif : '-'}</td>
        <td>${minDistStr}</td>
        <td><span style="color: ${row.QC_Flag && row.QC_Flag.startsWith('Verified') ? 'var(--match-color)' : 'var(--warn-color)'}; font-weight: 500;">${row.QC_Flag || '-'}</span></td>
      `;

      const matchedText = tr.querySelector(".matched-id-text");
      const matchedToggle = tr.querySelector(".matched-id-toggle");
      if (matchedText) matchedText.title = matchedFull || "";
      if (matchedToggle && matchedText) {
        matchedToggle.addEventListener("click", (e) => {
          e.stopPropagation();
          const cell = matchedToggle.closest(".matched-id-cell");
          const open = cell.classList.toggle("is-open");
          matchedText.textContent = open ? matchedFull : matchedPreview;
          matchedToggle.textContent = open ? "Hide" : `See all (${totalIds})`;
          matchedToggle.setAttribute("aria-expanded", open ? "true" : "false");
        });
      }

      const activateRow = () => {
        document.querySelectorAll(".sci-table tr").forEach((r) => r.classList.remove("selected"));
        tr.classList.add("selected");
        if (mapViewer) {
          mapViewer.zoomToFeatureById(featureKey(row, idx), row);
        }
      };
      tr.tabIndex = 0;
      tr.addEventListener("click", activateRow);
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activateRow();
        }
      });

      tableBody.appendChild(tr);
    });

    tableCountDisplay.textContent = `Showing ${records.length} of ${currentTableData.length} records`;
  }

  function highlightTableRow(props) {
    const fid = featureKey(props);
    const selectMatching = () => {
      let found = false;
      tableBody.querySelectorAll("tr").forEach((r) => {
        r.classList.remove("selected");
        if (fid && r.dataset.origFid === fid) {
          r.classList.add("selected");
          r.scrollIntoView({ behavior: "smooth", block: "nearest" });
          found = true;
        }
      });
      return found;
    };
    if (selectMatching()) return;
    if (!fid || !currentTableData.length) return;
    if (statusFilter) statusFilter.value = "ALL";
    if (tableSearchInput) tableSearchInput.value = "";
    applyTableFiltersAndSort();
    selectMatching();
  }

  tableSearchInput.addEventListener("input", applyTableFiltersAndSort);
  statusFilter.addEventListener("change", applyTableFiltersAndSort);
  const destIdSelect = document.getElementById("dest-id-field");
  if (destIdSelect) destIdSelect.addEventListener("change", restampDestIds);

  [
    "param-buffer",
    "param-min-overlap",
    "param-target-ratio",
    "param-max-angle",
    "param-bearing-window",
    "param-fallback-ratio",
    "param-fallback-distance",
    "custom-expr-input",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", () => invalidateResults());
  });
  document.querySelectorAll('input[name="angle-mode"], input[name="duplicate-mode"]').forEach((el) => {
    el.addEventListener("change", () => invalidateResults());
  });
  if (fallbackToggle) {
    fallbackToggle.addEventListener("change", () => invalidateResults());
  }

  // ----------------------------------------------------
  // Map Tools
  // ----------------------------------------------------
  if (btnZoomExtent) {
    btnZoomExtent.addEventListener("click", () => {
      if (mapViewer) mapViewer.fitBounds();
    });
  }

  // ----------------------------------------------------
  // Export Results Dropdown Menu (Under Table Header)
  // ----------------------------------------------------
  const btnTableExport = document.getElementById("btn-table-export");
  const tableExportMenu = document.getElementById("table-export-menu");

  function sanitizeExportPart(name, fallback) {
    const raw = String(name || "").trim();
    const noExt = raw.replace(/\.(zip|shp|shx|dbf|prj|geojson|json|kml|kmz|csv)$/i, "");
    const cleaned = noExt
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[._-]+|[._-]+$/g, "");
    return cleaned.slice(0, 60) || fallback;
  }

  function overlayExportStem() {
    const dest = sanitizeExportPart(targetLayerData && targetLayerData.layer_name, "destination");
    const ref = sanitizeExportPart(refLayerData && refLayerData.layer_name, "reference");
    return `${dest}_x_${ref}`;
  }

  if (btnTableExport && tableExportMenu) {
    btnTableExport.addEventListener("click", (e) => {
      e.stopPropagation();
      tableExportMenu.classList.toggle("show");
    });

    tableExportMenu.addEventListener("click", async (e) => {
      const item = e.target.closest(".dropdown-item");
      if (!item) return;
      if (!currentResults || !currentTableData || currentTableData.length === 0) {
        showToast("Please run overlay analysis before exporting.", "error");
        return;
      }

      const format = item.getAttribute("data-format");
      const stem = overlayExportStem();
      showToast(`Generating ${format.toUpperCase()} export in browser...`, "info");

      try {
        if (format === "shapefile") {
          const layerName = stem.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").slice(0, 40) || "Overlay_Results";
          const includeRules = document.getElementById("param-export-match-rules")?.checked !== false;
          const extraFiles = [];
          if (includeRules) {
            extraFiles.push({
              name: `${layerName}_MatchRules.txt`,
              content: ClientGISEngine.formatMatchRulesSidecar(currentResults.export_rules || {}),
            });
          }
          await ClientGISEngine.exportShapefile(currentResults.geojson, `${stem}.zip`, layerName, extraFiles);
        } else if (format === "geojson") {
          ClientGISEngine.exportGeoJSON(currentResults.geojson, `${stem}.geojson`);
        } else if (format === "csv") {
          ClientGISEngine.exportCSV(currentTableData, `${stem}.csv`);
        } else if (format === "excel") {
          ClientGISEngine.exportExcel(currentTableData, `${stem}.xlsx`);
        }
        showToast(`Exported ${format.toUpperCase()} successfully.`, "success");
      } catch (err) {
        console.error("Export error:", err);
        showToast(`Export failed: ${err.message}`, "error");
      }
    });
  }

  document.addEventListener("click", () => {
    if (tableExportMenu) tableExportMenu.classList.remove("show");
  });

  if (btnTableExport) btnTableExport.disabled = true;
  syncRunButton();
});
