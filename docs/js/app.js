(() => {
  const TREATMENT_TYPES = [
    "Fuel treatment",
    "Planned burn",
    "Both",
    "Other / unsure",
  ];

  const state = {
    map: null,
    wferLayer: null,
    basemapLayer: null,
    drawnLayer: null,
    supabase: null,
    submissionId: localStorage.getItem("nh_submission_id"),
    selectedLayer: null,
    treatmentTypes: TREATMENT_TYPES,
  };

  const els = {
    participant: document.getElementById("participant"),
    saveBtn: document.getElementById("saveBtn"),
    loadBtn: document.getElementById("loadBtn"),
    exportBtn: document.getElementById("exportBtn"),
    toggleBasemap: document.getElementById("toggleBasemap"),
    toggleWfer: document.getElementById("toggleWfer"),
    status: document.getElementById("status"),
    featurePanel: document.getElementById("featurePanel"),
    featureForm: document.getElementById("featureForm"),
    featureName: document.getElementById("featureName"),
    featureType: document.getElementById("featureType"),
    featureNotes: document.getElementById("featureNotes"),
    deleteFeatureBtn: document.getElementById("deleteFeatureBtn"),
    submissionList: document.getElementById("submissionList"),
  };

  function setStatus(message, isError = false) {
    els.status.textContent = message;
    els.status.style.color = isError ? "#b42318" : "";
  }

  function newSubmissionId() {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  }

  function normalizeSupabaseUrl(url) {
    if (!url) return url;
    // Data API page often shows .../rest/v1 — the client adds that itself.
    return url.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
  }

  function initSupabase() {
    const url = normalizeSupabaseUrl(window.SUPABASE_URL);
    const key = window.SUPABASE_ANON_KEY?.trim();
    if (!url || !key) {
      return null;
    }
    return window.supabase.createClient(url, key);
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
    const geo = layer.toGeoJSON();
    geo.properties = {
      ...(layer.feature?.properties || {}),
      name: layer.feature?.properties?.name || "",
      treatmentType: layer.feature?.properties?.treatmentType || "",
      notes: layer.feature?.properties?.notes || "",
    };
    return geo;
  }

  function bindLayer(layer) {
    layer.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      selectLayer(layer);
    });
    layer.on("pm:edit", () => {
      if (state.selectedLayer === layer) {
        syncFormFromLayer(layer);
      }
    });
  }

  function selectLayer(layer) {
    if (state.selectedLayer && state.selectedLayer !== layer) {
      state.selectedLayer.setStyle(defaultStyle());
    }
    state.selectedLayer = layer;
    layer.setStyle(selectedStyle());
    layer.bringToFront();
    syncFormFromLayer(layer);
    els.featurePanel.hidden = false;
  }

  function clearSelection() {
    if (state.selectedLayer) {
      state.selectedLayer.setStyle(defaultStyle());
    }
    state.selectedLayer = null;
    els.featurePanel.hidden = true;
  }

  function syncFormFromLayer(layer) {
    const props = layer.feature?.properties || {};
    els.featureName.value = props.name || "";
    els.featureType.value = props.treatmentType || "";
    els.featureNotes.value = props.notes || "";
  }

  function applyFormToLayer(layer) {
    layer.feature = layer.feature || { type: "Feature", properties: {}, geometry: layer.toGeoJSON().geometry };
    layer.feature.properties = {
      ...layer.feature.properties,
      name: els.featureName.value.trim(),
      treatmentType: els.featureType.value,
      notes: els.featureNotes.value.trim(),
    };

    const label = layer.feature.properties.name || layer.feature.properties.treatmentType || "Priority area";
    layer.bindTooltip(label, { sticky: true });
  }

  function featuresFromMap() {
    const features = [];
    state.drawnLayer.eachLayer((layer) => {
      features.push(layerToFeature(layer));
    });
    return features;
  }

  function loadFeatures(features) {
    state.drawnLayer.clearLayers();
    clearSelection();
    features.forEach((feature) => {
      const layer = L.geoJSON(feature, { style: defaultStyle() }).getLayers()[0];
      layer.feature = feature;
      bindLayer(layer);
      if (feature.properties?.name || feature.properties?.treatmentType) {
        const label = feature.properties.name || feature.properties.treatmentType;
        layer.bindTooltip(label, { sticky: true });
      }
      state.drawnLayer.addLayer(layer);
    });
    if (features.length) {
      const bounds = state.drawnLayer.getBounds();
      if (bounds.isValid()) {
        state.map.fitBounds(bounds.pad(0.1));
      }
    }
  }

  async function fetchConfig() {
    const res = await fetch("raster/wfer_bounds.json");
    if (!res.ok) {
      throw new Error("Raster overlay not found. Run: python scripts/prepare_raster.py");
    }
    const bounds = await res.json();
    return {
      bounds,
      overlayUrl: "raster/wfer_overlay.png",
      treatmentTypes: TREATMENT_TYPES,
    };
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

    if (!data.length) {
      els.submissionList.innerHTML = "<li class='hint'>No saved submissions yet.</li>";
      return;
    }

    data.forEach((item) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      const count = Array.isArray(item.features) ? item.features.length : 0;
      label.textContent = `${item.participant} (${count} areas)`;
      const btn = document.createElement("button");
      btn.textContent = "Open";
      btn.addEventListener("click", () => openSubmission(item.id));
      li.append(label, btn);
      els.submissionList.appendChild(li);
    });
  }

  async function openSubmission(id) {
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

    state.submissionId = id;
    localStorage.setItem("nh_submission_id", id);
    els.participant.value = data.participant || "";
    loadFeatures(data.features || []);
    setStatus(`Loaded submission from ${data.participant || "participant"}.`);
  }

  async function saveSubmission() {
    if (!state.supabase) {
      setStatus("Supabase is not configured. Edit docs/js/supabase-config.js", true);
      return;
    }

    const participant = els.participant.value.trim() || "Anonymous";
    const features = featuresFromMap();
    const now = new Date().toISOString();

    if (state.submissionId) {
      const { error } = await state.supabase
        .from("submissions")
        .update({ participant, features, updated_at: now })
        .eq("id", state.submissionId);

      if (error) {
        setStatus(`Save failed: ${error.message}`, true);
        return;
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
        return;
      }

      state.submissionId = id;
      localStorage.setItem("nh_submission_id", id);
    }

    setStatus(`Saved ${features.length} area(s) for ${participant}.`);
    refreshSubmissions();
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
    const { bounds, overlayUrl } = config;
    config.treatmentTypes.forEach((type) => {
      const opt = document.createElement("option");
      opt.value = type;
      opt.textContent = type;
      els.featureType.appendChild(opt);
    });

    state.map = L.map("map", { zoomControl: true });
    state.basemapLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(state.map);

    const southWest = L.latLng(bounds.south, bounds.west);
    const northEast = L.latLng(bounds.north, bounds.east);
    const imageBounds = L.latLngBounds(southWest, northEast);

    state.wferLayer = L.imageOverlay(overlayUrl, imageBounds, { opacity: 0.75 }).addTo(state.map);
    state.map.fitBounds(imageBounds);

    state.drawnLayer = L.featureGroup().addTo(state.map);

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
      bindLayer(layer);
      selectLayer(layer);
      setStatus("Polygon created. Add a name, type, and notes, then click Update area.");
    });

    state.map.on("click", () => clearSelection());
  }

  els.toggleBasemap.addEventListener("change", () => {
    if (els.toggleBasemap.checked) {
      state.basemapLayer.addTo(state.map);
    } else {
      state.map.removeLayer(state.basemapLayer);
    }
  });

  els.toggleWfer.addEventListener("change", () => {
    if (els.toggleWfer.checked) {
      state.wferLayer.addTo(state.map);
    } else {
      state.map.removeLayer(state.wferLayer);
    }
  });

  els.featureForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.selectedLayer) return;
    applyFormToLayer(state.selectedLayer);
    setStatus("Area details updated. Remember to Save polygons when finished.");
  });

  els.deleteFeatureBtn.addEventListener("click", () => {
    if (!state.selectedLayer) return;
    state.drawnLayer.removeLayer(state.selectedLayer);
    clearSelection();
    setStatus("Area removed from the map.");
  });

  els.saveBtn.addEventListener("click", saveSubmission);
  els.loadBtn.addEventListener("click", () => {
    if (state.submissionId) {
      openSubmission(state.submissionId);
    } else {
      setStatus("No saved submission in this browser yet. Draw polygons and save first.");
    }
  });
  els.exportBtn.addEventListener("click", exportGeoJSON);

  state.supabase = initSupabase();

  fetchConfig()
    .then(async (config) => {
      initMap(config);
      if (!state.supabase) {
        setStatus("Map ready. Configure Supabase in docs/js/supabase-config.js to enable saving.");
      } else {
        setStatus("Map ready. Draw polygons on the map to mark priority areas.");
      }
      await refreshSubmissions();
      if (state.submissionId && state.supabase) {
        await openSubmission(state.submissionId);
      }
    })
    .catch((error) => setStatus(error.message, true));
})();
