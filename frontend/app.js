// Basic configuration
// Use deployed API in production, localhost for development
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
  ? "http://localhost:8000/api" 
  : "https://community-map.onrender.com/api";

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
let locationDescriptionCache = new Map(); // Cache for location descriptions
let userReactions = new Map(); // Track user reactions per incident (loaded from localStorage)
let mapFilterState = { hours: null, urgency: null }; // Track map filter state
let liveUpdatesContent = ""; // Store live updates content
let liveUpdatesScrollInterval = null; // Store scroll interval
let adminStreetHighlights = []; // Store admin-created street highlights
let adminHighlightsLayer = null; // Layer for admin street highlight polylines
let highlightPinA = null; // First pin for creating highlight
let highlightPinB = null; // Second pin for creating highlight
let highlightMap = null; // Map instance for highlight creation modal
let selectedHighlightColor = "yellow"; // Default color
let selectedHighlightReason = "other"; // Default reason
let streetNotes = []; // Store street notes
let streetNotesLayer = null; // Layer for street note markers
let showStreetNotes = true; // Toggle for showing/hiding street notes
let streetNoteLocation = null; // Selected location for Street Note modal

// Load user reactions from localStorage on page load
function loadUserReactions() {
  try {
    const stored = localStorage.getItem('userReactions');
    if (stored) {
      userReactions = new Map(JSON.parse(stored));
    }
  } catch (e) {
    console.error('Failed to load user reactions:', e);
  }
}

// Save user reactions to localStorage
function saveUserReactions() {
  try {
    localStorage.setItem('userReactions', JSON.stringify([...userReactions]));
  } catch (e) {
    console.error('Failed to save user reactions:', e);
  }
}

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
  updateActiveUsersCount();
}

function getFilteredIncidentsForMap() {
  // Filter incidents based on current map filter state
  return incidents.filter((inc) => {
    const now = new Date();
    const ts = new Date(inc.timestamp);
    
    // Apply time filter
    if (mapFilterState.hours != null) {
      const cutoff = new Date(now.getTime() - mapFilterState.hours * 60 * 60 * 1000);
      if (ts < cutoff) return false;
    }
    
    // Apply urgency filter
    if (mapFilterState.urgency === "high" && inc.urgency !== "high") {
      return false;
    }
    
    return true;
  });
}

function renderMapMarkers() {
  if (!mainMarkersLayer) return;
  mainMarkersLayer.clearLayers();
  
  // Use filtered incidents for map
  const filteredIncidents = getFilteredIncidentsForMap();
  
  filteredIncidents.forEach((incident) => {
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
  const noteItems = [...streetNotes].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );

  if (!items.length && !noteItems.length) {
    const empty = document.createElement("div");
    empty.textContent = "No incidents or street notes in this time window.";
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
    // Auto-generate location description based on coordinates
    desc.setAttribute("data-lat", inc.latitude);
    desc.setAttribute("data-lng", inc.longitude);
    desc.setAttribute("data-incident-id", inc.id);
    desc.textContent = "Loading location...";
    
    // Load location description asynchronously
    reverseGeocode(inc.latitude, inc.longitude).then(locationDesc => {
      // Update this specific description element
      const descEl = document.querySelector(`[data-incident-id="${inc.id}"]`);
      if (descEl) {
        descEl.textContent = locationDesc;
      }
    });

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
    detailsBtn.addEventListener("click", () => {
      // Switch to map view
      const mapTab = document.getElementById("tab-map");
      const listTab = document.getElementById("tab-list");
      const mapView = document.getElementById("view-map");
      const listView = document.getElementById("view-list");
      
      // Activate map view
      mapTab.classList.add("active");
      listTab.classList.remove("active");
      mapView.classList.add("active");
      listView.classList.remove("active");
      
      // Center map on incident location and zoom in
      if (map) {
        map.setView([inc.latitude, inc.longitude], 17);
        // Give map a moment to render, then open detail modal
        setTimeout(() => {
          map.invalidateSize();
          openDetailModal(inc);
        }, 300);
      } else {
        openDetailModal(inc);
      }
    });
    actions.appendChild(detailsBtn);

    card.appendChild(left);
    card.appendChild(main);
    card.appendChild(actions);
    container.appendChild(card);
  });

  // Add Street Notes into list view (ambient layer)
  noteItems.forEach((note) => {
    const card = document.createElement("article");
    card.className = "incident-card";
    card.style.borderLeft = "3px solid #1E88E5";

    const left = document.createElement("div");
    left.className = "incident-card-left";
    left.textContent = "📝";

    const main = document.createElement("div");
    main.className = "incident-card-main";

    const title = document.createElement("div");
    title.className = "incident-title";
    title.textContent = "Street Note";

    const metaLine = document.createElement("div");
    metaLine.className = "incident-meta";
    metaLine.textContent = `${humanTimeAgo(note.created_at)} • Expires in 24h`;

    const location = document.createElement("div");
    location.className = "incident-location";
    location.innerHTML = `<strong>Location:</strong> ${note.location_text || `${Number(note.latitude).toFixed(4)}, ${Number(note.longitude).toFixed(4)}`}`;

    const desc = document.createElement("div");
    desc.className = "incident-description";
    desc.textContent = note.text;

    main.appendChild(title);
    main.appendChild(metaLine);
    main.appendChild(location);
    main.appendChild(desc);

    if (note.image_url) {
      const imgWrap = document.createElement("div");
      imgWrap.style.marginTop = "0.5rem";
      const img = document.createElement("img");
      img.src = note.image_url;
      img.alt = "Street note image";
      img.style.width = "100%";
      img.style.maxWidth = "220px";
      img.style.maxHeight = "150px";
      img.style.objectFit = "cover";
      img.style.borderRadius = "8px";
      img.style.border = "1px solid #dbeafe";
      imgWrap.appendChild(img);
      main.appendChild(imgWrap);
    }

    card.appendChild(left);
    card.appendChild(main);
    
    const actions = document.createElement("div");
    actions.className = "incident-card-actions";
    const viewBtn = document.createElement("button");
    viewBtn.className = "secondary-button";
    viewBtn.type = "button";
    viewBtn.textContent = "View on map";
    viewBtn.addEventListener("click", () => {
      const mapTab = document.getElementById("tab-map");
      const listTab = document.getElementById("tab-list");
      const mapView = document.getElementById("view-map");
      const listView = document.getElementById("view-list");

      mapTab.classList.add("active");
      listTab.classList.remove("active");
      mapView.classList.add("active");
      listView.classList.remove("active");

      if (map) {
        map.setView([note.latitude, note.longitude], 17);
        setTimeout(() => {
          map.invalidateSize();
          const imageHtml = note.image_url
            ? `<div style="margin-bottom: 0.5rem;"><img src="${note.image_url}" alt="Street note image" style="display:block; width:100%; max-width:220px; max-height:150px; object-fit:cover; border-radius:6px; border:1px solid #dbeafe;" /></div>`
            : "";
          const locationHtml = note.location_text
            ? `<div style="font-size: 0.75rem; color: #6b7280; margin-bottom: 0.5rem;">📍 ${note.location_text}</div>`
            : "";
          L.popup()
            .setLatLng([note.latitude, note.longitude])
            .setContent(`
              <div style="max-width: 240px; padding: 0.25rem;">
                ${imageHtml}
                ${locationHtml}
                <div style="font-size: 0.9375rem; color: #1f2937; line-height: 1.5; margin-bottom: 0.5rem;">${note.text}</div>
                <div style="font-size: 0.75rem; color: #9ca3af;">${humanTimeAgo(note.created_at)} &middot; expires in 24h</div>
              </div>
            `)
            .openOn(map);
        }, 300);
      }
    });
    actions.appendChild(viewBtn);

    card.appendChild(actions);
    container.appendChild(card);
  });
}

async function reactToIncident(incidentId, reaction) {
  try {
    const res = await fetch(`${API_BASE}/incidents/${incidentId}/react`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reaction }),
    });
    
    if (!res.ok) {
      throw new Error("Failed to react to incident");
    }
    
    const data = await res.json();
    
    // Store user reaction
    userReactions.set(incidentId, reaction);
    saveUserReactions();
    
    // Update the incident in the local array
    const incident = incidents.find(inc => inc.id === incidentId);
    if (incident) {
      incident.like_count = data.like_count || incident.like_count || 0;
      incident.dislike_count = data.dislike_count || incident.dislike_count || 0;
    }
    
    // Update the UI
    updateReactionButtons(incidentId, data.like_count, data.dislike_count);
    
    return data;
  } catch (e) {
    console.error("Error reacting to incident:", e);
    alert("Unable to submit your reaction. Please try again.");
  }
}

function updateReactionButtons(incidentId, likeCount, dislikeCount) {
  const likeBtn = document.getElementById("detail-like-btn");
  const dislikeBtn = document.getElementById("detail-dislike-btn");
  const likeCountEl = document.getElementById("detail-like-count");
  const dislikeCountEl = document.getElementById("detail-dislike-count");
  
  if (likeCountEl) likeCountEl.textContent = likeCount || 0;
  if (dislikeCountEl) dislikeCountEl.textContent = dislikeCount || 0;
  
  const userReaction = userReactions.get(incidentId);
  if (likeBtn) {
    if (userReaction === "like") {
      likeBtn.classList.add("active");
      likeBtn.disabled = true;
    } else {
      likeBtn.classList.remove("active");
      likeBtn.disabled = false;
    }
  }
  
  if (dislikeBtn) {
    if (userReaction === "dislike") {
      dislikeBtn.classList.add("active");
      dislikeBtn.disabled = true;
    } else {
      dislikeBtn.classList.remove("active");
      dislikeBtn.disabled = false;
    }
  }
}

async function openDetailModal(incident) {
  const meta = categoryMeta[incident.category] || categoryMeta.other;
  const detailTitle = document.getElementById("detail-title");
  const detailBody = document.getElementById("detail-body");
  detailTitle.textContent = `${meta.emoji} ${meta.label}`;

  const credibility = incident.is_verified ? "Verified" : "Unverified";
  const tsText = humanTimeAgo(incident.timestamp);
  
  // Get location description
  const locationDesc = await reverseGeocode(incident.latitude, incident.longitude);
  const userDesc = incident.description || "";
  
  // Show location description and user description if different
  let descriptionHTML = `<div class="incident-location"><strong>📍 Location:</strong> ${locationDesc}</div>`;
  if (userDesc && userDesc.toLowerCase() !== locationDesc.toLowerCase()) {
    descriptionHTML += `<div class="incident-description" style="margin-top:0.75rem"><strong>📝 Description:</strong> ${userDesc}</div>`;
  }

  const likeCount = incident.like_count || 0;
  const dislikeCount = incident.dislike_count || 0;
  const userReaction = userReactions.get(incident.id);
  const likeActive = userReaction === "like" ? "active" : "";
  const dislikeActive = userReaction === "dislike" ? "active" : "";
  const likeDisabled = userReaction === "like" ? "disabled" : "";
  const dislikeDisabled = userReaction === "dislike" ? "disabled" : "";

  detailBody.innerHTML = `
    <div class="incident-meta">${tsText} • ${credibility}</div>
    ${descriptionHTML}
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
    <div class="reaction-section" style="margin-top:1.5rem; padding-top:1rem; border-top:1px solid #e5e7eb;">
      <div style="font-size:0.875rem; color:#6b7280; margin-bottom:0.75rem;">Did you see this too?</div>
      <div class="reaction-buttons">
        <button id="detail-like-btn" class="reaction-btn reaction-like ${likeActive}" ${likeDisabled} type="button">
          <span class="reaction-icon">👍</span>
          <span class="reaction-text">I saw that too</span>
          <span id="detail-like-count" class="reaction-count">${likeCount}</span>
        </button>
        <button id="detail-dislike-btn" class="reaction-btn reaction-dislike ${dislikeActive}" ${dislikeDisabled} type="button">
          <span class="reaction-icon">👎</span>
          <span class="reaction-text">Dislike</span>
          <span id="detail-dislike-count" class="reaction-count">${dislikeCount}</span>
        </button>
      </div>
    </div>
  `;

  // Set up event listeners for reaction buttons
  const likeBtn = document.getElementById("detail-like-btn");
  const dislikeBtn = document.getElementById("detail-dislike-btn");
  
  if (likeBtn) {
    likeBtn.addEventListener("click", async () => {
      if (!likeBtn.disabled) {
        await reactToIncident(incident.id, "like");
      }
    });
  }
  
  if (dislikeBtn) {
    dislikeBtn.addEventListener("click", async () => {
      if (!dislikeBtn.disabled) {
        await reactToIncident(incident.id, "dislike");
      }
    });
  }

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

// Reverse geocoding: convert coordinates to address description
async function reverseGeocode(lat, lng) {
  // Check cache first
  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (locationDescriptionCache.has(cacheKey)) {
    return locationDescriptionCache.get(cacheKey);
  }
  
  try {
    // Use OpenStreetMap Nominatim reverse geocoding API
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'CommunityMapApp/1.0'
      }
    });
    
    if (!response.ok) {
      throw new Error('Reverse geocoding failed');
    }
    
    const data = await response.json();
    let description = `Location: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    
    if (data && data.address) {
      const addr = data.address;
      
      // Format: "152-154 Queensberry Street," (house number range + street name)
      if (addr.road) {
        let streetAddress = '';
        
        // Handle house number - check for number ranges or single numbers
        if (addr.house_number) {
          // If there's a range indicator in the house number (e.g., "152-154")
          if (addr.house_number.includes('-') || addr.house_number.includes('–')) {
            streetAddress = `${addr.house_number} ${addr.road}`;
          } else {
            // Single house number - could try to estimate range or just use single number
            const houseNum = parseInt(addr.house_number);
            if (!isNaN(houseNum)) {
              // If even, show range with next even number; if odd, show range with next odd
              const nextNum = houseNum + 2;
              streetAddress = `${houseNum}-${nextNum} ${addr.road}`;
            } else {
              streetAddress = `${addr.house_number} ${addr.road}`;
            }
          }
        } else {
          // No house number - try to extract from display_name or use street name only
          // Check nearby addresses in display_name
          if (data.display_name) {
            const displayParts = data.display_name.split(',');
            // Look for house number pattern in first part
            const firstPart = displayParts[0].trim();
            const houseNumMatch = firstPart.match(/(\d+)(?:\s*[-–]\s*(\d+))?\s+(.+)/);
            if (houseNumMatch) {
              if (houseNumMatch[2]) {
                // Range found
                streetAddress = `${houseNumMatch[1]}-${houseNumMatch[2]} ${houseNumMatch[3]}`;
              } else {
                // Single number - create range
                const num = parseInt(houseNumMatch[1]);
                const street = houseNumMatch[3];
                const nextNum = num + 2;
                streetAddress = `${num}-${nextNum} ${street}`;
              }
            } else {
              // Just use road name
              streetAddress = addr.road;
            }
          } else {
            streetAddress = addr.road;
          }
        }
        
        // Add comma at the end as per user's format
        description = streetAddress.endsWith(',') ? streetAddress : streetAddress + ',';
      } else if (data.display_name) {
        // Fallback: try to extract street address from display_name
        const displayParts = data.display_name.split(',');
        const firstPart = displayParts[0].trim();
        // Try to match house number pattern
        const houseNumMatch = firstPart.match(/(\d+)(?:\s*[-–]\s*(\d+))?\s+(.+?)(?:,|$)/);
        if (houseNumMatch) {
          if (houseNumMatch[2]) {
            description = `${houseNumMatch[1]}-${houseNumMatch[2]} ${houseNumMatch[3]},`;
          } else {
            const num = parseInt(houseNumMatch[1]);
            const street = houseNumMatch[3];
            const nextNum = num + 2;
            description = `${num}-${nextNum} ${street},`;
          }
        } else {
          // Just use first part with comma
          description = firstPart.endsWith(',') ? firstPart : firstPart + ',';
        }
      }
    } else if (data && data.display_name) {
      // Fallback: extract from display_name
      const displayParts = data.display_name.split(',');
      const firstPart = displayParts[0].trim();
      const houseNumMatch = firstPart.match(/(\d+)(?:\s*[-–]\s*(\d+))?\s+(.+?)(?:,|$)/);
      if (houseNumMatch) {
        if (houseNumMatch[2]) {
          description = `${houseNumMatch[1]}-${houseNumMatch[2]} ${houseNumMatch[3]},`;
        } else {
          const num = parseInt(houseNumMatch[1]);
          const street = houseNumMatch[3];
          const nextNum = num + 2;
          description = `${num}-${nextNum} ${street},`;
        }
      } else {
        description = firstPart.endsWith(',') ? firstPart : firstPart + ',';
      }
    }
    
    // Cache the result
    locationDescriptionCache.set(cacheKey, description);
    return description;
  } catch (e) {
    console.error('Reverse geocoding error:', e);
    // Fallback to coordinates
    const fallback = `Location: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    locationDescriptionCache.set(cacheKey, fallback);
    return fallback;
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

// Generate or get session ID for tracking active users
function getOrCreateSessionId() {
  let sessionId = localStorage.getItem('userSessionId');
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('userSessionId', sessionId);
  }
  return sessionId;
}

async function fetchLiveUpdates() {
  try {
    const response = await fetch(`${API_BASE}/live-updates`);
    if (response.ok) {
      const data = await response.json();
      liveUpdatesContent = data.content || "Reports clear after 6 hours • Notifications for urgent incidents within 500m";
      displayLiveUpdates();
    }
  } catch (error) {
    console.error("Failed to fetch live updates:", error);
    // Use default content
    liveUpdatesContent = "Reports clear after 6 hours • Notifications for urgent incidents within 500m";
    displayLiveUpdates();
  }
}

function displayLiveUpdates() {
  const updatesText = document.getElementById("updates-text");
  if (!updatesText) return;
  
  updatesText.textContent = liveUpdatesContent;
  
  // Start scrolling animation if content is long enough
  startLiveUpdatesScrolling();
}

function startLiveUpdatesScrolling() {
  // Clear existing interval
  if (liveUpdatesScrollInterval) {
    clearInterval(liveUpdatesScrollInterval);
    liveUpdatesScrollInterval = null;
  }
  
  const scrollContainer = document.querySelector(".updates-scroll-container");
  const updatesText = document.getElementById("updates-text");
  if (!scrollContainer || !updatesText) return;
  
  // Force reflow to get accurate measurements
  updatesText.style.display = "inline-block";
  
  // Wait a bit for layout to settle, then check if scrolling is needed
  setTimeout(() => {
    const containerWidth = scrollContainer.offsetWidth;
    const textWidth = updatesText.scrollWidth;
    
    if (textWidth <= containerWidth) {
      // Content fits, no need to scroll
      updatesText.style.animation = "none";
      updatesText.style.transform = "translateX(0)";
    } else {
      // Content overflows, start scrolling
      // Reset and start animation
      updatesText.style.animation = "none";
      void updatesText.offsetWidth; // Force reflow
      updatesText.style.animation = "scroll-text 30s linear infinite";
    }
  }, 100);
}

async function updateActiveUsersCount() {
  const activeUsersText = document.getElementById("active-users-text");
  if (!activeUsersText) return;

  try {
    // Send heartbeat to indicate this user is active
    const sessionId = getOrCreateSessionId();
    const response = await fetch(`${API_BASE}/users/heartbeat/${sessionId}`, {
      method: "POST"
    });
    
    if (response.ok) {
      const data = await response.json();
      const activeCount = data.active_count || 0;

      // Update the text with new format
      if (activeCount === 0) {
        activeUsersText.textContent = "0 people active on the map, tap to chat";
      } else if (activeCount === 1) {
        activeUsersText.textContent = "1 person active on the map, tap to chat";
      } else {
        activeUsersText.textContent = `${activeCount} people active on the map, tap to chat`;
      }
    } else {
      // Fallback if API fails
      activeUsersText.textContent = "0 people active on the map, tap to chat";
    }
  } catch (error) {
    console.error("Failed to update active users count:", error);
    activeUsersText.textContent = "0 people active on the map, tap to chat";
  }
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
  try {
    const res = await fetch(`${API_BASE}/admin/incidents`);
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`Failed to load admin incidents: ${res.status} ${res.statusText}`, errorText);
      throw new Error(`Failed to load admin incidents: ${res.status} ${res.statusText}`);
    }
    return await res.json();
  } catch (error) {
    console.error("Error fetching admin incidents:", error);
    throw error;
  }
}

async function deleteIncident(id) {
  const res = await fetch(`${API_BASE}/admin/incidents/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete incident");
}

async function updateIncident(id, updateData) {
  const res = await fetch(`${API_BASE}/admin/incidents/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updateData),
  });
  if (!res.ok) throw new Error("Failed to update incident");
  return res.json();
}

async function updateLiveUpdates(content) {
  const res = await fetch(`${API_BASE}/admin/live-updates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error("Failed to update live updates");
  return res.json();
}

function showEditLiveUpdatesModal() {
  // Create modal overlay
  const modalOverlay = document.createElement("div");
  modalOverlay.className = "modal-overlay";
  modalOverlay.id = "edit-live-updates-modal";
  
  const modalContent = document.createElement("div");
  modalContent.className = "modal-content";
  modalContent.style.maxWidth = "600px";
  
  const modalHeader = document.createElement("div");
  modalHeader.className = "modal-header";
  modalHeader.innerHTML = `
    <h2>Edit Live Updates</h2>
    <button class="modal-close" type="button">&times;</button>
  `;
  
  const modalBody = document.createElement("div");
  modalBody.className = "modal-body";
  
  const form = document.createElement("form");
  form.id = "edit-live-updates-form";
  
  const label = document.createElement("label");
  label.textContent = "Live Updates Content:";
  label.style.display = "block";
  label.style.marginBottom = "0.5rem";
  label.style.fontWeight = "600";
  
  const textarea = document.createElement("textarea");
  textarea.id = "live-updates-content";
  textarea.value = liveUpdatesContent;
  textarea.rows = 4;
  textarea.style.width = "100%";
  textarea.style.padding = "0.75rem";
  textarea.style.border = "1px solid #d1d5db";
  textarea.style.borderRadius = "6px";
  textarea.style.fontSize = "0.875rem";
  textarea.required = true;
  
  const buttonGroup = document.createElement("div");
  buttonGroup.style.display = "flex";
  buttonGroup.style.gap = "0.75rem";
  buttonGroup.style.marginTop = "1rem";
  buttonGroup.style.justifyContent = "flex-end";
  
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.className = "button-secondary";
  cancelBtn.addEventListener("click", () => {
    document.body.removeChild(modalOverlay);
  });
  
  const saveBtn = document.createElement("button");
  saveBtn.type = "submit";
  saveBtn.textContent = "Save";
  saveBtn.className = "button-primary";
  
  buttonGroup.appendChild(cancelBtn);
  buttonGroup.appendChild(saveBtn);
  
  form.appendChild(label);
  form.appendChild(textarea);
  form.appendChild(buttonGroup);
  
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const newContent = textarea.value.trim();
    
    if (!newContent) {
      alert("Content cannot be empty");
      return;
    }
    
    try {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";
      await updateLiveUpdates(newContent);
      liveUpdatesContent = newContent;
      displayLiveUpdates();
      document.body.removeChild(modalOverlay);
      alert("Live updates content updated successfully!");
    } catch (error) {
      console.error("Failed to update live updates:", error);
      alert("Failed to update live updates. Please try again.");
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  });
  
  modalBody.appendChild(form);
  modalContent.appendChild(modalHeader);
  modalContent.appendChild(modalBody);
  modalOverlay.appendChild(modalContent);
  
  // Close handlers
  const closeBtn = modalHeader.querySelector(".modal-close");
  closeBtn.addEventListener("click", () => {
    document.body.removeChild(modalOverlay);
  });
  
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) {
      document.body.removeChild(modalOverlay);
    }
  });
  
  document.body.appendChild(modalOverlay);
}

async function renderAdminDashboard() {
  const adminBody = document.getElementById("admin-body");
  adminBody.innerHTML = "<div class='admin-loading'>Loading incidents…</div>";
  try {
    const data = await loadAdminIncidents();
    
    // Ensure data is an array
    if (!Array.isArray(data)) {
      console.error("Admin incidents data is not an array:", data);
      throw new Error("Invalid data format received from server");
    }
    
    // Create dashboard container
    const dashboard = document.createElement("div");
    dashboard.className = "admin-dashboard";

    // Admin header with logo, title, counter, and back button
    const header = document.createElement("div");
    header.className = "admin-dashboard-header";
    
    const headerLeft = document.createElement("div");
    headerLeft.className = "admin-header-left";
    
    const logoBox = document.createElement("div");
    logoBox.className = "admin-logo-box";
    logoBox.innerHTML = "<span class='admin-logo-text'>A</span>";
    
    const headerText = document.createElement("div");
    headerText.className = "admin-header-text";
    const title = document.createElement("h1");
    title.className = "admin-dashboard-title";
    title.textContent = "Admin Dashboard";
    const counter = document.createElement("div");
    counter.className = "admin-reports-counter";
    counter.textContent = `${data.length} Total Report${data.length !== 1 ? 's' : ''}`;
    headerText.appendChild(title);
    headerText.appendChild(counter);
    
    headerLeft.appendChild(logoBox);
    headerLeft.appendChild(headerText);
    
    const headerRight = document.createElement("div");
    headerRight.className = "admin-header-right";
    
    const highlightStreetBtn = document.createElement("button");
    highlightStreetBtn.type = "button";
    highlightStreetBtn.className = "admin-highlight-street-button";
    highlightStreetBtn.innerHTML = "📍 Highlight a Street";
    highlightStreetBtn.addEventListener("click", () => {
      openHighlightStreetModal();
    });
    
    const editWelcomeNoticeBtn = document.createElement("button");
    editWelcomeNoticeBtn.type = "button";
    editWelcomeNoticeBtn.className = "admin-edit-updates-button";
    editWelcomeNoticeBtn.innerHTML = "📢 Edit Welcome Notice";
    editWelcomeNoticeBtn.addEventListener("click", async () => {
      await showEditWelcomeNoticeModal();
    });
    
    const editUpdatesBtn = document.createElement("button");
    editUpdatesBtn.type = "button";
    editUpdatesBtn.className = "admin-edit-updates-button";
    editUpdatesBtn.innerHTML = "📝 Edit Live Updates";
    editUpdatesBtn.addEventListener("click", () => {
      showEditLiveUpdatesModal();
    });
    
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "admin-back-button";
    backBtn.innerHTML = "← Back to Map";
    backBtn.addEventListener("click", () => {
      const adminModal = document.getElementById("admin-modal");
      adminModal.classList.add("hidden");
      adminModal.setAttribute("aria-hidden", "true");
    });
    
    headerRight.appendChild(highlightStreetBtn);
    headerRight.appendChild(editWelcomeNoticeBtn);
    headerRight.appendChild(editUpdatesBtn);
    headerRight.appendChild(backBtn);
    
    header.appendChild(headerLeft);
    header.appendChild(headerRight);
    dashboard.appendChild(header);
    
    // Add Street Highlights section
    await renderAdminStreetHighlightsSection(dashboard);

    if (!data.length) {
      const emptyMsg = document.createElement("div");
      emptyMsg.className = "admin-empty";
      emptyMsg.textContent = "No incidents in the last 6 hours.";
      dashboard.appendChild(emptyMsg);
      adminBody.innerHTML = "";
      adminBody.appendChild(dashboard);
      return;
    }

    // Report cards
    const reportsContainer = document.createElement("div");
    reportsContainer.className = "admin-reports-container";
    
    data
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .forEach((inc) => {
        const card = createAdminReportCard(inc);
        reportsContainer.appendChild(card);
      });

    dashboard.appendChild(reportsContainer);
    
    // Add Street Highlights section
    await renderAdminStreetHighlightsSection(dashboard);
    
    adminBody.innerHTML = "";
    adminBody.appendChild(dashboard);
  } catch (e) {
    console.error("Admin dashboard error:", e);
    adminBody.innerHTML = `
      <div class='error-text'>
        <p>Unable to load incidents for admin.</p>
        <p style="font-size: 0.875rem; color: #6b7280; margin-top: 0.5rem;">
          ${e.message || "Please check your backend server is running."}
        </p>
        <button onclick="location.reload()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer;">
          Retry
        </button>
      </div>
    `;
  }
}

function createAdminReportCard(inc) {
  const meta = categoryMeta[inc.category] || categoryMeta.other;
  const card = document.createElement("article");
  card.className = "admin-report-card";

  // Card header with category icon and actions
  const cardHeader = document.createElement("div");
  cardHeader.className = "admin-card-header";
  
  const categoryIcon = document.createElement("div");
  categoryIcon.className = "admin-category-icon";
  categoryIcon.classList.add(`admin-category-icon-${inc.category}`);
  categoryIcon.innerHTML = meta.emoji;
  
  const categoryName = document.createElement("div");
  categoryName.className = "admin-category-name";
  categoryName.textContent = meta.label.toUpperCase().replace(/\//g, " / ");

  const tagsContainer = document.createElement("div");
  tagsContainer.className = "admin-card-tags";
  
  const urgencyTag = document.createElement("span");
  urgencyTag.className = `admin-tag admin-tag-urgency-${inc.urgency}`;
  urgencyTag.textContent = inc.urgency.toUpperCase();
  tagsContainer.appendChild(urgencyTag);
  
  const verifiedTag = document.createElement("span");
  verifiedTag.className = `admin-tag admin-tag-${inc.is_verified ? 'verified' : 'unverified'}`;
  verifiedTag.innerHTML = inc.is_verified ? "✓ Verified" : "Unverified";
  tagsContainer.appendChild(verifiedTag);

  cardHeader.appendChild(categoryIcon);
  cardHeader.appendChild(categoryName);
  cardHeader.appendChild(tagsContainer);

  // Actions (Edit and Delete buttons in top right)
  const actions = document.createElement("div");
  actions.className = "admin-card-actions";
  
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "admin-action-btn admin-edit-btn";
  editBtn.innerHTML = "✏️";
  editBtn.title = "Edit";
  editBtn.addEventListener("click", () => openEditModal(inc));
  
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "admin-action-btn admin-delete-btn";
  deleteBtn.innerHTML = "🗑️";
  deleteBtn.title = "Delete";
  deleteBtn.addEventListener("click", async () => {
    if (!confirm("Delete this incident?")) return;
    try {
      await deleteIncident(inc.id);
      await fetchIncidents();
      await renderAdminDashboard();
    } catch (e) {
      alert("Failed to delete incident.");
    }
  });
  
  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);

  // Card content
  const cardContent = document.createElement("div");
  cardContent.className = "admin-card-content";
  
  const description = document.createElement("div");
  description.className = "admin-card-description";
  description.textContent = inc.description || "";
  
  const details = document.createElement("div");
  details.className = "admin-card-details";
  details.innerHTML = `
    <div>Location: ${inc.latitude}, ${inc.longitude}</div>
    <div>Time: ${humanTimeAgo(inc.timestamp)} • Cluster: ${inc.cluster_count || 1} report(s)</div>
  `;

  cardContent.appendChild(description);
  cardContent.appendChild(details);

  // Contact info section
  const contactSection = document.createElement("div");
  contactSection.className = "admin-contact-section";
  
  const contactToggle = document.createElement("button");
  contactToggle.type = "button";
  contactToggle.className = "admin-contact-toggle";
  contactToggle.innerHTML = '<span class="toggle-icon">👁️</span> Hide Contact Info';
  let contactVisible = true;
  
  const contactInfo = document.createElement("div");
  contactInfo.className = "admin-contact-info";
  contactInfo.innerHTML = `
    <div><strong>Email:</strong> ${inc.contact_email || "—"}</div>
    <div><strong>Phone:</strong> ${inc.contact_phone || "—"}</div>
  `;

  contactToggle.addEventListener("click", () => {
    contactVisible = !contactVisible;
    if (contactVisible) {
      contactInfo.style.display = "block";
      contactToggle.innerHTML = '<span class="toggle-icon">🚫</span> Hide Contact Info';
    } else {
      contactInfo.style.display = "none";
      contactToggle.innerHTML = '<span class="toggle-icon">👁️</span> Show Contact Info';
    }
  });

  contactSection.appendChild(contactToggle);
  contactSection.appendChild(contactInfo);

  // Assemble card
  const cardTop = document.createElement("div");
  cardTop.className = "admin-card-top";
  cardTop.appendChild(cardHeader);
  cardTop.appendChild(actions);

  card.appendChild(cardTop);
  card.appendChild(cardContent);
  card.appendChild(contactSection);

  return card;
}

async function renderAdminStreetHighlightsSection(dashboard) {
  // Fetch highlights
  try {
    const highlights = await fetch(`${API_BASE}/street-highlights`).then(r => r.json());
    
    const highlightsSection = document.createElement("div");
    highlightsSection.className = "admin-highlights-section";
    highlightsSection.style.cssText = "margin-top: 2rem; padding-top: 2rem; border-top: 2px solid #e5e7eb;";
    
    const sectionHeader = document.createElement("div");
    sectionHeader.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;";
    
    const sectionTitle = document.createElement("h2");
    sectionTitle.textContent = "Street Highlights";
    sectionTitle.style.cssText = "font-size: 1.25rem; font-weight: 600; color: #1f2937; margin: 0;";
    
    const highlightsCount = document.createElement("div");
    highlightsCount.textContent = `${highlights.length} Highlight${highlights.length !== 1 ? 's' : ''}`;
    highlightsCount.style.cssText = "font-size: 0.875rem; color: #6b7280;";
    
    sectionHeader.appendChild(sectionTitle);
    sectionHeader.appendChild(highlightsCount);
    highlightsSection.appendChild(sectionHeader);
    
    if (highlights.length === 0) {
      const emptyMsg = document.createElement("div");
      emptyMsg.textContent = "No street highlights yet. Click 'Highlight a Street' to create one.";
      emptyMsg.style.cssText = "text-align: center; padding: 2rem; color: #9ca3af;";
      highlightsSection.appendChild(emptyMsg);
    } else {
      const highlightsList = document.createElement("div");
      highlightsList.style.cssText = "display: flex; flex-direction: column; gap: 0.75rem;";
      
      highlights.forEach((highlight) => {
        const highlightCard = document.createElement("div");
        highlightCard.style.cssText = "background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem;";
        
        const reasonLabels = {
          "poor_lighting": "💡 Poor Lighting",
          "crowded": "👥 Crowded/Disruptive",
          "harassment": "⚠️ Harassment/Suspicious",
          "protest": "📢 Protest Spillover",
          "other": "📄 Other"
        };
        
        const colorLabels = {
          "red": "🔴 Red - Multiple urgent reports",
          "yellow": "🟡 Yellow - Medium activity",
          "green": "🟢 Green - Low concern"
        };
        
        // Escape description for HTML attribute
        const escapedDescription = (highlight.description || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        
        highlightCard.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5rem;">
            <div>
              <div style="font-weight: 600; color: #1f2937; margin-bottom: 0.25rem;">${reasonLabels[highlight.reason] || highlight.reason}</div>
              <div style="font-size: 0.875rem; color: #6b7280;">${colorLabels[highlight.color] || highlight.color}</div>
            </div>
            <div style="display: flex; gap: 0.5rem;">
              <button class="admin-edit-highlight-btn" data-id="${highlight.id}" data-color="${highlight.color || 'yellow'}" data-reason="${highlight.reason || 'other'}" data-description="${escapedDescription}" style="background: #3b82f6; color: white; border: none; border-radius: 6px; padding: 0.375rem 0.75rem; font-size: 0.75rem; cursor: pointer; font-weight: 500;">
                Edit
              </button>
              <button class="admin-delete-highlight-btn" data-id="${highlight.id}" style="background: #ef4444; color: white; border: none; border-radius: 6px; padding: 0.375rem 0.75rem; font-size: 0.75rem; cursor: pointer; font-weight: 500;">
                Delete
              </button>
            </div>
          </div>
          ${highlight.description ? `<div style="font-size: 0.875rem; color: #374151; margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid #e5e7eb;">${highlight.description}</div>` : ''}
          <div style="font-size: 0.75rem; color: #9ca3af; margin-top: 0.5rem;">
            Created: ${new Date(highlight.created_at).toLocaleString()}
          </div>
        `;
        
        highlightsList.appendChild(highlightCard);
      });
      
      highlightsSection.appendChild(highlightsList);
      
      // Add edit handlers
      highlightsList.querySelectorAll(".admin-edit-highlight-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          openEditHighlightModal({
            id: btn.dataset.id,
            color: btn.dataset.color,
            reason: btn.dataset.reason,
            description: btn.dataset.description
          });
        });
      });
      
      // Add delete handlers
      highlightsList.querySelectorAll(".admin-delete-highlight-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (confirm("Are you sure you want to delete this street highlight?")) {
            try {
              const response = await fetch(`${API_BASE}/admin/street-highlights/${btn.dataset.id}`, {
                method: "DELETE"
              });
              if (response.ok) {
                await renderAdminDashboard();
                await fetchAdminStreetHighlights();
                alert("Street highlight deleted successfully!");
              } else {
                throw new Error("Failed to delete");
              }
            } catch (error) {
              console.error("Failed to delete highlight:", error);
              alert("Failed to delete street highlight. Please try again.");
            }
          }
        });
      });
    }
    
    dashboard.appendChild(highlightsSection);
  } catch (error) {
    console.error("Failed to load street highlights:", error);
  }
}

function openEditModal(incident) {
  const editModal = document.getElementById("edit-modal");
  const editForm = document.getElementById("edit-form");
  
  // Set current values
  document.getElementById("edit-description").value = incident.description || "";
  
  // Set category chip
  const categoryChips = document.querySelectorAll("#edit-category-chips .chip");
  categoryChips.forEach(chip => {
    chip.classList.remove("active");
    if (chip.dataset.value === incident.category) {
      chip.classList.add("active");
    }
  });
  
  // Set urgency chip
  const urgencyChips = document.querySelectorAll("#edit-urgency-chips .chip");
  urgencyChips.forEach(chip => {
    chip.classList.remove("active");
    if (chip.dataset.value === incident.urgency) {
      chip.classList.add("active");
    }
  });

  // Store incident ID for update
  editForm.dataset.incidentId = incident.id;
  
  editModal.classList.remove("hidden");
  editModal.setAttribute("aria-hidden", "false");
}

function setupEditForm() {
  const editForm = document.getElementById("edit-form");
  const editClose = document.getElementById("edit-close");
  const editModal = document.getElementById("edit-modal");
  
  if (!editForm) return;
  
  // Initialize chip selection for edit form
  initChipSelection("edit-category-chips");
  initChipSelection("edit-urgency-chips");
  
  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const incidentId = editForm.dataset.incidentId;
    if (!incidentId) return;
    
    const category = getActiveChipValue("edit-category-chips");
    const urgency = getActiveChipValue("edit-urgency-chips");
    const description = document.getElementById("edit-description").value.trim();
    
    if (!category || !urgency || !description) {
      alert("Please fill in all fields.");
      return;
    }
    
    try {
      await updateIncident(incidentId, {
        category,
        urgency,
        description,
      });
      await fetchIncidents();
      await renderAdminDashboard();
      editModal.classList.add("hidden");
      editModal.setAttribute("aria-hidden", "true");
    } catch (e) {
      alert("Failed to update incident.");
    }
  });
  
  editClose.addEventListener("click", () => {
    editModal.classList.add("hidden");
    editModal.setAttribute("aria-hidden", "true");
  });
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
  const adminBody = document.getElementById("admin-body");

  if (adminBody && !adminLoginTemplate) {
    adminLoginTemplate = adminBody.innerHTML;
  }

  adminButton.addEventListener("click", (e) => {
    e.preventDefault();
    adminModal.classList.remove("hidden");
    adminModal.setAttribute("aria-hidden", "false");
    if (!isAdminLoggedIn) {
      setupAdminLoginForm();
    }
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
  adminHighlightsLayer = L.layerGroup().addTo(map);
  streetNotesLayer = L.layerGroup().addTo(map);
  
  // Add street highlights legend
  addStreetHighlightsLegend();
  
  // Add notes toggle control
  addNotesToggle();
  
  // Load and render admin street highlights
  fetchAdminStreetHighlights();
  
  // Load and render street notes
  fetchStreetNotes();
}

// Admin Street Highlights Functions
async function fetchAdminStreetHighlights() {
  try {
    const response = await fetch(`${API_BASE}/street-highlights`);
    if (response.ok) {
      const data = await response.json();
      adminStreetHighlights = data || [];
      renderAdminStreetHighlights();
    }
  } catch (error) {
    console.error("Failed to fetch admin street highlights:", error);
    adminStreetHighlights = [];
  }
}

function renderAdminStreetHighlights() {
  if (!adminHighlightsLayer) return;
  
  adminHighlightsLayer.clearLayers();
  
  adminStreetHighlights.forEach((highlight) => {
    const color = getHighlightColorCode(highlight.color);
    const weight = highlight.color === "red" ? 10 : highlight.color === "yellow" ? 8 : 6;
    
    // Create polyline from start to end pin
    const polyline = L.polyline([
      [highlight.start_lat, highlight.start_lng],
      [highlight.end_lat, highlight.end_lng]
    ], {
      color: color,
      weight: weight,
      opacity: 0.8,
      lineCap: 'round',
      lineJoin: 'round'
    });
    
    // Add click handler to show description
    polyline.on('click', () => {
      showHighlightDescription(highlight);
    });
    
    // Add hover effect
    polyline.on('mouseover', function() {
      this.setStyle({ weight: weight + 2, opacity: 1 });
    });
    polyline.on('mouseout', function() {
      this.setStyle({ weight: weight, opacity: 0.8 });
    });
    
    adminHighlightsLayer.addLayer(polyline);
  });
}

function getHighlightColorCode(colorName) {
  switch (colorName) {
    case "red":
      return "#ef4444"; // Red
    case "yellow":
      return "#eab308"; // Yellow
    case "green":
      return "#22c55e"; // Green
    default:
      return "#eab308"; // Default to yellow
  }
}

function showHighlightDescription(highlight) {
  const reasonLabels = {
    "poor_lighting": "Poor Lighting",
    "crowded": "Crowded/Disruptive",
    "harassment": "Harassment/Suspicious",
    "protest": "Protest Spillover",
    "other": "Other"
  };
  
  const reasonText = reasonLabels[highlight.reason] || highlight.reason;
  const midLat = (highlight.start_lat + highlight.end_lat) / 2;
  const midLng = (highlight.start_lng + highlight.end_lng) / 2;
  
  const description = highlight.description || "No additional details provided.";
  
  L.popup()
    .setLatLng([midLat, midLng])
    .setContent(`
      <div style="padding: 0.5rem; max-width: 280px;">
        <div style="font-weight: 600; margin-bottom: 0.5rem; color: #1f2937;">${reasonText}</div>
        <div style="font-size: 0.875rem; color: #4b5563; line-height: 1.5;">${description}</div>
        <div style="font-size: 0.75rem; color: #9ca3af; margin-top: 0.5rem;">
          Highlighted by admin
        </div>
      </div>
    `)
    .openOn(map);
}

function addStreetHighlightsLegend() {
  if (!map) return;
  
  const legend = L.control({ position: "bottomleft" });
  
  legend.onAdd = function() {
    const div = L.DomUtil.create("div", "street-highlights-legend");
    div.style.cssText = "background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(8px); padding: 0.375rem 0.5rem; border-radius: 4px; box-shadow: 0 1px 4px rgba(0,0,0,0.1); font-size: 0.6875rem; line-height: 1.3; min-width: 140px; max-width: 160px; z-index: 1000;";
    div.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 0.25rem; font-size: 0.75rem;">Street Highlights</div>
      <div style="display: flex; align-items: center; margin-bottom: 0.1875rem;">
        <div style="width: 18px; height: 2.5px; background: #ef4444; border-radius: 1px; margin-right: 0.375rem; flex-shrink: 0;"></div>
        <span style="font-size: 0.6875rem; line-height: 1.2;">Multiple urgent reports</span>
      </div>
      <div style="display: flex; align-items: center; margin-bottom: 0.1875rem;">
        <div style="width: 18px; height: 2.5px; background: #eab308; border-radius: 1px; margin-right: 0.375rem; flex-shrink: 0;"></div>
        <span style="font-size: 0.6875rem; line-height: 1.2;">Medium activity</span>
      </div>
      <div style="display: flex; align-items: center; margin-bottom: 0.25rem;">
        <div style="width: 18px; height: 2.5px; background: #22c55e; border-radius: 1px; margin-right: 0.375rem; flex-shrink: 0;"></div>
        <span style="font-size: 0.6875rem; line-height: 1.2;">Low concern</span>
      </div>
      <div style="font-size: 0.625rem; color: #6b7280; border-top: 1px solid rgba(229, 231, 235, 0.5); padding-top: 0.25rem; margin-top: 0.25rem; line-height: 1.2;">
        Tap segments for details
      </div>
    `;
    return div;
  };
  
  legend.addTo(map);
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
  
  // Quick filter in navigation bar - filters map directly
  const quickFilter = document.getElementById("quick-filter");
  if (quickFilter) {
    quickFilter.addEventListener("change", (e) => {
      const value = e.target.value;
      
      // Update map filter state
      if (value === "high") {
        mapFilterState.urgency = "high";
        mapFilterState.hours = null;
      } else if (value === "2" || value === "4") {
        mapFilterState.hours = parseInt(value, 10);
        mapFilterState.urgency = null;
      } else {
        // "All Reports" - clear filters
        mapFilterState.hours = null;
        mapFilterState.urgency = null;
      }
      
      // Update map markers with filtered incidents
      renderMapMarkers();
      
      // Also update list view filters if user is on list view (for consistency)
      const listView = document.getElementById("view-list");
      if (listView && listView.classList.contains("active")) {
        if (value === "high") {
          document.getElementById("list-urgency-filter").value = "high";
        } else if (value === "2" || value === "4") {
          document.getElementById("list-time-filter").value = value;
        } else {
          document.getElementById("list-time-filter").value = "";
          document.getElementById("list-urgency-filter").value = "";
        }
        renderList();
      }
      
      quickFilter.value = ""; // Reset dropdown
    });
  }
}

// Street Notes Functions
async function fetchStreetNotes() {
  try {
    const response = await fetch(`${API_BASE}/street-notes`);
    if (response.ok) {
      streetNotes = await response.json();
      renderStreetNotes();
      renderList();
    }
  } catch (error) {
    console.error("Failed to fetch street notes:", error);
  }
}

function renderStreetNotes() {
  if (!streetNotesLayer) return;
  streetNotesLayer.clearLayers();
  
  if (!showStreetNotes) return;
  
  streetNotes.forEach((note) => {
    const icon = L.divIcon({
      className: "street-note-pin",
      html: '<div style="background: #1E88E5; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid white; box-shadow: 0 1px 4px rgba(0,0,0,0.3); font-size: 12px;">📝</div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    
    const marker = L.marker([note.latitude, note.longitude], { icon });
    
    const timeAgo = humanTimeAgo(note.created_at);
    const imageHtml = note.image_url
      ? `<div style="margin-bottom: 0.5rem;"><img src="${note.image_url}" alt="Street note image" style="display:block; width:100%; max-width:200px; max-height:140px; object-fit:cover; border-radius: 6px; border: 1px solid #dbeafe;" /></div>`
      : "";
    const locationHtml = note.location_text
      ? `<div style="font-size: 0.75rem; color: #6b7280; margin-bottom: 0.5rem;">📍 ${note.location_text}</div>`
      : "";
    marker.bindPopup(`
      <div style="max-width: 220px; padding: 0.25rem;">
        ${imageHtml}
        ${locationHtml}
        <div style="font-size: 0.9375rem; color: #1f2937; line-height: 1.5; margin-bottom: 0.5rem;">${note.text}</div>
        <div style="font-size: 0.75rem; color: #9ca3af;">${timeAgo} &middot; expires in 24h</div>
      </div>
    `);
    
    streetNotesLayer.addLayer(marker);
  });
}

function addNotesToggle() {
  if (!map) return;
  
  const toggle = L.control({ position: "topright" });
  
  toggle.onAdd = function() {
    const div = L.DomUtil.create("div", "notes-toggle-container");
    div.innerHTML = `
      <span style="font-size: 0.75rem;">📝 Notes</span>
      <div class="notes-toggle-switch active" id="notes-toggle"></div>
    `;
    
    L.DomEvent.disableClickPropagation(div);
    
    const toggleSwitch = div.querySelector("#notes-toggle");
    toggleSwitch.addEventListener("click", () => {
      showStreetNotes = !showStreetNotes;
      toggleSwitch.classList.toggle("active", showStreetNotes);
      renderStreetNotes();
    });
    
    return div;
  };
  
  toggle.addTo(map);
}

function openStreetNoteModal() {
  const modal = document.getElementById("street-note-modal");
  if (!modal) return;
  
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  
  // Reset form
  const textarea = document.getElementById("street-note-text");
  const countEl = document.getElementById("street-note-count");
  const submitBtn = document.getElementById("street-note-submit");
  const imageInput = document.getElementById("street-note-image");
  const imageMeta = document.getElementById("street-note-image-meta");
  const locationInput = document.getElementById("street-note-location");
  if (textarea) textarea.value = "";
  if (countEl) countEl.textContent = "0";
  if (submitBtn) submitBtn.disabled = true;
  if (submitBtn) submitBtn.textContent = "Post Note";
  if (imageInput) imageInput.value = "";
  if (imageMeta) imageMeta.textContent = "No image selected";
  if (locationInput) locationInput.value = "";
  
  // Get user location for display
  const locationDisplay = document.getElementById("street-note-location");
  if (userLocation) {
    streetNoteLocation = { lat: userLocation.lat, lng: userLocation.lng };
    reverseGeocode(userLocation.lat, userLocation.lng).then(desc => {
      if (locationDisplay) locationDisplay.value = desc || `${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}`;
    });
  } else if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        streetNoteLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        reverseGeocode(userLocation.lat, userLocation.lng).then(desc => {
          if (locationDisplay) locationDisplay.value = desc || `${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}`;
        });
      },
      () => {
        streetNoteLocation = { lat: MELBOURNE_CBD.lat, lng: MELBOURNE_CBD.lng };
        if (locationDisplay) locationDisplay.value = "Melbourne CBD (default)";
      }
    );
  } else {
    streetNoteLocation = { lat: MELBOURNE_CBD.lat, lng: MELBOURNE_CBD.lng };
    if (locationDisplay) locationDisplay.value = "Melbourne CBD (default)";
  }
}

function closeStreetNoteModal() {
  const modal = document.getElementById("street-note-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

async function fileToImageDataUrl(file, maxWidth = 1280, maxHeight = 1280, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(maxWidth / width, maxHeight / height, 1);
        width = Math.round(width * scale);
        height = Math.round(height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Unable to process image"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Invalid image file"));
      img.src = String(reader.result || "");
    };
    reader.onerror = () => reject(new Error("Unable to read image file"));
    reader.readAsDataURL(file);
  });
}

async function submitStreetNote() {
  const textarea = document.getElementById("street-note-text");
  const text = textarea ? textarea.value.trim() : "";
  const locationInput = document.getElementById("street-note-location");
  const locationText = locationInput ? locationInput.value.trim() : "";
  const imageInput = document.getElementById("street-note-image");
  const selectedFile = imageInput && imageInput.files ? imageInput.files[0] : null;
  
  if (!text) {
    alert("Please write something for your note.");
    return;
  }
  
  const lat = streetNoteLocation ? streetNoteLocation.lat : (userLocation ? userLocation.lat : MELBOURNE_CBD.lat);
  const lng = streetNoteLocation ? streetNoteLocation.lng : (userLocation ? userLocation.lng : MELBOURNE_CBD.lng);
  
  const submitBtn = document.getElementById("street-note-submit");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Posting...";
  }
  
  try {
    // Optional image: convert to data URL for lightweight local testing
    let imageUrl = "";
    if (selectedFile) {
      // Guard very large files early
      if (selectedFile.size > 10 * 1024 * 1024) {
        throw new Error("Image too large. Please choose an image under 10MB.");
      }
      // Compress/resize for stable posting in production
      imageUrl = await fileToImageDataUrl(selectedFile, 1280, 1280, 0.8);
      // Soft limit after encoding (base64 grows payload)
      if (imageUrl.length > 2_000_000) {
        throw new Error("Image is still too large after compression. Try a smaller image.");
      }
    }

    const response = await fetch(`${API_BASE}/street-notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text,
        latitude: lat,
        longitude: lng,
        location_text: locationText,
        image_url: imageUrl
      }),
    });
    
    if (response.ok) {
      await fetchStreetNotes();
      closeStreetNoteModal();
    } else {
      const errText = await response.text();
      throw new Error(`Failed to post note: ${response.status} ${errText}`);
    }
  } catch (error) {
    console.error("Failed to post street note:", error);
    alert(error && error.message ? error.message : "Failed to post note. Please try again.");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Post Note";
    }
  }
}

function initStreetNoteModal() {
  // Notes button
  const notesBtn = document.getElementById("notes-button");
  if (notesBtn) {
    notesBtn.addEventListener("click", openStreetNoteModal);
  }
  
  // Close button
  const closeBtn = document.getElementById("street-note-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", closeStreetNoteModal);
  }
  
  // Submit button
  const submitBtn = document.getElementById("street-note-submit");
  if (submitBtn) {
    submitBtn.addEventListener("click", submitStreetNote);
  }

  // Use current location button
  const useLocationBtn = document.getElementById("street-note-use-location");
  if (useLocationBtn) {
    useLocationBtn.addEventListener("click", () => {
      const locationDisplay = document.getElementById("street-note-location");
      if (!navigator.geolocation) {
        if (locationDisplay) locationDisplay.textContent = "GPS unavailable on this device";
        streetNoteLocation = { lat: MELBOURNE_CBD.lat, lng: MELBOURNE_CBD.lng };
        return;
      }
      useLocationBtn.disabled = true;
      useLocationBtn.textContent = "Getting location...";
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          streetNoteLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          reverseGeocode(streetNoteLocation.lat, streetNoteLocation.lng).then((desc) => {
            if (locationDisplay) {
              locationDisplay.value = desc || `${streetNoteLocation.lat.toFixed(4)}, ${streetNoteLocation.lng.toFixed(4)}`;
            }
          });
          useLocationBtn.disabled = false;
          useLocationBtn.textContent = "Use my current GPS location";
        },
        () => {
          if (locationDisplay) locationDisplay.value = "Could not access GPS location";
          useLocationBtn.disabled = false;
          useLocationBtn.textContent = "Use my current GPS location";
        },
        { enableHighAccuracy: true, maximumAge: 60000, timeout: 10000 }
      );
    });
  }
  
  // Character counter
  const textarea = document.getElementById("street-note-text");
  if (textarea) {
    textarea.addEventListener("input", () => {
      const count = textarea.value.length;
      const countEl = document.getElementById("street-note-count");
      if (countEl) countEl.textContent = count;
      
      const btn = document.getElementById("street-note-submit");
      if (btn) btn.disabled = count === 0 || count > 150;
    });
  }

  // Image file metadata
  const imageInput = document.getElementById("street-note-image");
  if (imageInput) {
    imageInput.addEventListener("change", () => {
      const imageMeta = document.getElementById("street-note-image-meta");
      const file = imageInput.files && imageInput.files[0] ? imageInput.files[0] : null;
      if (!imageMeta) return;
      if (!file) {
        imageMeta.textContent = "No image selected";
        return;
      }
      const kb = Math.round(file.size / 1024);
      if (kb > 10240) {
        imageMeta.textContent = `${file.name} (${kb} KB) - too large (max 10MB)`;
      } else {
        imageMeta.textContent = `${file.name} (${kb} KB)`;
      }
    });
  }
  
  // Backdrop click
  const modal = document.getElementById("street-note-modal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeStreetNoteModal();
    });
  }
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

// Chat functionality
let chatMessages = [];
let chatRefreshInterval = null;
let currentUserId = null; // Track current user for message styling

// Generate or get user ID for chat
function getChatUserId() {
  if (!currentUserId) {
    currentUserId = localStorage.getItem('chatUserId');
    if (!currentUserId) {
      currentUserId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('chatUserId', currentUserId);
    }
  }
  return currentUserId;
}

async function fetchChatMessages() {
  try {
    const response = await fetch(`${API_BASE}/chat/messages`);
    if (response.ok) {
      const data = await response.json();
      chatMessages = data || [];
      renderChatMessages();
    }
  } catch (error) {
    console.error("Failed to fetch chat messages:", error);
  }
}

function renderChatMessages() {
  const container = document.getElementById("chat-messages-container");
  if (!container) return;

  if (chatMessages.length === 0) {
    container.innerHTML = '<div class="chat-loading">No messages yet. Be the first to say something!</div>';
    return;
  }

  container.innerHTML = "";
  const currentUserId = getChatUserId();

  chatMessages.forEach((msg) => {
    const messageDiv = document.createElement("div");
    messageDiv.className = "chat-message";
    
    // Check if this is user's own message (by comparing with stored ID or checking timestamp proximity)
    // For simplicity, we'll just style all messages the same way, but you could add user tracking
    const isOwn = false; // Could be enhanced with proper user session tracking
    
    if (isOwn) {
      messageDiv.classList.add("own-message");
    }

    const authorDiv = document.createElement("div");
    authorDiv.className = "chat-message-author";
    authorDiv.textContent = msg.author || "Anonymous";

    const textDiv = document.createElement("div");
    textDiv.className = "chat-message-text";
    // Escape HTML and preserve line breaks
    textDiv.textContent = msg.message;

    const timeDiv = document.createElement("div");
    timeDiv.className = "chat-message-time";
    const msgTime = typeof msg.timestamp === 'string' ? new Date(msg.timestamp) : msg.timestamp;
    timeDiv.textContent = formatChatTime(msgTime);

    messageDiv.appendChild(authorDiv);
    messageDiv.appendChild(textDiv);
    messageDiv.appendChild(timeDiv);
    container.appendChild(messageDiv);
  });

  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

function formatChatTime(date) {
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function sendChatMessage() {
  const input = document.getElementById("chat-message-input");
  const sendButton = document.getElementById("chat-send-button");
  
  const message = input.value.trim();
  if (!message) return;

  sendButton.disabled = true;
  sendButton.textContent = "Sending...";

  try {
    const response = await fetch(`${API_BASE}/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: message,
        author: "Anonymous" // Could be enhanced with user names
      }),
    });

    if (response.ok) {
      input.value = "";
      await fetchChatMessages(); // Refresh messages
    } else {
      alert("Failed to send message. Please try again.");
    }
  } catch (error) {
    console.error("Failed to send message:", error);
    alert("Failed to send message. Please try again.");
  } finally {
    sendButton.disabled = false;
    sendButton.textContent = "Send";
  }
}

function openChatModal() {
  console.log("Opening chat modal...");
  const chatModal = document.getElementById("chat-modal");
  if (!chatModal) {
    console.error("Chat modal not found!");
    return;
  }

  chatModal.classList.remove("hidden");
  chatModal.setAttribute("aria-hidden", "false");
  
  // Load messages when opening
  fetchChatMessages();
  
  // Start auto-refresh every 5 seconds
  if (chatRefreshInterval) {
    clearInterval(chatRefreshInterval);
  }
  chatRefreshInterval = setInterval(() => {
    fetchChatMessages();
  }, 5000);

  // Focus on input
  setTimeout(() => {
    const input = document.getElementById("chat-message-input");
    if (input) input.focus();
  }, 100);
}

function closeChatModal() {
  console.log("Closing chat modal");
  const chatModal = document.getElementById("chat-modal");
  if (!chatModal) return;

  chatModal.classList.add("hidden");
  chatModal.setAttribute("aria-hidden", "true");
  
  // Stop auto-refresh
  if (chatRefreshInterval) {
    clearInterval(chatRefreshInterval);
    chatRefreshInterval = null;
  }
  
  // Clear input
  const input = document.getElementById("chat-message-input");
  if (input) input.value = "";
}

// Highlight Street Modal Functions
function openHighlightStreetModal() {
  const modal = document.getElementById("highlight-street-modal");
  if (!modal) return;
  
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  
  // Initialize map if not already done
  if (!highlightMap) {
    highlightMap = L.map("highlight-map").setView(
      [MELBOURNE_CBD.lat, MELBOURNE_CBD.lng],
      MELBOURNE_CBD.zoom
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(highlightMap);
    
    // Add click handler to place pins
    highlightMap.on("click", (e) => {
      placeHighlightPin(e.latlng);
    });
  } else {
    // Invalidate size when reopening
    setTimeout(() => {
      highlightMap.invalidateSize();
    }, 100);
  }
  
  // Reset form
  highlightPinA = null;
  highlightPinB = null;
  selectedHighlightColor = "yellow";
  selectedHighlightReason = "other";
  document.getElementById("highlight-description").value = "";
  updatePinDisplay();
  updateSubmitButton();
}

function closeHighlightStreetModal() {
  const modal = document.getElementById("highlight-street-modal");
  if (!modal) return;
  
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  
  // Clear pins from map
  if (highlightMap) {
    highlightMap.eachLayer((layer) => {
      if (layer instanceof L.Marker || layer instanceof L.Polyline) {
        highlightMap.removeLayer(layer);
      }
    });
  }
  
  highlightPinA = null;
  highlightPinB = null;
}

function placeHighlightPin(latlng) {
  if (!highlightPinA) {
    // Place first pin (A)
    highlightPinA = latlng;
    const markerA = L.marker(latlng, {
      icon: L.divIcon({
        className: "highlight-pin",
        html: '<div style="background: #22c55e; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">A</div>',
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      })
    }).addTo(highlightMap);
    updatePinDisplay();
  } else if (!highlightPinB) {
    // Place second pin (B)
    highlightPinB = latlng;
    const markerB = L.marker(latlng, {
      icon: L.divIcon({
        className: "highlight-pin",
        html: '<div style="background: #ef4444; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">B</div>',
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      })
    }).addTo(highlightMap);
    
    // Draw line between pins
    L.polyline([highlightPinA, highlightPinB], {
      color: getHighlightColorCode(selectedHighlightColor),
      weight: 6,
      opacity: 0.7,
      dashArray: "10, 10"
    }).addTo(highlightMap);
    
    updatePinDisplay();
    updateSubmitButton();
  } else {
    // Reset and place new pin A
    highlightMap.eachLayer((layer) => {
      if (layer instanceof L.Marker || layer instanceof L.Polyline) {
        highlightMap.removeLayer(layer);
      }
    });
    highlightPinA = latlng;
    highlightPinB = null;
    const markerA = L.marker(latlng, {
      icon: L.divIcon({
        className: "highlight-pin",
        html: '<div style="background: #22c55e; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">A</div>',
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      })
    }).addTo(highlightMap);
    updatePinDisplay();
    updateSubmitButton();
  }
}

function updatePinDisplay() {
  const pinAEl = document.getElementById("pin-a-coords");
  const pinBEl = document.getElementById("pin-b-coords");
  
  if (highlightPinA) {
    pinAEl.textContent = `Start (A) ${highlightPinA.lat.toFixed(4)}, ${highlightPinA.lng.toFixed(4)}`;
    pinAEl.classList.add("has-coords");
  } else {
    pinAEl.textContent = "Start (A) - Click on map";
    pinAEl.classList.remove("has-coords");
  }
  
  if (highlightPinB) {
    pinBEl.textContent = `Destination (B) ${highlightPinB.lat.toFixed(4)}, ${highlightPinB.lng.toFixed(4)}`;
    pinBEl.classList.add("has-coords");
  } else {
    pinBEl.textContent = "Destination (B) - Click on map";
    pinBEl.classList.remove("has-coords");
  }
}

function updateSubmitButton() {
  const submitBtn = document.getElementById("highlight-submit");
  if (submitBtn) {
    submitBtn.disabled = !(highlightPinA && highlightPinB);
  }
}

async function submitStreetHighlight() {
  if (!highlightPinA || !highlightPinB) {
    alert("Please place both pins on the map");
    return;
  }
  
  const description = document.getElementById("highlight-description").value.trim();
  const submitBtn = document.getElementById("highlight-submit");
  
  submitBtn.disabled = true;
  submitBtn.textContent = "Creating...";
  
  try {
    const response = await fetch(`${API_BASE}/admin/street-highlights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start_lat: highlightPinA.lat,
        start_lng: highlightPinA.lng,
        end_lat: highlightPinB.lat,
        end_lng: highlightPinB.lng,
        color: selectedHighlightColor,
        reason: selectedHighlightReason,
        description: description
      }),
    });
    
    if (response.ok) {
      await fetchAdminStreetHighlights();
      closeHighlightStreetModal();
      alert("Street highlight created successfully!");
    } else {
      throw new Error("Failed to create highlight");
    }
  } catch (error) {
    console.error("Failed to create street highlight:", error);
    alert("Failed to create street highlight. Please try again.");
    submitBtn.disabled = false;
    submitBtn.textContent = "Create Highlight";
  }
}

// Edit Highlight Modal Functions
function openEditHighlightModal(highlight) {
  // Create modal overlay
  const modalOverlay = document.createElement("div");
  modalOverlay.className = "modal-overlay";
  modalOverlay.setAttribute("aria-hidden", "false");
  modalOverlay.style.zIndex = "10000";
  
  const modalContent = document.createElement("div");
  modalContent.className = "highlight-modal-content";
  
  modalContent.innerHTML = `
    <div class="highlight-header">
      <h2>✏️ Edit Street Highlight</h2>
      <button class="highlight-close edit-highlight-close" type="button" aria-label="Close">&times;</button>
    </div>
    <div class="highlight-form" style="padding: 1.5rem;">
      <div class="highlight-section">
        <label class="highlight-label">Current Color: <span id="current-color-display"></span></label>
        <div class="color-selector" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-top: 0.5rem;">
          <button type="button" class="color-btn" data-color="red" style="padding: 0.75rem; background: #fee2e2; border: 2px solid #fca5a5; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
            <span style="width: 24px; height: 4px; background: #ef4444; border-radius: 2px;"></span>
            <span style="font-size: 0.875rem; font-weight: 500;">Red</span>
          </button>
          <button type="button" class="color-btn" data-color="yellow" style="padding: 0.75rem; background: #fef3c7; border: 2px solid #fbbf24; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
            <span style="width: 24px; height: 4px; background: #eab308; border-radius: 2px;"></span>
            <span style="font-size: 0.875rem; font-weight: 500;">Yellow</span>
          </button>
          <button type="button" class="color-btn" data-color="green" style="padding: 0.75rem; background: #dcfce7; border: 2px solid #86efac; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
            <span style="width: 24px; height: 4px; background: #22c55e; border-radius: 2px;"></span>
            <span style="font-size: 0.875rem; font-weight: 500;">Green</span>
          </button>
        </div>
      </div>
      <div class="highlight-section">
        <label class="highlight-label">Reason for Concern *</label>
        <div class="reason-buttons">
          <button type="button" class="reason-btn-edit" data-reason="poor_lighting" data-color="yellow">
            <span>💡</span> Poor Lighting
          </button>
          <button type="button" class="reason-btn-edit" data-reason="crowded" data-color="yellow">
            <span>👥</span> Crowded/Disruptive
          </button>
          <button type="button" class="reason-btn-edit" data-reason="harassment" data-color="red">
            <span>⚠️</span> Harassment/Suspicious
          </button>
          <button type="button" class="reason-btn-edit" data-reason="protest" data-color="red">
            <span>📢</span> Protest Spillover
          </button>
          <button type="button" class="reason-btn-edit" data-reason="other" data-color="yellow">
            <span>📄</span> Other
          </button>
        </div>
      </div>
      <div class="highlight-section">
        <label class="highlight-label">Additional Details (Optional)</label>
        <textarea
          id="edit-highlight-description"
          class="highlight-textarea"
          placeholder="Add a description for this highlight..."
          rows="3"
          maxlength="500"
        ></textarea>
      </div>
      <div class="highlight-actions">
        <button type="button" class="button-secondary edit-highlight-cancel">Cancel</button>
        <button type="button" class="button-primary" id="edit-highlight-submit">Save Changes</button>
      </div>
    </div>
  `;
  
  modalOverlay.appendChild(modalContent);
  document.body.appendChild(modalOverlay);
  
  // Set initial values
  let selectedColor = highlight.color || "yellow";
  let selectedReason = highlight.reason || "other";
  
  // Set current color display
  const colorDisplay = modalContent.querySelector("#current-color-display");
  const colorNames = { red: "🔴 Red", yellow: "🟡 Yellow", green: "🟢 Green" };
  colorDisplay.textContent = colorNames[selectedColor] || selectedColor;
  
  // Set description
  const descriptionField = modalContent.querySelector("#edit-highlight-description");
  descriptionField.value = highlight.description || "";
  
  // Set active reason button
  const reasonButtons = modalContent.querySelectorAll(".reason-btn-edit");
  reasonButtons.forEach(btn => {
    if (btn.dataset.reason === selectedReason) {
      btn.classList.add("active");
    }
  });
  
  // Set active color button
  const colorButtons = modalContent.querySelectorAll(".color-btn");
  colorButtons.forEach(btn => {
    if (btn.dataset.color === selectedColor) {
      btn.style.borderColor = "#3b82f6";
      btn.style.borderWidth = "3px";
    }
  });
  
  // Color button handlers
  colorButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      // Remove active state from all
      colorButtons.forEach(b => {
        b.style.borderColor = "";
        b.style.borderWidth = "2px";
      });
      // Add active state
      btn.style.borderColor = "#3b82f6";
      btn.style.borderWidth = "3px";
      selectedColor = btn.dataset.color;
      colorDisplay.textContent = colorNames[selectedColor] || selectedColor;
    });
  });
  
  // Reason button handlers
  reasonButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      reasonButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedReason = btn.dataset.reason;
      // Optionally update color based on reason
      const reasonColor = btn.dataset.color;
      if (reasonColor) {
        selectedColor = reasonColor;
        colorDisplay.textContent = colorNames[selectedColor] || selectedColor;
        // Update color button
        colorButtons.forEach(b => {
          b.style.borderColor = "";
          b.style.borderWidth = "2px";
          if (b.dataset.color === selectedColor) {
            b.style.borderColor = "#3b82f6";
            b.style.borderWidth = "3px";
          }
        });
      }
    });
  });
  
  // Submit handler
  const submitBtn = modalContent.querySelector("#edit-highlight-submit");
  submitBtn.addEventListener("click", async () => {
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving...";
    
    try {
      const response = await fetch(`${API_BASE}/admin/street-highlights/${highlight.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          color: selectedColor,
          reason: selectedReason,
          description: descriptionField.value.trim()
        }),
      });
      
      if (response.ok) {
        await fetchAdminStreetHighlights();
        await renderAdminDashboard();
        document.body.removeChild(modalOverlay);
        alert("Street highlight updated successfully!");
      } else {
        throw new Error("Failed to update highlight");
      }
    } catch (error) {
      console.error("Failed to update street highlight:", error);
      alert("Failed to update street highlight. Please try again.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Save Changes";
    }
  });
  
  // Close handlers
  const closeBtn = modalContent.querySelector(".edit-highlight-close");
  const cancelBtn = modalContent.querySelector(".edit-highlight-cancel");
  
  const closeModal = () => {
    document.body.removeChild(modalOverlay);
  };
  
  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) {
      closeModal();
    }
  });
}

// Welcome Notice Functions
async function fetchWelcomeNotice() {
  try {
    const response = await fetch(`${API_BASE}/welcome-notice`);
    if (response.ok) {
      const data = await response.json();
      welcomeNoticeContent = data.content || "";
      welcomeNoticeEnabled = data.enabled !== false;
      console.log("Welcome notice fetched successfully:", {
        hasContent: !!welcomeNoticeContent,
        enabled: welcomeNoticeEnabled
      });
    } else {
      console.error("Failed to fetch welcome notice: HTTP", response.status);
      welcomeNoticeEnabled = false;
    }
  } catch (error) {
    console.error("Failed to fetch welcome notice:", error);
    welcomeNoticeEnabled = false;
    // Set default content if fetch fails
    if (!welcomeNoticeContent) {
      welcomeNoticeContent = `<h2>Welcome to Melbourne Community Map</h2>
<p>This interactive map helps you stay informed about community incidents and safety in Melbourne.</p>
<ul>
<li>📍 Report incidents you've witnessed or experienced</li>
<li>🗺️ View recent community reports on the map</li>
<li>💬 Join the community chat to share updates</li>
<li>📍 Check admin-highlighted streets for important information</li>
</ul>
<p>Your reports help keep the community safe. Stay alert and report responsibly.</p>`;
    }
  }
}

async function checkAndShowWelcomeNotice() {
  // Fetch the notice content
  await fetchWelcomeNotice();
  
  console.log("Welcome notice fetched:", {
    enabled: welcomeNoticeEnabled,
    hasContent: !!welcomeNoticeContent,
    contentLength: welcomeNoticeContent.length
  });
  
  if (!welcomeNoticeEnabled || !welcomeNoticeContent) {
    console.log("Welcome notice disabled or no content");
    return; // Notice is disabled or has no content
  }
  
  // Wait a bit for DOM to be ready, then show the welcome notice
  setTimeout(() => {
    showWelcomeNotice();
  }, 500);
}

function showWelcomeNotice() {
  // Never open Street Note modal from welcome popup flow.
  closeStreetNoteModal();
  const modal = document.getElementById("welcome-notice-modal");
  const body = document.getElementById("welcome-notice-body");
  
  if (!modal || !body) return;
  
  // Set content
  body.innerHTML = welcomeNoticeContent;
  
  // Show modal
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  
  // Add close handler
  const closeBtn = document.getElementById("welcome-notice-close");
  if (closeBtn) {
    // Remove any existing listeners and add new one
    const newCloseBtn = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
    newCloseBtn.addEventListener("click", closeWelcomeNotice);
  }
  
  // Close on backdrop click
  modal.addEventListener("click", function backdropHandler(e) {
    if (e.target === modal) {
      closeWelcomeNotice();
      modal.removeEventListener("click", backdropHandler);
    }
  });
}

function closeWelcomeNotice() {
  const modal = document.getElementById("welcome-notice-modal");
  if (!modal) return;
  
  // Hide modal (removed localStorage check so it shows on every refresh)
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

async function updateWelcomeNotice(content, enabled) {
  try {
    const response = await fetch(`${API_BASE}/admin/welcome-notice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: content,
        enabled: enabled !== false
      }),
    });
    
    if (response.ok) {
      const data = await response.json();
      welcomeNoticeContent = data.content;
      welcomeNoticeEnabled = data.enabled;
      return true;
    }
    return false;
  } catch (error) {
    console.error("Failed to update welcome notice:", error);
    return false;
  }
}

async function showEditWelcomeNoticeModal() {
  // Fetch current welcome notice content first
  await fetchWelcomeNotice();
  
  const modalOverlay = document.createElement("div");
  modalOverlay.className = "modal-overlay";
  modalOverlay.setAttribute("aria-hidden", "false");
  modalOverlay.style.zIndex = "10000";
  
  const modalContent = document.createElement("div");
  modalContent.className = "highlight-modal-content";
  modalContent.style.maxWidth = "600px";
  
  modalContent.innerHTML = `
    <div class="highlight-header">
      <h2>📢 Edit Welcome Notice</h2>
      <button class="highlight-close" type="button" aria-label="Close">&times;</button>
    </div>
    <div class="highlight-form" style="padding: 1.5rem;">
      <div class="highlight-section">
        <label class="highlight-label">Welcome Notice Content *</label>
        <p style="font-size: 0.8125rem; color: #6b7280; margin-bottom: 0.75rem;">
          HTML is supported. This notice will appear to first-time visitors.
        </p>
        <textarea
          id="welcome-notice-editor"
          class="highlight-textarea"
          placeholder="Enter welcome notice content..."
          rows="12"
          style="font-family: monospace; font-size: 0.875rem;"
        ></textarea>
      </div>
      <div class="highlight-section">
        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
          <input type="checkbox" id="welcome-notice-enabled" checked>
          <span>Enable welcome notice</span>
        </label>
      </div>
      <div class="highlight-actions">
        <button type="button" class="button-secondary" id="welcome-notice-cancel">Cancel</button>
        <button type="button" class="button-primary" id="welcome-notice-save">Save Changes</button>
      </div>
    </div>
  `;
  
  modalOverlay.appendChild(modalContent);
  document.body.appendChild(modalOverlay);
  
  // Set current values
  const textarea = modalContent.querySelector("#welcome-notice-editor");
  const enabledCheckbox = modalContent.querySelector("#welcome-notice-enabled");
  
  // Use fetched content or default if empty
  const defaultContent = `<h2>Welcome to Melbourne Community Map</h2>
<p>This interactive map helps you stay informed about community incidents and safety in Melbourne.</p>
<ul>
<li>📍 Report incidents you've witnessed or experienced</li>
<li>🗺️ View recent community reports on the map</li>
<li>💬 Join the community chat to share updates</li>
<li>📍 Check admin-highlighted streets for important information</li>
</ul>
<p>Your reports help keep the community safe. Stay alert and report responsibly.</p>`;
  
  textarea.value = welcomeNoticeContent || defaultContent;
  enabledCheckbox.checked = welcomeNoticeEnabled !== false;
  
  // Close handlers
  const closeBtn = modalContent.querySelector(".highlight-close");
  const cancelBtn = modalContent.querySelector("#welcome-notice-cancel");
  
  const closeModal = () => {
    document.body.removeChild(modalOverlay);
  };
  
  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) {
      closeModal();
    }
  });
  
  // Save handler
  const saveBtn = modalContent.querySelector("#welcome-notice-save");
  saveBtn.addEventListener("click", async () => {
    const content = textarea.value.trim();
    
    if (!content) {
      alert("Please enter welcome notice content");
      return;
    }
    
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
    
    try {
      const response = await fetch(`${API_BASE}/admin/welcome-notice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: content,
          enabled: enabledCheckbox.checked
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        welcomeNoticeContent = data.content;
        welcomeNoticeEnabled = data.enabled;
        alert("Welcome notice updated successfully!");
        closeModal();
        // Refresh welcome notice content
        await fetchWelcomeNotice();
      } else {
        const errorText = await response.text();
        console.error("Failed to update welcome notice:", response.status, errorText);
        alert("Failed to update welcome notice. Status: " + response.status);
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Changes";
      }
    } catch (error) {
      console.error("Error updating welcome notice:", error);
      alert("Failed to update welcome notice. Error: " + error.message);
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Changes";
    }
  });
}

function initHighlightStreetModal() {
  // Close button
  const closeBtn = document.getElementById("highlight-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", closeHighlightStreetModal);
  }
  
  // Cancel button
  const cancelBtn = document.getElementById("highlight-cancel");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", closeHighlightStreetModal);
  }
  
  // Submit button
  const submitBtn = document.getElementById("highlight-submit");
  if (submitBtn) {
    submitBtn.addEventListener("click", submitStreetHighlight);
  }
  
  // Backdrop click
  const modal = document.getElementById("highlight-street-modal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        closeHighlightStreetModal();
      }
    });
  }
  
  // Reason buttons
  const reasonButtons = document.querySelectorAll(".reason-btn");
  reasonButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      // Remove active class from all
      reasonButtons.forEach(b => b.classList.remove("active"));
      // Add active to clicked
      btn.classList.add("active");
      
      selectedHighlightReason = btn.dataset.reason;
      selectedHighlightColor = btn.dataset.color || "yellow";
      
      // Update line color if both pins are placed
      if (highlightPinA && highlightPinB && highlightMap) {
        highlightMap.eachLayer((layer) => {
          if (layer instanceof L.Polyline) {
            highlightMap.removeLayer(layer);
          }
        });
        L.polyline([highlightPinA, highlightPinB], {
          color: getHighlightColorCode(selectedHighlightColor),
          weight: 6,
          opacity: 0.7,
          dashArray: "10, 10"
        }).addTo(highlightMap);
      }
    });
  });
}

function initChat() {
  // Make active users badge clickable to open chat
  const activeUsersBadge = document.getElementById("active-users-badge");
  if (activeUsersBadge) {
    console.log("Active users badge found, adding click handler for chat");
    
    activeUsersBadge.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log("Active users badge clicked - opening chat!");
      openChatModal();
    });
    
    activeUsersBadge.addEventListener("keypress", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openChatModal();
      }
    });
  } else {
    console.error("Active users badge not found!");
  }

  // Chat modal close button
  const chatClose = document.getElementById("chat-close");
  if (chatClose) {
    chatClose.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log("Chat close button clicked");
      closeChatModal();
    });
  }

  // Chat modal backdrop click to close
  const chatModal = document.getElementById("chat-modal");
  if (chatModal) {
    chatModal.addEventListener("click", (e) => {
      if (e.target === chatModal) {
        closeChatModal();
      }
    });
  }

  // Send message button
  const sendButton = document.getElementById("chat-send-button");
  if (sendButton) {
    sendButton.addEventListener("click", sendChatMessage);
  }

  // Send message on Enter key
  const chatInput = document.getElementById("chat-message-input");
  if (chatInput) {
    chatInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        sendChatMessage();
      }
    });
  }
}

function initCollapsibleHeader() {
  const SWIPE_THRESHOLD = 45;
  let touchStartY = 0;

  const isModalOpen = () =>
    document.querySelector('.modal:not(.hidden)') ||
    document.querySelector('.modal-overlay:not(.hidden)') ||
    document.querySelector('.street-note-overlay:not(.hidden)');

  const isMapView = () =>
    document.getElementById('view-map')?.classList.contains('active');

  const collapse = () => {
    if (document.body.classList.contains('header-collapsed')) return;
    document.body.classList.add('header-collapsed');
    setTimeout(() => { if (map) map.invalidateSize(); }, 360);
  };

  const expand = () => {
    if (!document.body.classList.contains('header-collapsed')) return;
    document.body.classList.remove('header-collapsed');
    setTimeout(() => { if (map) map.invalidateSize(); }, 360);
  };

  // Exit-fullscreen button (Leaflet control on the map)
  if (map) {
    const exitBtn = L.control({ position: 'topleft' });
    exitBtn.onAdd = function () {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control exit-fullscreen-btn');
      container.innerHTML = `<a href="#" title="Exit fullscreen" role="button" aria-label="Exit fullscreen">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="4 14 10 14 10 20"></polyline>
          <polyline points="20 10 14 10 14 4"></polyline>
          <line x1="14" y1="10" x2="21" y2="3"></line>
          <line x1="3" y1="21" x2="10" y2="14"></line>
        </svg>
      </a>`;
      L.DomEvent.disableClickPropagation(container);
      container.querySelector('a').addEventListener('click', (e) => {
        e.preventDefault();
        expand();
      });
      return container;
    };
    exitBtn.addTo(map);
  }

  document.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
  }, { passive: true, capture: true });

  document.addEventListener('touchend', (e) => {
    if (isModalOpen()) return;
    const deltaY = touchStartY - e.changedTouches[0].clientY;
    if (deltaY > SWIPE_THRESHOLD) {
      collapse();
    } else if (deltaY < -SWIPE_THRESHOLD) {
      if (!isMapView()) expand();
    }
  }, { passive: true, capture: true });

  const listEl = document.getElementById('incident-list');
  if (listEl) {
    let lastScroll = 0;
    listEl.addEventListener('scroll', () => {
      if (isModalOpen()) return;
      const st = listEl.scrollTop;
      if (st > lastScroll + 8) collapse();
      else if (st < lastScroll - 8) expand();
      lastScroll = st;
    }, { passive: true });
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  // Load user reactions from localStorage
  loadUserReactions();
  
  // Fetch and display live updates content
  await fetchLiveUpdates();
  
  initMap();
  initLocationMap();
  initViewToggle();
  initFilters();
  initModalsAndButtons();
  initChipSelection("category-chips");
  initChipSelection("urgency-chips");
  initAdminModal();
  setupEditForm();
  initChat(); // Initialize chat functionality
  initHighlightStreetModal(); // Initialize highlight street modal
  initStreetNoteModal(); // Initialize street notes modal
  initCollapsibleHeader(); // Fold header on scroll

  try {
    await fetchIncidents();
    await fetchAdminStreetHighlights(); // Load admin street highlights
    await checkAndShowWelcomeNotice(); // Check and show welcome notice if needed
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
      updateActiveUsersCount();
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 60000 }
    );
  }

  // Periodically refresh incidents (e.g. every 60s)
  setInterval(() => {
    fetchIncidents().catch(() => {});
    fetchStreetNotes().catch(() => {});
  }, 60000);

  // Periodically update active users count (every 30 seconds)
  // Send heartbeat to track this user as active
  setInterval(() => {
    updateActiveUsersCount();
  }, 30000);
  
  // Also call immediately on page load
  updateActiveUsersCount();
  
  // Periodically refresh live updates content (every 60 seconds)
  setInterval(() => {
    fetchLiveUpdates().catch(() => {});
  }, 60000);
});


