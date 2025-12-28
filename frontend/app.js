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

function updateActiveUsersCount() {
  const activeUsersText = document.getElementById("active-users-text");
  if (!activeUsersText) return;

  // If user location is not available, show 0
  if (!userLocation) {
    activeUsersText.textContent = "0 people active nearby";
    return;
  }

  // Count unique incidents within 1km radius reported in the last 15 minutes
  // 15 minutes is a reasonable "active" window - users clear out after this time
  const now = new Date();
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
  const nearbyRadius = 1000; // 1km

  // Get unique incidents (by location) that are nearby and recent
  const nearbyIncidents = incidents.filter((inc) => {
    const incidentTime = new Date(inc.timestamp);
    if (incidentTime < fifteenMinutesAgo) return false; // Only incidents from last 15 minutes

    const dist = calculateDistanceMeters(
      userLocation.lat,
      userLocation.lng,
      inc.latitude,
      inc.longitude
    );
    return dist <= nearbyRadius;
  });

  // Count unique locations (estimating unique users based on unique incident locations)
  // Group by rounded coordinates (within ~50m) to estimate unique users
  const uniqueLocations = new Set();
  nearbyIncidents.forEach((inc) => {
    // Round to ~50m precision (approximately 0.0005 degrees)
    const latKey = Math.round(inc.latitude * 2000) / 2000;
    const lngKey = Math.round(inc.longitude * 2000) / 2000;
    uniqueLocations.add(`${latKey},${lngKey}`);
  });

  const activeCount = uniqueLocations.size;

  // Update the text
  if (activeCount === 0) {
    activeUsersText.textContent = "0 people active nearby";
  } else if (activeCount === 1) {
    activeUsersText.textContent = "1 person active nearby";
  } else {
    activeUsersText.textContent = `${activeCount} people active nearby`;
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

async function updateIncident(id, updateData) {
  const res = await fetch(`${API_BASE}/admin/incidents/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updateData),
  });
  if (!res.ok) throw new Error("Failed to update incident");
  return res.json();
}

async function renderAdminDashboard() {
  const adminBody = document.getElementById("admin-body");
  adminBody.innerHTML = "<div class='admin-loading'>Loading incidents…</div>";
  try {
    const data = await loadAdminIncidents();
    
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
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "admin-back-button";
    backBtn.innerHTML = "← Back to Map";
    backBtn.addEventListener("click", () => {
      const adminModal = document.getElementById("admin-modal");
      adminModal.classList.add("hidden");
      adminModal.setAttribute("aria-hidden", "true");
    });
    headerRight.appendChild(backBtn);
    
    header.appendChild(headerLeft);
    header.appendChild(headerRight);
    dashboard.appendChild(header);

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
    adminBody.innerHTML = "";
    adminBody.appendChild(dashboard);
  } catch (e) {
    console.error(e);
    adminBody.innerHTML =
      "<div class='error-text'>Unable to load incidents for admin.</div>";
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

window.addEventListener("DOMContentLoaded", async () => {
  // Load user reactions from localStorage
  loadUserReactions();
  
  initMap();
  initLocationMap();
  initViewToggle();
  initFilters();
  initModalsAndButtons();
  initChipSelection("category-chips");
  initChipSelection("urgency-chips");
  initAdminModal();
  setupEditForm();

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
      updateActiveUsersCount();
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 60000 }
    );
  }

  // Periodically refresh incidents (e.g. every 60s)
  setInterval(() => {
    fetchIncidents().catch(() => {});
  }, 60000);

  // Periodically update active users count (every 30 seconds)
  // This ensures counts decrease as incidents age beyond the 15-minute window
  setInterval(() => {
    if (userLocation) {
      updateActiveUsersCount();
    }
  }, 30000);
});


