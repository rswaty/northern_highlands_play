(() => {
  const state = {
    map: null,
    wferLayer: null,
    basemapLayer: null,
    drawnLayer: null,
    submissionId: localStorage.getItem("nh_submission_id"),
    selectedLayer: null,
    treatmentTypes: [],
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
    layer.on("click", () => selectLayer(layer));
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
    const res = await fetch("/api/config");
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to load map config");
    }
    return res.json();
  }

  async function refreshSubmissions() {
    const res = await fetch("/api/submissions");
    const items = await res.json();
    els.submissionList.innerHTML = "";

    if (!items.length) {
      els.submissionList.innerHTML = "<li class='hint'>No saved submissions yet.</li>";
      return;
    }

    items.forEach((item) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${item.participant} (${item.featureCount} areas)`;
      const btn = document.createElement("button");
      btn.textContent = "Open";
      btn.addEventListener("click", () => openSubmission(item.id));
      li.append(label, btn);
      els.submissionList.appendChild(li);
    });
  }

  async function openSubmission(id) {
    const res = await fetch(`/api/submissions/${id}`);
    if (!res.ok) {
      setStatus("Could not load that submission.", true);
      return;
    }
    const doc = await res.json();
    state.submissionId = id;
    localStorage.setItem("nh_submission_id", id);
    els.participant.value = doc.properties?.participant || "";
    loadFeatures(doc.features || []);
    setStatus(`Loaded submission from ${doc.properties?.participant || "participant"}.`);
  }

  async function saveSubmission() {
    const participant = els.participant.value.trim() || "Anonymous";
    const features = featuresFromMap();
    const payload = { participant, features };

    let res;
    if (state.submissionId) {
      res = await fetch(`/api/submissions/${state.submissionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const created = await res.json();
        state.submissionId = created.id;
        localStorage.setItem("nh_submission_id", created.id);
      }
    }

    if (!res.ok) {
      setStatus("Save failed. Is the server running?", true);
      return;
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
    state.treatmentTypes = config.treatmentTypes || [];
    state.treatmentTypes.forEach((type) => {
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
      state.drawnLayer.addLayer(layer);
      bindLayer(layer);
      selectLayer(layer);
      setStatus("Polygon created. Add a name, type, and notes, then click Update area.");
    });

    state.map.on("pm:remove", (event) => {
      if (state.drawnLayer.hasLayer(event.layer)) {
        state.drawnLayer.removeLayer(event.layer);
      }
      if (state.selectedLayer === event.layer) {
        clearSelection();
      }
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

  fetchConfig()
    .then((config) => {
      initMap(config);
      setStatus("Map ready. Draw polygons on the map to mark priority areas.");
      refreshSubmissions();
      if (state.submissionId) {
        openSubmission(state.submissionId);
      }
    })
    .catch((error) => setStatus(error.message, true));
})();
