// Basic configuration
const API_BASE = "http://localhost:8000/api";

// Melbourne CBD approximate centre
const MELBOURNE_CBD = {
  lat: -37.8136,
  lng: 144.9631,
  zoom: 15,
};

let map;
let locationMap;
let mainMarkersLayer;
let locationMarker;
let userMarkerMain;
let userMarkerLocation;
let incidents = [];
let lastAlertedIncidentIds = new Set();
let userLocation = null;
let adminLoginTemplate = "";
let isAdminLoggedIn = false;

const categoryMeta = {
  protest: { emoji: "⚠️", label: "Protest / Rally" },
  theft: { emoji: "💰", label: "Theft / Robbery" },
  harassment: { emoji: "🚨", label: "Harassment / Assault / Threats" },
  antisocial: { emoji: "😡", label: "Anti-social Behaviour" },
  other: { emoji: "❓", label: "Other" },
};

function urgencyColor(urgency) {
  switch (urgency) {
    case "high":
      return "#f97373";
    case "medium":
      return "#facc15";
    case "low":
      return "#4ade80";
    default:
      return "#e5e7eb";
  }
}

function createEmojiMarker(lat, lng, category, urgency) {
  const meta = categoryMeta[category] || categoryMeta.other;
  const color = urgencyColor(urgency);
  const html = `<div style="background:${color}"><span>${meta.emoji}</span></div>`;

  const icon = L.divIcon({
    className: "",
    html,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

  return L.marker([lat, lng], { icon });
}

function humanTimeAgo(isoString) {
  if (!isoString) return "";
  const now = new Date();
  const then = new Date(isoString);
  const diffMs = now - then;
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} min${diffMins === 1 ? "" : "s"} ago`;
  const diffHours = Math.round(diffMins / 60);
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function fetchIncidents(hoursFilter) {
  const params = new URLSearchParams();
  if (hoursFilter) params.append("hours", String(hoursFilter));
  const url = `${API_BASE}/incidents?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load incidents");
  const data = await res.json();
  incidents = data;
  renderMapMarkers();
  renderList();
  checkNearbyAlerts();
}

function renderMapMarkers() {
  if (!mainMarkersLayer) return;
  mainMarkersLayer.clearLayers();
  incidents.forEach((incident) => {
    const marker = createEmojiMarker(
      incident.latitude,
      incident.longitude,
      incident.category,
      incident.urgency
    );
    marker.on("click", () => openDetailModal(incident));
    mainMarkersLayer.addLayer(marker);
  });
}

function filteredIncidentsForList() {
  const timeSelect = document.getElementById("list-time-filter");
  const categorySelect = document.getElementById("list-category-filter");
  const urgencySelect = document.getElementById("list-urgency-filter");

  const hours = timeSelect.value ? parseInt(timeSelect.value, 10) : null;
  const category = categorySelect.value || null;
  const urgencyMode = urgencySelect.value || null;

  return incidents.filter((inc) => {
    const now = new Date();
    const ts = new Date(inc.timestamp);
    if (hours != null) {
      const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);
      if (ts < cutoff) return false;
    }
    if (category && inc.category !== category) return false;
    if (urgencyMode === "high" && inc.urgency !== "high") return false;
    if (
      urgencyMode === "medium-high" &&
      !(inc.urgency === "high" || inc.urgency === "medium")
    ) {
      return false;
    }
    return true;
  });
}

function renderList() {
  const container = document.getElementById("incident-list");
  container.innerHTML = "";
  const items = filteredIncidentsForList().sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );

  if (!items.length) {
    const empty = document.createElement("div");
    empty.textContent = "No incidents in this time window.";
    empty.style.fontSize = "0.85rem";
    empty.style.color = "#9ca3af";
    container.appendChild(empty);
    return;
  }

  items.forEach((inc) => {
    const meta = categoryMeta[inc.category] || categoryMeta.other;
    const card = document.createElement("article");
    card.className = "incident-card";

    const left = document.createElement("div");
    left.className = "incident-card-left";
    left.textContent = meta.emoji;

    const main = document.createElement("div");
    main.className = "incident-card-main";

    const title = document.createElement("div");
    title.className = "incident-title";
    const label = meta.label;
    title.textContent = `${label}`;

    const metaLine = document.createElement("div");
    metaLine.className = "incident-meta";
    const credibility = inc.is_verified ? "Verified" : "Unverified";
    metaLine.textContent = `${humanTimeAgo(inc.timestamp)} • ${credibility}`;

    const desc = document.createElement("div");
    desc.className = "incident-description";
    const text = inc.description || "";
    desc.textContent = text.length > 140 ? `${text.slice(0, 140)}…` : text;

    const tags = document.createElement("div");
    tags.className = "incident-tags";

    const urgencyTag = document.createElement("span");
    urgencyTag.className = "tag";
    if (inc.urgency === "high") urgencyTag.classList.add("tag-urgency-high");
    if (inc.urgency === "medium") urgencyTag.classList.add("tag-urgency-medium");
    if (inc.urgency === "low") urgencyTag.classList.add("tag-urgency-low");
    urgencyTag.textContent = `Urgency: ${inc.urgency}`;
    tags.appendChild(urgencyTag);

    const credTag = document.createElement("span");
    credTag.className = "tag";
    credTag.classList.add(inc.is_verified ? "tag-verified" : "tag-unverified");
    credTag.textContent = inc.is_verified ? "Verified report" : "Unverified";
    tags.appendChild(credTag);

    if (inc.cluster_count && inc.cluster_count > 1) {
      const cl = document.createElement("span");
      cl.className = "tag tag-cluster";
      cl.textContent = `${inc.cluster_count} similar reports nearby`;
      tags.appendChild(cl);
    }

    main.appendChild(title);
    main.appendChild(metaLine);
    main.appendChild(desc);
    main.appendChild(tags);

    const actions = document.createElement("div");
    actions.className = "incident-card-actions";
    const detailsBtn = document.createElement("button");
    detailsBtn.className = "secondary-button";
    detailsBtn.type = "button";
    detailsBtn.textContent = "View details";
    detailsBtn.addEventListener("click", () => openDetailModal(inc));
    actions.appendChild(detailsBtn);

    card.appendChild(left);
    card.appendChild(main);
    card.appendChild(actions);
    container.appendChild(card);
  });
}

function openDetailModal(incident) {
  const meta = categoryMeta[incident.category] || categoryMeta.other;
  const detailTitle = document.getElementById("detail-title");
  const detailBody = document.getElementById("detail-body");
  detailTitle.textContent = `${meta.emoji} ${meta.label}`;

  const credibility = incident.is_verified ? "Verified" : "Unverified";
  const tsText = humanTimeAgo(incident.timestamp);

  detailBody.innerHTML = `
    <div class="incident-meta">${tsText} • ${credibility}</div>
    <div class="incident-description">${incident.description || ""}</div>
    <div class="incident-tags" style="margin-top:0.75rem">
      <span class="tag ${
        incident.urgency === "high"
          ? "tag-urgency-high"
          : incident.urgency === "medium"
          ? "tag-urgency-medium"
          : "tag-urgency-low"
      }">Urgency: ${incident.urgency}</span>
      <span class="tag ${
        incident.is_verified ? "tag-verified" : "tag-unverified"
      }">${credibility} report</span>
      ${
        incident.cluster_count && incident.cluster_count > 1
          ? `<span class="tag tag-cluster">${incident.cluster_count} similar reports nearby</span>`
          : ""
      }
    </div>
  `;

  const modal = document.getElementById("detail-modal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeDetailModal() {
  const modal = document.getElementById("detail-modal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

async function submitReport() {
  const categoryValue = getActiveChipValue("category-chips");
  const urgencyValue = getActiveChipValue("urgency-chips");
  const description = document.getElementById("description-input").value.trim();
  const identityMode = document.querySelector(
    'input[name="identity-mode"]:checked'
  ).value;
  const email = document.getElementById("contact-email").value.trim();
  const phone = document.getElementById("contact-phone").value.trim();
  const agreementChecked = document.getElementById("agreement-checkbox").checked;

  if (!locationMarker) {
    alert("Please choose a location by using GPS, searching, or moving the pin.");
    return;
  }
  if (!categoryValue) {
    alert("Please choose a category.");
    return;
  }
  if (!urgencyValue) {
    alert("Please choose an urgency level.");
    return;
  }
  if (!description) {
    alert("Please add a brief description.");
    return;
  }
  if (!agreementChecked) {
    alert("You must confirm the agreement before posting.");
    return;
  }
  if (identityMode === "verified" && !email && !phone) {
    alert("Please provide at least an email or phone number, or choose anonymous.");
    return;
  }

  const { lat, lng } = locationMarker.getLatLng();

  const payload = {
    category: categoryValue,
    urgency: urgencyValue,
    description,
    latitude: lat,
    longitude: lng,
  };

  if (identityMode === "verified") {
    if (email) payload.contact_email = email;
    if (phone) payload.contact_phone = phone;
  }

  try {
    const res = await fetch(`${API_BASE}/incidents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error("Failed to submit report");
    }
    await fetchIncidents();
    alert("Thank you. Your incident has been recorded.");
    closeReportModal();
  } catch (e) {
    console.error(e);
    alert("There was a problem submitting your report. Please try again.");
  }
}

function getActiveChipValue(containerId) {
  const container = document.getElementById(containerId);
  const active = container.querySelector(".chip.active");
  return active ? active.dataset.value : null;
}

function initChipSelection(containerId) {
  const container = document.getElementById(containerId);
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    [...container.querySelectorAll(".chip")].forEach((chip) =>
      chip.classList.remove("active")
    );
    btn.classList.add("active");
  });
}

function openReportModal() {
  const modal = document.getElementById("report-modal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  setTimeout(() => {
    if (locationMap) {
      locationMap.invalidateSize();
    }
  }, 150);
}

function closeReportModal() {
  const modal = document.getElementById("report-modal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

async function geocodeAddress() {
  const input = document.getElementById("address-input");
  const query = input.value.trim();
  if (!query) return;
  try {
    const res = await fetch(`${API_BASE}/geocode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: query }),
    });
    const data = await res.json();
    if (data.success && data.locations && data.locations.length > 0) {
      const loc = data.locations[0];
      const lat = loc.latitude;
      const lng = loc.longitude;
      if (locationMap) {
        locationMap.setView([lat, lng], 17);
      }
      setLocationMarker(lat, lng);
    } else {
      alert("No matching locations found. Please refine your search.");
    }
  } catch (e) {
    console.error(e);
    alert("Unable to search address right now.");
  }
}

function setLocationMarker(lat, lng) {
  if (!locationMap) return;
  if (!locationMarker) {
    locationMarker = L.marker([lat, lng], { draggable: true }).addTo(locationMap);
  } else {
    locationMarker.setLatLng([lat, lng]);
  }
}

function useCurrentLocation() {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported by your browser.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      userLocation = { lat, lng };
      updateUserMarkers();
      if (locationMap) {
        locationMap.setView([lat, lng], 17);
      }
      if (map) {
        map.setView([lat, lng], 16);
      }
      setLocationMarker(lat, lng);
    },
    () => {
      alert("Unable to get your location.");
    },
    { enableHighAccuracy: true }
  );
}

function updateUserMarkers() {
  if (!userLocation) return;
  const { lat, lng } = userLocation;
  const blueDotOptions = {
    radius: 6,
    color: "#2563eb",
    fillColor: "#3b82f6",
    fillOpacity: 0.9,
    weight: 2,
  };

  if (map) {
    if (!userMarkerMain) {
      userMarkerMain = L.circleMarker([lat, lng], blueDotOptions).addTo(map);
    } else {
      userMarkerMain.setLatLng([lat, lng]);
    }
  }

  if (locationMap) {
    if (!userMarkerLocation) {
      userMarkerLocation = L.circleMarker([lat, lng], blueDotOptions).addTo(
        locationMap
      );
    } else {
      userMarkerLocation.setLatLng([lat, lng]);
    }
  }
}

function checkNearbyAlerts() {
  const alertEl = document.getElementById("alert-banner");
  if (!userLocation || !incidents.length) {
    alertEl.classList.add("hidden");
    return;
  }
  const urgentNearby = incidents.filter((inc) => {
    if (inc.urgency !== "high") return false;
    const dist = calculateDistanceMeters(
      userLocation.lat,
      userLocation.lng,
      inc.latitude,
      inc.longitude
    );
    return dist <= 500;
  });

  if (!urgentNearby.length) {
    alertEl.classList.add("hidden");
    return;
  }

  const newest = urgentNearby.sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  )[0];

  if (!lastAlertedIncidentIds.has(newest.id)) {
    lastAlertedIncidentIds.add(newest.id);
  }

  const meta = categoryMeta[newest.category] || categoryMeta.other;
  const distance = Math.round(
    calculateDistanceMeters(
      userLocation.lat,
      userLocation.lng,
      newest.latitude,
      newest.longitude
    )
  );
  alertEl.textContent = `Urgent nearby incident reported: ${meta.emoji} ${
    meta.label
  } about ${distance}m away (${humanTimeAgo(newest.timestamp)}).`;
  alertEl.classList.remove("hidden");
}

async function verifyAdmin(account, pin) {
  const res = await fetch(`${API_BASE}/admin/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account, pin }),
  });
  if (!res.ok) {
    throw new Error("Invalid admin credentials");
  }
  return res.json();
}

async function loadAdminIncidents() {
  const res = await fetch(`${API_BASE}/admin/incidents`);
  if (!res.ok) throw new Error("Failed to load admin incidents");
  return res.json();
}

async function deleteIncident(id) {
  const res = await fetch(`${API_BASE}/admin/incidents/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete incident");
}

async function renderAdminDashboard() {
  const adminBody = document.getElementById("admin-body");
  adminBody.innerHTML = "<div class='incident-meta'>Loading incidents…</div>";
  try {
    const data = await loadAdminIncidents();
    if (!data.length) {
      adminBody.innerHTML =
        "<div class='incident-meta'>No incidents in the last 6 hours.</div>";
      return;
    }
    const container = document.createElement("div");
    container.className = "incident-list";

    // Admin header row with logout
    const headerRow = document.createElement("div");
    headerRow.className = "admin-header-row";
    const headerText = document.createElement("div");
    headerText.className = "incident-meta";
    headerText.textContent = "Logged in as admin";
    const logoutBtn = document.createElement("button");
    logoutBtn.type = "button";
    logoutBtn.className = "ghost-button";
    logoutBtn.textContent = "Log out";
    logoutBtn.addEventListener("click", () => {
      isAdminLoggedIn = false;
      adminBody.innerHTML = adminLoginTemplate;
      setupAdminLoginForm();
    });
    headerRow.appendChild(headerText);
    headerRow.appendChild(logoutBtn);
    container.appendChild(headerRow);
    data
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .forEach((inc) => {
        const meta = categoryMeta[inc.category] || categoryMeta.other;
        const card = document.createElement("article");
        card.className = "incident-card";

        const left = document.createElement("div");
        left.className = "incident-card-left";
        left.textContent = meta.emoji;

        const main = document.createElement("div");
        main.className = "incident-card-main";
        const title = document.createElement("div");
        title.className = "incident-title";
        title.textContent = meta.label;

        const metaLine = document.createElement("div");
        metaLine.className = "incident-meta";
        metaLine.textContent = `${humanTimeAgo(
          inc.timestamp
        )} • ${inc.is_verified ? "Verified" : "Unverified"}`;

        const desc = document.createElement("div");
        desc.className = "incident-description";
        desc.textContent = inc.description || "";

        const contact = document.createElement("div");
        contact.className = "incident-meta";
        const email = inc.contact_email || "—";
        const phone = inc.contact_phone || "—";
        contact.textContent = `Email: ${email} • Phone: ${phone}`;

        main.appendChild(title);
        main.appendChild(metaLine);
        main.appendChild(desc);
        main.appendChild(contact);

        const actions = document.createElement("div");
        actions.className = "incident-card-actions";
        const delBtn = document.createElement("button");
        delBtn.className = "ghost-button";
        delBtn.type = "button";
        delBtn.textContent = "Delete";
        delBtn.addEventListener("click", async () => {
          if (!confirm("Delete this incident?")) return;
          try {
            await deleteIncident(inc.id);
            await fetchIncidents();
            await renderAdminDashboard();
          } catch (e) {
            alert("Failed to delete incident.");
          }
        });
        actions.appendChild(delBtn);

        card.appendChild(left);
        card.appendChild(main);
        card.appendChild(actions);
        container.appendChild(card);
      });

    adminBody.innerHTML = "";
    adminBody.appendChild(container);
  } catch (e) {
    console.error(e);
    adminBody.innerHTML =
      "<div class='error-text'>Unable to load incidents for admin.</div>";
  }
}

function setupAdminLoginForm() {
  const loginForm = document.getElementById("admin-login-form");
  if (!loginForm) return;
  const errorEl = document.getElementById("admin-login-error");

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    const account = document.getElementById("admin-account").value.trim();
    const pin = document.getElementById("admin-pin").value.trim();
    try {
      await verifyAdmin(account, pin);
      isAdminLoggedIn = true;
      await renderAdminDashboard();
    } catch (err) {
      errorEl.textContent = "Invalid account or PIN.";
    }
  });
}

function initAdminModal() {
  const adminButton = document.getElementById("admin-button");
  const adminModal = document.getElementById("admin-modal");
  const adminClose = document.getElementById("admin-close");
  const adminBody = document.getElementById("admin-body");

  if (adminBody && !adminLoginTemplate) {
    adminLoginTemplate = adminBody.innerHTML;
  }

  adminButton.addEventListener("click", () => {
    adminModal.classList.remove("hidden");
    adminModal.setAttribute("aria-hidden", "false");
    if (!isAdminLoggedIn) {
      setupAdminLoginForm();
    }
  });

  adminClose.addEventListener("click", () => {
    adminModal.classList.add("hidden");
    adminModal.setAttribute("aria-hidden", "true");
  });
}

function initViewToggle() {
  const mapTab = document.getElementById("tab-map");
  const listTab = document.getElementById("tab-list");
  const mapView = document.getElementById("view-map");
  const listView = document.getElementById("view-list");

  function activate(tab) {
    if (tab === "map") {
      mapTab.classList.add("active");
      listTab.classList.remove("active");
      mapView.classList.add("active");
      listView.classList.remove("active");
      if (map) {
        setTimeout(() => map.invalidateSize(), 100);
      }
    } else {
      listTab.classList.add("active");
      mapTab.classList.remove("active");
      listView.classList.add("active");
      mapView.classList.remove("active");
    }
  }

  mapTab.addEventListener("click", () => activate("map"));
  listTab.addEventListener("click", () => activate("list"));
}

function initMap() {
  map = L.map("map").setView(
    [MELBOURNE_CBD.lat, MELBOURNE_CBD.lng],
    MELBOURNE_CBD.zoom
  );
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  mainMarkersLayer = L.layerGroup().addTo(map);
}

function initLocationMap() {
  locationMap = L.map("location-map").setView(
    [MELBOURNE_CBD.lat, MELBOURNE_CBD.lng],
    MELBOURNE_CBD.zoom
  );
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(locationMap);

  locationMap.on("click", (e) => {
    setLocationMarker(e.latlng.lat, e.latlng.lng);
  });
}

function initFilters() {
  document
    .getElementById("list-time-filter")
    .addEventListener("change", () => renderList());
  document
    .getElementById("list-category-filter")
    .addEventListener("change", () => renderList());
  document
    .getElementById("list-urgency-filter")
    .addEventListener("change", () => renderList());
}

function initModalsAndButtons() {
  document
    .getElementById("report-button")
    .addEventListener("click", openReportModal);
  document
    .getElementById("report-close")
    .addEventListener("click", closeReportModal);
  document
    .getElementById("submit-report")
    .addEventListener("click", submitReport);
  document
    .getElementById("address-search-button")
    .addEventListener("click", geocodeAddress);
  document
    .getElementById("use-location")
    .addEventListener("click", useCurrentLocation);
  document
    .getElementById("detail-close")
    .addEventListener("click", closeDetailModal);

  document
    .getElementById("filters-button")
    .addEventListener("click", () => {
      document.getElementById("tab-list").click();
    });

  const identityRadios = document.querySelectorAll(
    'input[name="identity-mode"]'
  );
  const contactFields = document.getElementById("contact-fields");
  identityRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.value === "anonymous" && radio.checked) {
        contactFields.style.opacity = "0.4";
      } else if (radio.checked) {
        contactFields.style.opacity = "1";
      }
    });
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  initMap();
  initLocationMap();
  initViewToggle();
  initFilters();
  initModalsAndButtons();
  initChipSelection("category-chips");
  initChipSelection("urgency-chips");
  initAdminModal();

  try {
    await fetchIncidents();
  } catch (e) {
    console.error(e);
  }

  // Try to capture user location once for nearby alerts
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        updateUserMarkers();
        checkNearbyAlerts();
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 60000 }
    );
  }

  // Periodically refresh incidents (e.g. every 60s)
  setInterval(() => {
    fetchIncidents().catch(() => {});
  }, 60000);
});


