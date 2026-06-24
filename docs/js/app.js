(() => {
  const TREATMENT_TYPES = [
    "Fuel treatment",
    "Planned burn",
    "Both",
    "Other / unsure",
  ];

  const BASEMAPS = {
    osm: {
      label: "Streets (OpenStreetMap)",
      create: () =>
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
        }),
    },
    topo: {
      label: "Topographic (OpenTopoMap)",
      create: () =>
        L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
          attribution:
            'Map: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, <a href="https://opentopomap.org">OpenTopoMap</a>',
          maxZoom: 17,
        }),
    },
    esri_topo: {
      label: "Topographic (Esri)",
      create: () =>
        L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
          {
            attribution: "Tiles &copy; Esri",
            maxZoom: 18,
          }
        ),
    },
    imagery: {
      label: "Satellite (Esri)",
      create: () =>
        L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          {
            attribution: "Tiles &copy; Esri",
            maxZoom: 18,
          }
        ),
    },
    light: {
      label: "Light gray (Carto)",
      create: () =>
        L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
          subdomains: "abcd",
          maxZoom: 20,
        }),
    },
  };

  const state = {
    map: null,
    wferLayer: null,
    basemapLayer: null,
    basemapKey: "osm",
    drawnLayer: null,
    supabase: null,
    submissionId: localStorage.getItem("nh_submission_id"),
    selectedLayer: null,
    treatmentTypes: TREATMENT_TYPES,
    lastSavedAt: null,
    pendingRestore: null,
    areaFilter: "",
  };

  const els = {
    participant: document.getElementById("participant"),
    saveAllBtn: document.getElementById("saveAllBtn"),
    newSubmissionBtn: document.getElementById("newSubmissionBtn"),
    deleteSubmissionBtn: document.getElementById("deleteSubmissionBtn"),
    exportBtn: document.getElementById("exportBtn"),
    toggleBasemap: document.getElementById("toggleBasemap"),
    basemapSelect: document.getElementById("basemapSelect"),
    toggleWfer: document.getElementById("toggleWfer"),
    status: document.getElementById("status"),
    lastSaved: document.getElementById("lastSaved"),
    featurePanel: document.getElementById("featurePanel"),
    featureForm: document.getElementById("featureForm"),
    featureName: document.getElementById("featureName"),
    featureType: document.getElementById("featureType"),
    featureNotes: document.getElementById("featureNotes"),
    renameFeatureBtn: document.getElementById("renameFeatureBtn"),
    saveAreaBtn: document.getElementById("saveAreaBtn"),
    deleteFeatureBtn: document.getElementById("deleteFeatureBtn"),
    areasTableBody: document.getElementById("areasTableBody"),
    yourAreasCount: document.getElementById("yourAreasCount"),
    areaTypeFilter: document.getElementById("areaTypeFilter"),
    submissionList: document.getElementById("submissionList"),
    continueDialog: document.getElementById("continueDialog"),
    continueDialogText: document.getElementById("continueDialogText"),
  };

  function setStatus(message, isError = false) {
    els.status.textContent = message;
    els.status.style.color = isError ? "#b42318" : "";
  }

  function setLastSaved(isoString) {
    state.lastSavedAt = isoString;
    if (!isoString) {
      els.lastSaved.hidden = true;
      els.lastSaved.textContent = "";
      return;
    }
    const when = new Date(isoString);
    els.lastSaved.hidden = false;
    els.lastSaved.textContent = `Last saved ${when.toLocaleString()}`;
  }

  function newSubmissionId() {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  }

  function newAreaId() {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  }

  function normalizeSupabaseUrl(url) {
    if (!url) return url;
    return url.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
  }

  function initSupabase() {
    const url = normalizeSupabaseUrl(window.SUPABASE_URL);
    const key = window.SUPABASE_ANON_KEY?.trim();
    if (!url || !key) return null;
    return window.supabase.createClient(url, key);
  }

  function featureCount(item) {
    const features = item?.features;
    if (Array.isArray(features)) return features.length;
    if (typeof features === "string") {
      try {
        const parsed = JSON.parse(features);
        return Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        return 0;
      }
    }
    return 0;
  }

  function ensureLayerProperties(layer) {
    layer.feature = layer.feature || {
      type: "Feature",
      properties: {},
      geometry: layer.toGeoJSON().geometry,
    };
    layer.feature.properties = layer.feature.properties || {};
    if (!layer.feature.properties.areaId) {
      layer.feature.properties.areaId = newAreaId();
    }
    return layer.feature.properties;
  }

  function clearSession({ keepName = false } = {}) {
    state.submissionId = null;
    localStorage.removeItem("nh_submission_id");
    if (!keepName) {
      els.participant.value = "";
    }
    setLastSaved(null);
  }

  function clearMap() {
    if (state.drawnLayer) {
      state.drawnLayer.clearLayers();
    }
    clearSelection();
    refreshAreasList();
  }

  function getDrawnLayers() {
    const layers = [];
    const seen = new Set();

    const addLayer = (layer) => {
      if (!layer || seen.has(layer) || typeof layer.toGeoJSON !== "function") return;
      const geometry = layer.toGeoJSON()?.geometry;
      if (!geometry) return;
      if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") return;
      seen.add(layer);
      layers.push(layer);
    };

    if (state.map?.pm?.getGeomanLayers) {
      state.map.pm.getGeomanLayers().forEach(addLayer);
    }
    if (state.drawnLayer) {
      state.drawnLayer.eachLayer(addLayer);
    }
    return layers;
  }

  function defaultStyle() {
    return {
      color: "#0f766e",
      weight: 2,
      fillColor: "#14b8a6",
      fillOpacity: 0.25,
    };
  }

  function selectedStyle() {
    return {
      color: "#b45309",
      weight: 3,
      fillColor: "#f59e0b",
      fillOpacity: 0.35,
    };
  }

  function layerToFeature(layer) {
    ensureLayerProperties(layer);
    const geo = layer.toGeoJSON();
    geo.properties = {
      ...layer.feature.properties,
      name: layer.feature.properties.name || "",
      treatmentType: layer.feature.properties.treatmentType || "",
      notes: layer.feature.properties.notes || "",
      areaId: layer.feature.properties.areaId,
    };
    return geo;
  }

  function bindLayer(layer) {
    ensureLayerProperties(layer);
    layer.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      selectLayer(layer);
    });
    layer.on("pm:edit", () => {
      ensureLayerProperties(layer);
      layer.feature.geometry = layer.toGeoJSON().geometry;
      if (state.selectedLayer === layer) {
        syncFormFromLayer(layer);
      }
      refreshAreasList();
    });
  }

  function selectLayer(layer, { zoom = false } = {}) {
    if (state.selectedLayer && state.selectedLayer !== layer) {
      state.selectedLayer.setStyle(defaultStyle());
    }
    state.selectedLayer = layer;
    layer.setStyle(selectedStyle());
    layer.bringToFront();
    syncFormFromLayer(layer);
    els.featurePanel.hidden = false;
    refreshAreasList();
    if (zoom && layer.getBounds) {
      state.map.fitBounds(layer.getBounds().pad(0.15));
    }
  }

  function clearSelection() {
    if (state.selectedLayer) {
      state.selectedLayer.setStyle(defaultStyle());
    }
    state.selectedLayer = null;
    els.featurePanel.hidden = true;
    refreshAreasList();
  }

  function syncFormFromLayer(layer) {
    const props = layer.feature?.properties || {};
    els.featureName.value = props.name || "";
    els.featureType.value = props.treatmentType || "";
    els.featureNotes.value = props.notes || "";
  }

  function applyFormToLayer(layer, { nameOnly = false } = {}) {
    ensureLayerProperties(layer);
    if (nameOnly) {
      layer.feature.properties.name = els.featureName.value.trim();
    } else {
      layer.feature.properties = {
        ...layer.feature.properties,
        name: els.featureName.value.trim(),
        treatmentType: els.featureType.value,
        notes: els.featureNotes.value.trim(),
      };
    }
    layer.feature.geometry = layer.toGeoJSON().geometry;

    const label =
      layer.feature.properties.name ||
      layer.feature.properties.treatmentType ||
      "Priority area";
    layer.bindTooltip(label, { sticky: true });
    refreshAreasList();
  }

  function featuresFromMap() {
    return getDrawnLayers().map(layerToFeature);
  }

  function loadFeatures(features) {
    state.drawnLayer.clearLayers();
    clearSelection();
    features.forEach((feature) => {
      const layer = L.geoJSON(feature, { style: defaultStyle() }).getLayers()[0];
      layer.feature = feature;
      ensureLayerProperties(layer);
      bindLayer(layer);
      const label = feature.properties?.name || feature.properties?.treatmentType;
      if (label) {
        layer.bindTooltip(label, { sticky: true });
      }
      state.drawnLayer.addLayer(layer);
    });
    refreshAreasList();
    if (features.length) {
      const bounds = state.drawnLayer.getBounds();
      if (bounds.isValid()) {
        state.map.fitBounds(bounds.pad(0.1));
      }
    }
  }

  function layerMatchesFilter(layer) {
    if (!state.areaFilter) return true;
    const type = layer.feature?.properties?.treatmentType || "";
    return type === state.areaFilter;
  }

  function refreshAreasList() {
    const layers = getDrawnLayers();
    els.yourAreasCount.textContent = String(layers.length);

    const visible = layers.filter(layerMatchesFilter);
    els.areasTableBody.innerHTML = "";

    if (!layers.length) {
      const row = document.createElement("tr");
      row.className = "empty-row";
      row.innerHTML = '<td colspan="3" class="hint">Draw a polygon to add your first area.</td>';
      els.areasTableBody.appendChild(row);
      return;
    }

    if (!visible.length) {
      const row = document.createElement("tr");
      row.className = "empty-row";
      row.innerHTML = '<td colspan="3" class="hint">No areas match this filter.</td>';
      els.areasTableBody.appendChild(row);
      return;
    }

    visible.forEach((layer) => {
      ensureLayerProperties(layer);
      const props = layer.feature.properties;
      const tr = document.createElement("tr");
      if (state.selectedLayer === layer) {
        tr.classList.add("selected-row");
      }

      const name = props.name || "Unnamed area";
      const type = props.treatmentType || "—";

      tr.innerHTML = `
        <td>${escapeHtml(name)}</td>
        <td class="type-cell">${escapeHtml(type)}</td>
        <td><button type="button" class="zoom-btn">Zoom</button></td>
      `;

      tr.addEventListener("click", (event) => {
        if (event.target.closest(".zoom-btn")) return;
        selectLayer(layer);
      });

      tr.querySelector(".zoom-btn").addEventListener("click", (event) => {
        event.stopPropagation();
        selectLayer(layer, { zoom: true });
      });

      els.areasTableBody.appendChild(tr);
    });
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function populateBasemapSelect() {
    Object.entries(BASEMAPS).forEach(([key, cfg]) => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = cfg.label;
      els.basemapSelect.appendChild(opt);
    });
    els.basemapSelect.value = state.basemapKey;
  }

  function setBasemap(key) {
    if (!BASEMAPS[key] || !state.map) return;
    state.basemapKey = key;
    const visible = els.toggleBasemap.checked;
    if (state.basemapLayer) {
      state.map.removeLayer(state.basemapLayer);
    }
    state.basemapLayer = BASEMAPS[key].create();
    if (visible) {
      state.basemapLayer.addTo(state.map);
    }
  }

  function populateTypeFilters() {
    TREATMENT_TYPES.forEach((type) => {
      const opt = document.createElement("option");
      opt.value = type;
      opt.textContent = type;
      els.featureType.appendChild(opt.cloneNode(true));
      els.areaTypeFilter.appendChild(opt);
    });
  }

  let cividisLut = null;

  async function fetchConfig() {
    const res = await fetch("raster/wfer_bounds.json");
    if (!res.ok) {
      throw new Error("Raster config not found. Run: python scripts/prepare_raster.py");
    }
    const bounds = await res.json();
    const lutRes = await fetch("raster/cividis_lut.json");
    if (!lutRes.ok) {
      throw new Error("Color ramp not found. Run: python scripts/prepare_raster.py");
    }
    cividisLut = await lutRes.json();
    return {
      bounds,
      rasterUrl: bounds.rasterUrl || "raster/wfer.tif",
      noData: bounds.noData ?? 2147483647,
      vmin: bounds.vmin,
      vmax: bounds.vmax,
    };
  }

  function wferValueToRgba(value, vmin, vmax, noData) {
    if (value == null || !Number.isFinite(value) || value >= noData - 1 || value < 0) {
      return null;
    }
    const span = Math.max(vmax - vmin, 1);
    const t = Math.max(0, Math.min(1, (value - vmin) / span));
    const idx = Math.round(t * 255);
    const rgb = cividisLut[idx];
    return [rgb[0], rgb[1], rgb[2], 217];
  }

  function readRasterValue(band, row, col, width) {
    if (!band) return null;
    if (Array.isArray(band[0])) {
      return band[row]?.[col];
    }
    return band[row * width + col];
  }

  const WferCrispLayer = L.GridLayer.extend({
    options: {
      opacity: 0.85,
      pane: "overlayPane",
      updateWhenZooming: false,
      updateWhenIdle: true,
      keepBuffer: 1,
    },

    initialize(georaster, colorFn, options) {
      L.setOptions(this, options);
      this._georaster = georaster;
      this._colorFn = colorFn;
    },

    createTile(coords, done) {
      const tileSize = this.getTileSize().x;
      const scale = L.Browser.retina ? 2 : 1;
      const canvas = L.DomUtil.create("canvas", "leaflet-tile wfer-crisp-tile");
      canvas.width = tileSize * scale;
      canvas.height = tileSize * scale;
      canvas.style.width = `${tileSize}px`;
      canvas.style.height = `${tileSize}px`;

      if (!this._map) {
        done(null, canvas);
        return canvas;
      }

      const nwPoint = coords.scaleBy(tileSize);
      const sePoint = nwPoint.add([tileSize, tileSize]);
      const nw = this._map.unproject(nwPoint, coords.z);
      const se = this._map.unproject(sePoint, coords.z);

      Promise.resolve(
        this._georaster.getValues({
          left: Math.min(nw.lng, se.lng),
          right: Math.max(nw.lng, se.lng),
          top: Math.max(nw.lat, se.lat),
          bottom: Math.min(nw.lat, se.lat),
          width: tileSize,
          height: tileSize,
          resampleMethod: "nearest",
        })
      )
        .then((values) => {
          const ctx = canvas.getContext("2d");
          ctx.setTransform(scale, 0, 0, scale, 0, 0);
          ctx.imageSmoothingEnabled = false;

          const band = values?.[0];
          if (!band) {
            done(new Error("WFER tile values unavailable"), canvas);
            return;
          }

          const imageData = ctx.createImageData(tileSize, tileSize);
          const pixels = imageData.data;

          for (let row = 0; row < tileSize; row += 1) {
            for (let col = 0; col < tileSize; col += 1) {
              const value = readRasterValue(band, row, col, tileSize);
              const rgba = this._colorFn(value);
              if (!rgba) continue;
              const offset = (row * tileSize + col) * 4;
              pixels[offset] = rgba[0];
              pixels[offset + 1] = rgba[1];
              pixels[offset + 2] = rgba[2];
              pixels[offset + 3] = rgba[3];
            }
          }

          ctx.putImageData(imageData, 0, 0);
          done(null, canvas);
        })
        .catch((error) => {
          console.error("WFER tile render failed:", error);
          done(error, canvas);
        });

      return canvas;
    },
  });

  function createWferLayer(georaster, config) {
    const { noData, vmin, vmax } = config;
    return new WferCrispLayer(georaster, (value) => wferValueToRgba(value, vmin, vmax, noData));
  }

  async function loadWferLayer(config) {
    const { rasterUrl } = config;
    setStatus("Loading WFER raster (one-time download, ~17 MB)…");

    const response = await fetch(rasterUrl);
    if (!response.ok) {
      throw new Error("Could not load WFER GeoTIFF");
    }

    const georaster = await parseGeoraster(await response.arrayBuffer());
    if (!georaster.getValues) {
      throw new Error("GeoTIFF parsed but getValues is unavailable");
    }
    state.wferLayer = createWferLayer(georaster, config);

    if (els.toggleWfer.checked) {
      state.wferLayer.addTo(state.map);
    }
  }

  async function cleanupEmptySubmissions(rows) {
    const emptyRows = rows.filter((item) => featureCount(item) === 0);
    for (const item of emptyRows) {
      await state.supabase.from("submissions").delete().eq("id", item.id);
      if (state.submissionId === item.id) {
        clearSession();
      }
    }
  }

  async function refreshSubmissions() {
    els.submissionList.innerHTML = "";

    if (!state.supabase) {
      els.submissionList.innerHTML = "<li class='hint'>Connect Supabase to list shared submissions.</li>";
      return;
    }

    const { data, error } = await state.supabase
      .from("submissions")
      .select("id, participant, features, updated_at")
      .order("updated_at", { ascending: false });

    if (error) {
      els.submissionList.innerHTML = `<li class='hint'>Could not load submissions: ${error.message}</li>`;
      return;
    }

    await cleanupEmptySubmissions(data || []);
    const saved = (data || []).filter((item) => featureCount(item) > 0);

    if (!saved.length) {
      els.submissionList.innerHTML = "<li class='hint'>No saved submissions yet.</li>";
      return;
    }

    saved.forEach((item) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${item.participant} (${featureCount(item)} areas)`;
      const btn = document.createElement("button");
      btn.textContent = "Open";
      btn.addEventListener("click", () => openSubmission(item.id));
      li.append(label, btn);
      els.submissionList.appendChild(li);
    });
  }

  async function openSubmission(id, { promptContinue = false } = {}) {
    if (!state.supabase) {
      setStatus("Supabase is not configured.", true);
      return;
    }

    const { data, error } = await state.supabase
      .from("submissions")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      setStatus("Could not load that submission.", true);
      return;
    }

    if (featureCount(data) === 0) {
      clearSession();
      setStatus("That submission had no saved areas and was removed.", true);
      await refreshSubmissions();
      return;
    }

    if (promptContinue) {
      state.pendingRestore = data;
      const count = featureCount(data);
      els.continueDialogText.textContent = `You have ${count} saved area(s) as "${data.participant || "Anonymous"}". Continue editing or start with a blank map?`;
      els.continueDialog.showModal();
      return;
    }

    applySubmissionData(data);
  }

  function applySubmissionData(data) {
    state.submissionId = data.id;
    localStorage.setItem("nh_submission_id", data.id);
    els.participant.value = data.participant || "";
    loadFeatures(data.features || []);
    setLastSaved(data.updated_at || data.created_at);
    setStatus(`Loaded ${featureCount(data)} area(s) for ${data.participant || "participant"}.`);
  }

  async function saveSubmission({ quiet = false } = {}) {
    if (!state.supabase) {
      setStatus("Supabase is not configured.", true);
      return false;
    }

    const participant = els.participant.value.trim() || "Anonymous";
    const features = featuresFromMap();
    const now = new Date().toISOString();

    if (!features.length) {
      if (state.submissionId) {
        const { error } = await state.supabase
          .from("submissions")
          .delete()
          .eq("id", state.submissionId);
        if (error) {
          setStatus(`Could not remove submission: ${error.message}`, true);
          return false;
        }
        clearSession({ keepName: true });
        if (!quiet) {
          setStatus("All areas removed — your submission was deleted.");
        }
        await refreshSubmissions();
        return true;
      }
      if (!quiet) {
        setStatus("No polygons on the map to save. Draw an area first.", true);
      }
      return false;
    }

    if (state.submissionId) {
      const { error } = await state.supabase
        .from("submissions")
        .update({ participant, features, updated_at: now })
        .eq("id", state.submissionId);

      if (error) {
        setStatus(`Save failed: ${error.message}`, true);
        return false;
      }
    } else {
      const id = newSubmissionId();
      const { error } = await state.supabase.from("submissions").insert({
        id,
        participant,
        features,
        created_at: now,
        updated_at: now,
      });

      if (error) {
        setStatus(`Save failed: ${error.message}`, true);
        return false;
      }

      state.submissionId = id;
      localStorage.setItem("nh_submission_id", id);
    }

    setLastSaved(now);
    if (!quiet) {
      setStatus(`Saved ${features.length} area(s) for ${participant}.`);
    }
    await refreshSubmissions();
    return true;
  }

  async function saveSelectedArea({ nameOnly = false } = {}) {
    if (!state.selectedLayer) return false;

    if (nameOnly) {
      const name = els.featureName.value.trim();
      if (!name) {
        setStatus("Enter a name to rename this area.", true);
        els.featureName.focus();
        return false;
      }
      applyFormToLayer(state.selectedLayer, { nameOnly: true });
    } else {
      applyFormToLayer(state.selectedLayer);
    }

    const ok = await saveSubmission({ quiet: true });
    if (ok) {
      const label = nameOnly ? "Renamed and saved" : "Area saved";
      const areaName = state.selectedLayer.feature.properties.name || "area";
      setStatus(`${label}: ${areaName}.`);
    }
    return ok;
  }

  async function deleteSubmission() {
    if (!state.supabase) {
      setStatus("Supabase is not configured.", true);
      return;
    }

    const hasMapAreas = getDrawnLayers().length > 0;
    const message = state.submissionId
      ? "Delete your saved submission from the database and clear the map?"
      : hasMapAreas
        ? "Clear all areas from the map?"
        : null;

    if (!message) {
      setStatus("Nothing to delete.");
      return;
    }

    if (!window.confirm(message)) return;

    if (state.submissionId) {
      const { error } = await state.supabase
        .from("submissions")
        .delete()
        .eq("id", state.submissionId);
      if (error) {
        setStatus(`Delete failed: ${error.message}`, true);
        return;
      }
    }

    clearSession();
    clearMap();
    await refreshSubmissions();
    setStatus("Submission deleted. You can start fresh.");
  }

  function startNewSubmission({ confirmIfDirty = true } = {}) {
    const hasAreas = getDrawnLayers().length > 0;
    if (confirmIfDirty && hasAreas) {
      if (!window.confirm("Start a new submission? Unsaved changes on the map will be cleared.")) {
        return;
      }
    }
    clearSession({ keepName: true });
    clearMap();
    setStatus("Ready for a new submission. Draw areas and click Save all.");
  }

  function exportGeoJSON() {
    const doc = {
      type: "FeatureCollection",
      properties: {
        participant: els.participant.value.trim() || "Anonymous",
        exportedAt: new Date().toISOString(),
      },
      features: featuresFromMap(),
    };
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "northern_highlands_priorities.geojson";
    a.click();
    URL.revokeObjectURL(url);
  }

  function initMap(config) {
    const { bounds } = config;

    state.map = L.map("map", { zoomControl: true });
    setBasemap(state.basemapKey);

    const southWest = L.latLng(bounds.south, bounds.west);
    const northEast = L.latLng(bounds.north, bounds.east);
    const imageBounds = L.latLngBounds(southWest, northEast);
    state.map.fitBounds(imageBounds);

    state.drawnLayer = L.featureGroup().addTo(state.map);
    state.map.pm.setGlobalOptions({ layerGroup: state.drawnLayer });

    state.map.pm.addControls({
      position: "topleft",
      drawMarker: false,
      drawCircle: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawRectangle: true,
      drawPolygon: true,
      editMode: true,
      dragMode: true,
      removalMode: true,
    });

    state.map.on("pm:create", (event) => {
      const layer = event.layer;
      layer.feature = { type: "Feature", properties: {}, geometry: layer.toGeoJSON().geometry };
      ensureLayerProperties(layer);
      state.drawnLayer.addLayer(layer);
      bindLayer(layer);
      selectLayer(layer);
      setStatus("Area drawn. Add details below, then Save area or Save all.");
    });

    state.map.on("pm:remove", (event) => {
      if (state.drawnLayer.hasLayer(event.layer)) {
        state.drawnLayer.removeLayer(event.layer);
      }
      if (state.selectedLayer === event.layer) {
        clearSelection();
      }
      refreshAreasList();
    });

    state.map.on("click", () => clearSelection());
  }

  els.basemapSelect.addEventListener("change", () => {
    setBasemap(els.basemapSelect.value);
  });

  els.toggleBasemap.addEventListener("change", () => {
    if (els.toggleBasemap.checked) {
      state.basemapLayer.addTo(state.map);
    } else {
      state.map.removeLayer(state.basemapLayer);
    }
  });

  els.toggleWfer.addEventListener("change", () => {
    if (!state.wferLayer) return;
    if (els.toggleWfer.checked) {
      state.wferLayer.addTo(state.map);
    } else {
      state.map.removeLayer(state.wferLayer);
    }
  });

  els.featureForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveSelectedArea();
  });

  els.renameFeatureBtn.addEventListener("click", async () => {
    if (!state.selectedLayer) return;
    if (!els.featureName.value.trim()) {
      els.featureName.focus();
      setStatus("Enter a name, then click Rename.", true);
      return;
    }
    await saveSelectedArea({ nameOnly: true });
  });

  els.deleteFeatureBtn.addEventListener("click", async () => {
    if (!state.selectedLayer) return;
    state.drawnLayer.removeLayer(state.selectedLayer);
    clearSelection();
    refreshAreasList();

    if (!getDrawnLayers().length && state.submissionId) {
      const remove = window.confirm(
        "That was your last area. Remove your saved submission from the database?"
      );
      if (remove) {
        await saveSubmission();
      } else {
        setStatus("Area removed. Save all to update your submission, or delete the last area to remove it.");
      }
    } else {
      setStatus("Area removed from the map. Click Save all to update the database.");
    }
  });

  els.saveAllBtn.addEventListener("click", () => saveSubmission());
  els.newSubmissionBtn.addEventListener("click", () => startNewSubmission());
  els.deleteSubmissionBtn.addEventListener("click", () => deleteSubmission());
  els.exportBtn.addEventListener("click", exportGeoJSON);

  els.areaTypeFilter.addEventListener("change", () => {
    state.areaFilter = els.areaTypeFilter.value;
    refreshAreasList();
  });

  els.continueDialog.addEventListener("close", () => {
    const choice = els.continueDialog.returnValue;
    const data = state.pendingRestore;
    state.pendingRestore = null;

    if (!data) return;

    if (choice === "continue") {
      applySubmissionData(data);
    } else {
      clearSession();
      clearMap();
      setStatus("Started fresh. Draw areas on the map when ready.");
    }
  });

  state.supabase = initSupabase();

  async function restoreSession() {
    if (!state.submissionId || !state.supabase) {
      clearSession();
      return;
    }

    const { data, error } = await state.supabase
      .from("submissions")
      .select("*")
      .eq("id", state.submissionId)
      .maybeSingle();

    if (error || !data || featureCount(data) === 0) {
      clearSession();
      return;
    }

    await openSubmission(state.submissionId, { promptContinue: true });
  }

  populateBasemapSelect();
  populateTypeFilters();

  fetchConfig()
    .then(async (config) => {
      initMap(config);
      try {
        await loadWferLayer(config);
      } catch (error) {
        setStatus(`WFER load failed: ${error.message}`, true);
      }
      refreshAreasList();
      if (!state.supabase) {
        setStatus("Map ready. Configure Supabase in docs/js/supabase-config.js to enable saving.");
      } else if (!els.status.style.color) {
        setStatus("Map ready. Draw polygons to mark priority areas.");
      }
      await refreshSubmissions();
      await restoreSession();
    })
    .catch((error) => setStatus(error.message, true));
})();
