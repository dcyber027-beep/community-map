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

// ── Avatar / identity state ──────────────────────────────────────────────────
const AVATAR_ANIMALS = ["🐶","🐱","🐺","🦊","🦝","🦁","🐯","🐷","🐭","🐰","🐼","🐻","🐨"];
const ANIMAL_NAMES   = ["Doggo","Kitty","Wolf","Fox","Raccoon","Lion","Tiger","Piglet","Mouse","Bunny","Panda","Bear","Koala"];

function randomAnimalName() {
  return ANIMAL_NAMES[Math.floor(Math.random() * ANIMAL_NAMES.length)] + " " + Math.floor(Math.random()*100);
}

const avatar = (() => {
  const stored = JSON.parse(localStorage.getItem("userAvatar") || "null");
  return stored || { emoji: "🚫", title: "" };
})();

function saveAvatar() {
  localStorage.setItem("userAvatar", JSON.stringify(avatar));
}

function applyAvatarToUI() {
  const btn = document.getElementById("avatar-btn");
  if (btn) btn.textContent = avatar.emoji;
  // Sync active state in picker
  document.querySelectorAll(".avatar-emoji-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.emoji === avatar.emoji);
  });
}
// ─────────────────────────────────────────────────────────────────────────────
let locationDescriptionCache = new Map(); // Cache for location descriptions
let userReactions = new Map(); // Track user reactions per incident (loaded from localStorage)
let mapFilterState = { hours: null, urgency: null }; // Track map filter state (legacy, derived from uiFilter)

// ── Unified filter state (drives both map + list) ────────────────────────────
// hours: number | null (null = All Time); category: incident category | null (all); urgency: 'high'|'medium'|'low' | null (all)
let uiFilter = { hours: 6, category: null, urgency: null };

// ── Layer visibility toggles ─────────────────────────────────────────────────
let showIncidents = true;       // Reports layer
let showHighlights = true;      // Admin street highlights layer
let showPublicFacilities = false; // Fountains + toilets layer

// Switch between map and list views (replaces old tab-based toggle)
function activateView(view) {
  const mapView = document.getElementById("view-map");
  const listView = document.getElementById("view-list");
  if (!mapView || !listView) return;
  const segMap = document.getElementById("seg-map");
  const segList = document.getElementById("seg-list");
  mapView.classList.remove("slide-from-left", "slide-from-right");
  listView.classList.remove("slide-from-left", "slide-from-right");
  if (view === "list") {
    listView.classList.add("active", "slide-from-right");
    mapView.classList.remove("active");
    if (segMap) segMap.classList.remove("active");
    if (segList) segList.classList.add("active");
    renderList();
  } else {
    mapView.classList.add("active", "slide-from-left");
    listView.classList.remove("active");
    if (segMap) segMap.classList.add("active");
    if (segList) segList.classList.remove("active");
    if (map) setTimeout(() => map.invalidateSize(), 80);
  }
}
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
let cityDrinkingFountains = []; // City of Melbourne official fountain locations
let cityFountainsLayer = null;
let cityPublicToilets = [];
let cityToiletsLayer = null;
let showStreetNotes = true; // Toggle for showing/hiding street notes
let showCityFountains = false; // Official drinking fountains (off by default)
let showCityToilets = false;
let streetNoteLocation = null; // Selected location for Street Note modal

// Peer-location layer — emoji markers for other users and self
let peerLayer = null;
let ownPeerMarker = null;
let peerLocationInterval = null;
const PEER_TTL_MS = 45000; // remove peer after 45 s of silence

// Emoji shortcut definitions for Street Notes
const EMOJI_SHORTCUTS = [
  { emoji: "🚽", label: "Toilet", phrase: "There is a toilet here" },
  { emoji: "💧", label: "Drinking fountain", phrase: "Free drinking fountain here — stay hydrated!" },
  { emoji: "🧋", label: "Drink deal", phrase: "Milk tea deal here" },
  { emoji: "🍩", label: "Dessert deal", phrase: "Sweet treat deal here" },
  { emoji: "☕", label: "Coffee", phrase: "Great coffee around here" },
  { emoji: "🍜", label: "Food", phrase: "Cheap eats nearby" },
  { emoji: "🅿️", label: "Parking", phrase: "Free parking spot here" },
  { emoji: "🎵", label: "Music", phrase: "Live music / busker here" },
  { emoji: "❤️", label: "Love it", phrase: "Love this spot" },
  { emoji: "😊", label: "Happy", phrase: "Feeling happy here" },
  { emoji: "😂", label: "Funny", phrase: "Something funny just happened" },
  { emoji: "🥳", label: "Yay!", phrase: "I'm over the moon!" },
  { emoji: "😢", label: "Sad", phrase: "Feeling a bit down here" },
  { emoji: "🫣", label: "Awkward", phrase: "Awkward moment..." },
  { emoji: "😭", label: "Upset", phrase: "Really upset right now" },
];
// Hidden in list "All" / "All Street Notes" until their category is selected
const LIST_UTILITY_NOTE_EMOJIS = new Set(["💧", "🚽"]);
// User-reported facilities (toilets/fountains) — governed by the Public
// Facilities layer toggle alongside the preloaded City of Melbourne data.
const FACILITY_NOTE_EMOJIS = new Set(["💧", "🚻", "🚽"]);
function isFacilityNote(note) {
  return !!note && FACILITY_NOTE_EMOJIS.has(note.emoji);
}
let selectedNoteEmoji = null;
let lastAutofilledPhrase = null;
let noteDurationHours = 12;
let noteForever = false;

// ── Wizard state — Report Incident ───────────────────────────────────────
let reportWizardStep = 1;
let reportWizardData = {
  category: null,
  urgency: 'medium',
  description: '',
  photoDataUrl: null,
  identityMode: 'anonymous',
  email: '',
  phone: ''
};

// ── Wizard state — Community Discovery ───────────────────────────────────
let discoveryWizardStep = 1;
let discoveryWizardData = {
  emoji: null,
  label: '',
  questionAnswer: null,
  note: '',
  photoDataUrl: null
};
let discoveryLocationMap = null;
let discoveryLocationMarker = null;

function formatDurationText(hours) {
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  if (remH === 0) return `${days} day${days === 1 ? "" : "s"}`;
  return `${days}d ${remH}h`;
}

function formatRemainingTime(expiresAt) {
  if (!expiresAt) return "Permanent";
  const expiry = new Date(expiresAt).getTime();
  const diffMs = expiry - Date.now();
  if (diffMs <= 0) return "Expired";
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `expires in ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `expires in ${diffH}h`;
  const days = Math.floor(diffH / 24);
  const remH = diffH % 24;
  return remH === 0 ? `expires in ${days}d` : `expires in ${days}d ${remH}h`;
}

async function deleteStreetNoteById(noteId) {
  const res = await fetch(`${API_BASE}/admin/street-notes/${noteId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete street note");
}

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

// Category-tinted accent ring for street-note / discovery pins so each
// category reads instantly instead of as a generic coloured circle.
const streetNoteAccentMap = {
  "💧": "#38bdf8", // fountain — water blue
  "☕": "#b45309", // coffee — espresso brown
  "🧋": "#c026d3", // bubble tea — berry pink
  "🍩": "#ea580c", // dessert — warm donut orange
  "🚻": "#22c55e", // toilet — facility green
  "🚽": "#22c55e",
  "🎵": "#a855f7", // busker / music — purple
  "🔌": "#f59e0b", // charging — amber
  "🚧": "#f97316", // construction — hazard orange
  "📍": "#1E88E5", // other — brand blue
};
function streetNoteAccent(emoji) {
  return streetNoteAccentMap[emoji] || "#1E88E5";
}

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
  // Teardrop glass pin — emoji communicates the category, the coloured ring
  // and urgency dot signal severity (no flat generic coloured circle).
  const html = `
    <div class="map-pin map-pin-incident" style="--pin-accent:${color}">
      <span class="map-pin-emoji">${meta.emoji}</span>
    </div>`;

  const icon = L.divIcon({
    className: "map-pin-wrap",
    html,
    iconSize: [38, 46],
    iconAnchor: [19, 44],
    popupAnchor: [0, -40],
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
  // Reports layer off → no incident markers
  if (!showIncidents) return [];
  return incidents.filter((inc) => {
    const now = new Date();
    const ts = new Date(inc.timestamp);

    if (uiFilter.hours != null) {
      const cutoff = new Date(now.getTime() - uiFilter.hours * 60 * 60 * 1000);
      if (ts < cutoff) return false;
    }
    if (uiFilter.category && inc.category !== uiFilter.category) return false;
    if (uiFilter.urgency && inc.urgency !== uiFilter.urgency) return false;

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

function getListFilterState() {
  // Derived from the unified filter sheet + layer toggles
  const hours = uiFilter.hours;            // number | null
  const incidentCat = uiFilter.category;   // string | null
  const urgencyMode = uiFilter.urgency || ""; // 'high'|'medium'|'low'|''
  return {
    hours,
    urgencyMode,
    incidentCat,
    showIncidents,          // Reports layer
    showNotes: showStreetNotes, // Discoveries layer
    showFacilities: showPublicFacilities,
    noteEmoji: null,
  };
}

function filteredIncidentsForList() {
  const { hours, incidentCat, urgencyMode } = getListFilterState();
  if (!showIncidents) return [];
  return incidents.filter((inc) => {
    if (hours != null) {
      if (new Date(inc.timestamp) < new Date(Date.now() - hours * 3600000)) return false;
    }
    if (incidentCat && inc.category !== incidentCat) return false;
    if (urgencyMode && inc.urgency !== urgencyMode) return false;
    return true;
  });
}

function filteredNotesForList() {
  const { hours, showNotes, showFacilities, urgencyMode } = getListFilterState();
  // Notes have no urgency — hide them when an urgency filter is active
  if (urgencyMode) return [];
  return streetNotes.filter((note) => {
    // Facility notes follow the Public Facilities toggle; others the Discoveries toggle
    const visible = isFacilityNote(note) ? showFacilities : showNotes;
    if (!visible) return false;
    if (hours != null) {
      if (new Date(note.created_at) < new Date(Date.now() - hours * 3600000)) return false;
    }
    return true;
  });
}

function createMarkerClusterGroup(countClass) {
  return L.markerClusterGroup({
    maxClusterRadius: 48,
    disableClusteringAtZoom: 17,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    iconCreateFunction(cluster) {
      const count = cluster.getChildCount();
      const size = count < 10 ? 34 : count < 50 ? 40 : 46;
      return L.divIcon({
        html: `<span class="${countClass}">${count}</span>`,
        className: "map-cluster-icon",
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
    },
  });
}

function cityReferenceListTitle(note) {
  if (!note.isCityReference) return "Discovery";
  if (note.referenceType === "toilet") return "Public Toilet";
  return "Drinking Fountain";
}

function formatToiletAmenities(toilet) {
  const parts = [];
  if (toilet.female) parts.push("Female");
  if (toilet.male) parts.push("Male");
  if (toilet.wheelchair) parts.push("Accessible");
  if (toilet.babyChanging) parts.push("Baby change");
  return parts.join(" · ");
}

function buildToiletPopupHtml(toilet) {
  const amenities = formatToiletAmenities(toilet);
  const amenitiesHtml = amenities
    ? `<div style="font-size: 0.8rem; color: var(--ui-muted); margin-bottom: 0.5rem;">${amenities}</div>`
    : "";
  return `
    <div style="max-width: 240px; padding: 0.25rem;">
      <div style="font-size: 0.9375rem; color: var(--ui-text); line-height: 1.5; margin-bottom: 0.5rem;">${toilet.name}</div>
      ${amenitiesHtml}
      <div style="font-size: 0.75rem; color: var(--ui-muted);">Official · ${toilet.source || "City of Melbourne"}</div>
    </div>
  `;
}

function cityFountainToListItem(fountain) {
  return {
    id: fountain.id,
    emoji: fountain.emoji || "💧",
    text: fountain.description,
    latitude: fountain.lat,
    longitude: fountain.lng,
    location_text: "",
    created_at: null,
    forever: true,
    isCityReference: true,
    referenceType: "fountain",
    source: fountain.source || "City of Melbourne",
  };
}

function cityToiletToListItem(toilet) {
  const amenities = formatToiletAmenities(toilet);
  return {
    id: toilet.id,
    emoji: toilet.emoji || "🚽",
    text: toilet.name,
    latitude: toilet.lat,
    longitude: toilet.lng,
    location_text: amenities,
    created_at: null,
    forever: true,
    isCityReference: true,
    referenceType: "toilet",
    source: toilet.source || "City of Melbourne",
  };
}

function filteredCityFountainsForList() {
  const { urgencyMode, showFacilities } = getListFilterState();
  if (urgencyMode || !showFacilities || !showCityFountains) return [];
  return cityDrinkingFountains.map(cityFountainToListItem);
}

function filteredCityToiletsForList() {
  const { urgencyMode, showFacilities } = getListFilterState();
  if (urgencyMode || !showFacilities || !showCityToilets) return [];
  return cityPublicToilets.map(cityToiletToListItem);
}

function renderList() {
  const container = document.getElementById("incident-list");
  container.innerHTML = "";
  const items = filteredIncidentsForList().sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );
  const noteItems = [
    ...filteredNotesForList(),
    ...filteredCityFountainsForList(),
    ...filteredCityToiletsForList(),
  ].sort((a, b) => {
    if (a.isCityReference && !b.isCityReference) return 1;
    if (!a.isCityReference && b.isCityReference) return -1;
    if (a.isCityReference && b.isCityReference) {
      return (a.text || "").localeCompare(b.text || "");
    }
    return new Date(b.created_at) - new Date(a.created_at);
  });

  if (!items.length && !noteItems.length) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = "No results match the selected filters.";
    container.appendChild(empty);
    return;
  }

  // Single frosted "results sheet" — every report is a row with a divider.
  const sheet = document.createElement("div");
  sheet.className = "list-sheet";
  const cap = (s) => (s || "").charAt(0).toUpperCase() + (s || "").slice(1);

  items.forEach((inc) => {
    const meta = categoryMeta[inc.category] || categoryMeta.other;
    const chipClass = { high: "chip-high", medium: "chip-medium", low: "chip-low" }[inc.urgency] || "chip-low";

    const row = document.createElement("button");
    row.type = "button";
    row.className = "list-row";
    row.innerHTML = `
      <span class="list-row-icon">${meta.emoji}</span>
      <span class="list-row-main">
        <span class="list-row-title">${meta.label}</span>
        <span class="list-row-sub"><span data-incident-id="${inc.id}">Loading…</span></span>
        <span class="list-row-meta">${humanTimeAgo(inc.timestamp)}${inc.is_verified ? " · ✓ Verified" : ""}${inc.cluster_count && inc.cluster_count > 1 ? ` · 👥 ${inc.cluster_count}` : ""}</span>
      </span>
      <span class="list-row-end">
        <span class="list-chip ${chipClass}">${cap(inc.urgency)}</span>
        <span class="list-row-chevron" aria-hidden="true">›</span>
      </span>
    `;

    reverseGeocode(inc.latitude, inc.longitude).then(locationDesc => {
      const locEl = row.querySelector(`[data-incident-id="${inc.id}"]`);
      if (locEl) locEl.textContent = locationDesc || `${inc.latitude.toFixed(4)}, ${inc.longitude.toFixed(4)}`;
    });

    row.addEventListener("click", () => {
      activateView("map");
      if (map) {
        map.setView([inc.latitude, inc.longitude], 17);
        setTimeout(() => { map.invalidateSize(); openDetailModal(inc); }, 300);
      } else {
        openDetailModal(inc);
      }
    });

    sheet.appendChild(row);
  });

  // ── Discovery / Street Note rows ───────────────────────────────────────
  noteItems.forEach((note) => {
    const isForeverNote = note.forever || !note.expires_at;
    const timeText = note.isCityReference
      ? `Official · ${note.source || "City of Melbourne"}`
      : humanTimeAgo(note.created_at);
    const locText = note.location_text || `${Number(note.latitude).toFixed(4)}, ${Number(note.longitude).toFixed(4)}`;
    const chip = note.isCityReference
      ? `<span class="list-chip chip-official">Official</span>`
      : `<span class="list-chip chip-note">Discovery</span>`;

    const row = document.createElement("button");
    row.type = "button";
    row.className = "list-row";
    row.innerHTML = `
      <span class="list-row-icon">${note.emoji || '📝'}</span>
      <span class="list-row-main">
        <span class="list-row-title">${cityReferenceListTitle(note)}</span>
        <span class="list-row-sub">${note.text || locText}</span>
        <span class="list-row-meta">${timeText}</span>
      </span>
      <span class="list-row-end">
        ${chip}
        <span class="list-row-chevron" aria-hidden="true">›</span>
      </span>
    `;

    row.addEventListener("click", () => {
      activateView("map");
      if (map) {
        map.setView([note.latitude, note.longitude], 17);
        setTimeout(() => {
          map.invalidateSize();
          const imageHtml = note.image_url
            ? `<div style="margin-bottom:0.5rem"><img src="${note.image_url}" alt="Discovery photo" style="display:block;width:100%;max-width:220px;max-height:150px;object-fit:cover;border-radius:6px" /></div>` : "";
          const expText = isForeverNote ? "Permanent" : formatRemainingTime(note.expires_at);
          const metaHtml = note.isCityReference
            ? `<div style="font-size:0.75rem;color:var(--ui-muted)">Official · ${note.source || "City of Melbourne"}</div>`
            : `<div style="font-size:0.75rem;color:var(--ui-muted)">${humanTimeAgo(note.created_at)} · ${expText}</div>`;
          L.popup()
            .setLatLng([note.latitude, note.longitude])
            .setContent(`<div style="max-width:240px;padding:0.25rem">${imageHtml}<div style="font-size:0.9375rem;line-height:1.5;margin-bottom:0.5rem">${note.text}</div>${metaHtml}</div>`)
            .openOn(map);
        }, 300);
      }
    });

    // Admin delete (inline, doesn't trigger row navigation)
    if (isAdminLoggedIn && !note.isCityReference) {
      const delBtn = document.createElement("button");
      delBtn.className = "list-row-delete";
      delBtn.type = "button";
      delBtn.textContent = "🗑️";
      delBtn.title = "Delete discovery";
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm("Delete this discovery?")) return;
        try { await deleteStreetNoteById(note.id); await fetchStreetNotes(); }
        catch (err) { alert("Failed to delete."); }
      });
      row.querySelector(".list-row-end").prepend(delBtn);
    }

    sheet.appendChild(row);
  });

  container.appendChild(sheet);
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
  const detailBody = document.getElementById("detail-body");

  const tsText = humanTimeAgo(incident.timestamp);
  const credibility = incident.is_verified ? "Verified" : "Unverified";
  const likeCount = incident.like_count || 0;
  const userReaction = userReactions.get(incident.id);
  const sawItActive = userReaction === "like" ? "active-reaction" : "";

  const urgencyStatusClass = {
    high: 'detail-status-high', medium: 'detail-status-medium', low: 'detail-status-low'
  }[incident.urgency] || 'detail-status-low';
  const urgencyDot = { high: '🔴', medium: '🟡', low: '🟢' }[incident.urgency] || '⚪';
  const urgencyLabel = incident.urgency.charAt(0).toUpperCase() + incident.urgency.slice(1);

  const clusterHtml = (incident.cluster_count && incident.cluster_count > 1)
    ? `<div class="detail-card-confirmed"><span>👥</span> Confirmed by ${incident.cluster_count} similar reports nearby</div>` : '';

  const descHtml = incident.description
    ? `<div class="detail-card-description">${incident.description}</div>` : '';

  const photoHtml = incident.image_url
    ? `<img class="detail-card-photo" src="${incident.image_url}" alt="Reported photo" />` : '';

  const credHtml = `<div class="detail-card-confidence"><span>⚠️</span> ${urgencyLabel} Urgency · ${credibility} report</div>`;

  detailBody.innerHTML = `
    <div class="detail-card-body">
      <div class="detail-card-category">
        <span class="detail-card-emoji">${meta.emoji}</span>
        <div>
          <h3 class="detail-card-title">${meta.label}</h3>
        </div>
      </div>
      ${photoHtml}
      <span class="detail-card-status ${urgencyStatusClass}">${urgencyDot} ${urgencyLabel} Urgency</span>
      <div class="detail-card-meta">
        <div class="detail-meta-row">
          <span class="detail-meta-icon">🕐</span>
          <span>Reported ${tsText}</span>
        </div>
        <div class="detail-meta-row" id="detail-location-row">
          <span class="detail-meta-icon">📍</span>
          <span id="detail-location-text">Loading location…</span>
        </div>
      </div>
      ${descHtml}
      ${credHtml}
      ${clusterHtml}
      <div class="detail-card-actions">
        <button id="detail-like-btn" class="detail-action-btn primary ${sawItActive}" type="button">
          👥 I Saw This Too <span id="detail-like-count">${likeCount > 0 ? `(${likeCount})` : ''}</span>
        </button>
        <button id="detail-dislike-btn" class="detail-action-btn" type="button">
          👎 Dislike
        </button>
      </div>
    </div>
  `;

  // Async: load location text
  reverseGeocode(incident.latitude, incident.longitude).then(desc => {
    const locEl = document.getElementById("detail-location-text");
    if (locEl && desc) locEl.textContent = desc;
  });

  // Reaction buttons
  const likeBtn = document.getElementById("detail-like-btn");
  const dislikeBtn = document.getElementById("detail-dislike-btn");

  if (userReaction) {
    if (likeBtn) likeBtn.disabled = true;
    if (dislikeBtn) dislikeBtn.disabled = true;
  }

  if (likeBtn) {
    likeBtn.addEventListener("click", async () => {
      if (likeBtn.disabled) return;
      likeBtn.disabled = true;
      if (dislikeBtn) dislikeBtn.disabled = true;
      await reactToIncident(incident.id, "like");
      likeBtn.classList.add("active-reaction");
      const countEl = document.getElementById("detail-like-count");
      if (countEl) countEl.textContent = `(${(incident.like_count || 0) + 1})`;
    });
  }

  if (dislikeBtn) {
    dislikeBtn.addEventListener("click", async () => {
      if (dislikeBtn.disabled) return;
      dislikeBtn.disabled = true;
      if (likeBtn) likeBtn.disabled = true;
      await reactToIncident(incident.id, "dislike");
      dislikeBtn.classList.add("active-reaction");
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
  const agreementChecked = document.getElementById("agreement-checkbox").checked;
  if (!agreementChecked) {
    alert("Please confirm the agreement before submitting.");
    return;
  }
  if (!locationMarker) {
    alert("Please set a location in step 2.");
    return;
  }

  const email = document.getElementById("contact-email") ? document.getElementById("contact-email").value.trim() : '';
  const phone = document.getElementById("contact-phone") ? document.getElementById("contact-phone").value.trim() : '';

  if (reportWizardData.identityMode === "verified" && !email && !phone) {
    alert("Please provide at least an email or phone number, or choose anonymous.");
    return;
  }

  const { lat, lng } = locationMarker.getLatLng();
  const payload = {
    category: reportWizardData.category || 'other',
    urgency: reportWizardData.urgency || 'medium',
    description: reportWizardData.description || '',
    image_url: reportWizardData.photoDataUrl || '',
    latitude: lat,
    longitude: lng,
  };

  if (reportWizardData.identityMode === "verified") {
    if (email) payload.contact_email = email;
    if (phone) payload.contact_phone = phone;
  }

  const submitBtn = document.getElementById("submit-report");
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting…'; }

  try {
    const res = await fetch(`${API_BASE}/incidents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Failed to submit report");
    await fetchIncidents();
    closeReportModal();
    // Brief success toast
    showToast('✅ Incident reported — thank you!');
  } catch (e) {
    console.error(e);
    alert("There was a problem submitting your report. Please try again.");
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit Report'; }
  }
}

// Simple toast notification
function showToast(message, duration = 3000) {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.style.cssText = 'position:fixed;bottom:calc(env(safe-area-inset-bottom,0px) + 10rem);left:50%;transform:translateX(-50%);background:rgba(20,30,48,0.95);color:#fff;padding:0.625rem 1.25rem;border-radius:20px;font-size:0.875rem;font-weight:600;z-index:9999;backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.12);box-shadow:0 4px 20px rgba(0,0,0,0.4);pointer-events:none;transition:opacity 0.3s;white-space:nowrap;';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, duration);
}

function getActiveChipValue(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return null;
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
  reportWizardStep = 1;
  reportWizardData = { category: null, urgency: 'medium', description: '', photoDataUrl: null, identityMode: 'anonymous', email: '', phone: '' };

  // Reset all step visibility
  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById(`report-step-${i}`);
    if (el) { el.style.display = i === 1 ? '' : 'none'; }
  }

  // Reset photo
  const photoPreview = document.getElementById('report-photo-preview');
  const photoPlaceholder = document.getElementById('report-photo-placeholder');
  const photoRemove = document.getElementById('report-photo-remove');
  const photoInput = document.getElementById('report-photo-input');
  if (photoPreview) { photoPreview.style.display = 'none'; photoPreview.src = ''; }
  if (photoPlaceholder) photoPlaceholder.style.display = '';
  if (photoRemove) photoRemove.style.display = 'none';
  if (photoInput) photoInput.value = '';

  // Reset textarea
  const descInput = document.getElementById('description-input');
  if (descInput) descInput.value = '';
  const descCount = document.getElementById('desc-char-count');
  if (descCount) descCount.textContent = '0';

  // Reset urgency
  document.querySelectorAll('#urgency-selector .urg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === 'medium');
  });

  // Reset verification
  const anonBtn = document.getElementById('verify-anon-btn');
  const verifiedBtn = document.getElementById('verify-verified-btn');
  const anonCheck = document.getElementById('verify-anon-check');
  const verifiedCheck = document.getElementById('verify-verified-check');
  const contactFields = document.getElementById('contact-fields');
  if (anonBtn) anonBtn.classList.add('active');
  if (verifiedBtn) verifiedBtn.classList.remove('active');
  if (anonCheck) anonCheck.classList.remove('verify-check-hidden');
  if (verifiedCheck) verifiedCheck.classList.add('verify-check-hidden');
  if (contactFields) contactFields.style.display = 'none';

  // Reset agreement checkbox
  const agreeCheck = document.getElementById('agreement-checkbox');
  if (agreeCheck) agreeCheck.checked = false;

  // Reset review card
  const reviewCard = document.getElementById('report-review-card');
  if (reviewCard) reviewCard.innerHTML = '';

  // Update step dots and back button
  updateReportStepDots();
  updateReportBackBtn();

  const modal = document.getElementById("report-modal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  setTimeout(() => { if (locationMap) locationMap.invalidateSize(); }, 300);
}

function closeReportModal() {
  const modal = document.getElementById("report-modal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function updateReportStepDots() {
  const dotsEl = document.getElementById('report-step-dots');
  if (!dotsEl) return;
  const dots = dotsEl.querySelectorAll('.wdot');
  dots.forEach((dot, i) => dot.classList.toggle('active', i === reportWizardStep - 1));
}

function updateReportBackBtn() {
  const btn = document.getElementById('report-back-btn');
  if (btn) btn.style.visibility = reportWizardStep > 1 ? 'visible' : 'hidden';
}

function goToReportStep(step) {
  const current = document.getElementById(`report-step-${reportWizardStep}`);
  if (current) current.style.display = 'none';
  reportWizardStep = step;
  const next = document.getElementById(`report-step-${reportWizardStep}`);
  if (next) next.style.display = '';
  updateReportStepDots();
  updateReportBackBtn();
  // Refresh location map when arriving at step 2
  if (step === 2) { setTimeout(() => { if (locationMap) locationMap.invalidateSize(); }, 200); }
  // Populate review card when arriving at step 5
  if (step === 5) buildReportReviewCard();
}

function buildReportReviewCard() {
  const reviewCard = document.getElementById('report-review-card');
  if (!reviewCard) return;
  const meta = categoryMeta[reportWizardData.category] || categoryMeta.other;
  const urgencyLabel = reportWizardData.urgency.charAt(0).toUpperCase() + reportWizardData.urgency.slice(1);
  const urgencyColors = { low: '#4ade80', medium: '#facc15', high: '#f97373' };
  const uc = urgencyColors[reportWizardData.urgency] || '#e5e7eb';
  const location = locationMarker ? (() => {
    const ll = locationMarker.getLatLng();
    return `${ll.lat.toFixed(4)}, ${ll.lng.toFixed(4)}`;
  })() : 'Not set';

  reviewCard.innerHTML = `
    <div class="review-row">
      <span class="review-row-icon">${meta.emoji}</span>
      <span class="review-row-label">Category</span>
      <span>${meta.label}</span>
    </div>
    <div class="review-row">
      <span class="review-row-icon" style="color:${uc}">●</span>
      <span class="review-row-label">Urgency</span>
      <span>${urgencyLabel}</span>
    </div>
    <div class="review-row">
      <span class="review-row-icon">📍</span>
      <span class="review-row-label">Location</span>
      <span style="font-size:0.8rem">${location}</span>
    </div>
    ${reportWizardData.description ? `
    <div class="review-row">
      <span class="review-row-icon">📝</span>
      <span class="review-row-label">Description</span>
      <span style="font-size:0.8rem">${reportWizardData.description.substring(0, 80)}${reportWizardData.description.length > 80 ? '…' : ''}</span>
    </div>` : ''}
    <div class="review-row">
      <span class="review-row-icon">🔒</span>
      <span class="review-row-label">Identity</span>
      <span>${reportWizardData.identityMode === 'anonymous' ? 'Anonymous' : 'Verified'}</span>
    </div>
  `;

  // If we have a real address, update asynchronously
  if (locationMarker) {
    const ll = locationMarker.getLatLng();
    reverseGeocode(ll.lat, ll.lng).then(desc => {
      const locRow = reviewCard.querySelector('.review-row:nth-child(3) span:last-child');
      if (locRow) locRow.textContent = desc || location;
    });
  }
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
      liveUpdatesContent = data.content || "Reports refresh every 6 h · Pick an emoji avatar to appear on the map · Tap the badge to chat";
      displayLiveUpdates();
    }
  } catch (error) {
    console.error("Failed to fetch live updates:", error);
    // Use default content
    liveUpdatesContent = "Reports refresh every 6 h · Pick an emoji avatar to appear on the map · Tap the badge to chat";
    displayLiveUpdates();
  }
}

function displayLiveUpdates() {
  const updatesText = document.getElementById("updates-text");
  if (updatesText) updatesText.textContent = liveUpdatesContent;

  startTickerScrolling(".updates-scroll-container", "#updates-text");

  const chatModal = document.getElementById("chat-modal");
  if (chatModal && !chatModal.classList.contains("hidden")) {
    renderChatMessages();
  }
}

function startTickerScrolling(containerSelector, textSelector) {
  const scrollContainer = document.querySelector(containerSelector);
  const updatesText = document.querySelector(textSelector);
  if (!scrollContainer || !updatesText) return;

  updatesText.style.display = "inline-block";

  setTimeout(() => {
    const containerWidth = scrollContainer.offsetWidth;
    const textWidth = updatesText.scrollWidth;

    if (textWidth <= containerWidth) {
      updatesText.style.animation = "none";
      updatesText.style.transform = "translateX(0)";
    } else {
      updatesText.style.animation = "scroll-text 30s linear infinite";
      updatesText.style.transform = "";
    }
  }, 100);
}

function startLiveUpdatesScrolling() {
  startTickerScrolling(".updates-scroll-container", "#updates-text");
}

async function updateActiveUsersCount() {
  const onlineText = document.getElementById("online-count-text");
  const legacyText = document.getElementById("active-users-text");
  const setText = (count) => {
    const label = `${count} online`;
    if (onlineText) onlineText.textContent = label;
    if (legacyText) {
      legacyText.textContent =
        count === 1 ? "1 person active on the map, tap to chat"
                    : `${count} people active on the map, tap to chat`;
    }
  };

  try {
    const sessionId = getOrCreateSessionId();
    const response = await fetch(`${API_BASE}/users/heartbeat/${sessionId}`, {
      method: "POST"
    });

    if (response.ok) {
      const data = await response.json();
      setText(data.active_count || 0);
    } else {
      setText(0);
    }
  } catch (error) {
    console.error("Failed to update active users count:", error);
    setText(0);
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
      await renderAdminStreetNotesSection(dashboard);
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

    // Add Street Notes section (after incidents and highlights)
    await renderAdminStreetNotesSection(dashboard);
    
    adminBody.innerHTML = "";
    adminBody.appendChild(dashboard);
  } catch (e) {
    console.error("Admin dashboard error:", e);
    adminBody.innerHTML = `
      <div class='error-text'>
        <p>Unable to load incidents for admin.</p>
        <p style="font-size: 0.875rem; color: var(--ui-muted); margin-top: 0.5rem;">
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
    highlightsSection.style.cssText = "margin-top: 2rem; padding-top: 2rem; border-top: 2px solid var(--ui-border);";
    
    const sectionHeader = document.createElement("div");
    sectionHeader.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;";
    
    const sectionTitle = document.createElement("h2");
    sectionTitle.textContent = "Street Highlights";
    sectionTitle.style.cssText = "font-size: 1.25rem; font-weight: 600; color: var(--ui-text); margin: 0;";
    
    const highlightsCount = document.createElement("div");
    highlightsCount.textContent = `${highlights.length} Highlight${highlights.length !== 1 ? 's' : ''}`;
    highlightsCount.style.cssText = "font-size: 0.875rem; color: var(--ui-muted);";
    
    sectionHeader.appendChild(sectionTitle);
    sectionHeader.appendChild(highlightsCount);
    highlightsSection.appendChild(sectionHeader);
    
    if (highlights.length === 0) {
      const emptyMsg = document.createElement("div");
      emptyMsg.textContent = "No street highlights yet. Click 'Highlight a Street' to create one.";
      emptyMsg.style.cssText = "text-align: center; padding: 2rem; color: var(--ui-muted);";
      highlightsSection.appendChild(emptyMsg);
    } else {
      const highlightsList = document.createElement("div");
      highlightsList.style.cssText = "display: flex; flex-direction: column; gap: 0.75rem;";
      
      highlights.forEach((highlight) => {
        const highlightCard = document.createElement("div");
        highlightCard.style.cssText = "background: var(--ui-panel); border: 1px solid var(--ui-border); border-radius: 8px; padding: 1rem;";
        
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
              <div style="font-weight: 600; color: var(--ui-text); margin-bottom: 0.25rem;">${reasonLabels[highlight.reason] || highlight.reason}</div>
              <div style="font-size: 0.875rem; color: var(--ui-muted);">${colorLabels[highlight.color] || highlight.color}</div>
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
          ${highlight.description ? `<div style="font-size: 0.875rem; color: var(--ui-soft); margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--ui-border);">${highlight.description}</div>` : ''}
          <div style="font-size: 0.75rem; color: var(--ui-muted); margin-top: 0.5rem;">
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

async function renderAdminStreetNotesSection(dashboard) {
  try {
    const res = await fetch(`${API_BASE}/street-notes`);
    if (!res.ok) return;
    const notes = await res.json();

    const section = document.createElement("div");
    section.className = "admin-notes-section";
    section.style.cssText = "margin-top: 2rem; padding-top: 2rem; border-top: 2px solid var(--ui-border);";

    const header = document.createElement("div");
    header.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;";

    const title = document.createElement("h2");
    title.textContent = "Community Discoveries";
    title.style.cssText = "font-size: 1.25rem; font-weight: 600; color: var(--ui-text); margin: 0;";

    const foreverCount = notes.filter(n => n.forever || !n.expires_at).length;
    const count = document.createElement("div");
    count.textContent = `${notes.length} discover${notes.length !== 1 ? "ies" : "y"}${foreverCount ? ` (${foreverCount} permanent)` : ""}`;
    count.style.cssText = "font-size: 0.875rem; color: var(--ui-muted);";

    header.appendChild(title);
    header.appendChild(count);
    section.appendChild(header);

    if (!notes.length) {
      const empty = document.createElement("div");
      empty.textContent = "No discoveries posted.";
      empty.style.cssText = "font-size: 0.875rem; color: var(--ui-muted); padding: 1rem; text-align: center; background: var(--ui-panel); border-radius: 8px;";
      section.appendChild(empty);
      dashboard.appendChild(section);
      return;
    }

    const list = document.createElement("div");
    list.className = "admin-notes-list";
    list.style.cssText = "display: flex; flex-direction: column; gap: 0.75rem;";

    notes.forEach((note) => {
      const isForeverN = note.forever || !note.expires_at;
      const expText = isForeverN ? "Permanent" : formatRemainingTime(note.expires_at);
      const emojiIcon = note.emoji || "📝";
      const imgHtml = note.image_url
        ? `<img src="${note.image_url}" style="max-width:120px;max-height:80px;object-fit:cover;border-radius:6px;margin-top:0.5rem;border:1px solid var(--ui-border);" />`
        : "";
      const locHtml = note.location_text
        ? `<div style="font-size:0.75rem;color:var(--ui-muted);">📍 ${note.location_text}</div>`
        : "";
      const badge = isForeverN ? '<span class="note-permanent-badge">PERMANENT</span>' : '';

      const card = document.createElement("div");
      card.style.cssText = "background: var(--ui-surface-strong); border: 1px solid var(--ui-border); border-left: 4px solid #1E88E5; border-radius: 8px; padding: 0.875rem;";
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem;">
              <span style="font-size:1.25rem;">${emojiIcon}</span>
              <strong style="font-size:0.9rem;color:var(--ui-text);">Discovery</strong>
              ${badge}
            </div>
            <div style="font-size:0.875rem;color:var(--ui-soft);margin-bottom:0.25rem;">${note.text}</div>
            ${locHtml}
            <div style="font-size:0.7rem;color:var(--ui-muted);margin-top:0.25rem;">${humanTimeAgo(note.created_at)} • ${expText}</div>
            ${imgHtml}
          </div>
          <button type="button" class="admin-delete-note-btn" data-note-id="${note.id}" style="background:#ef4444;color:#fff;border:none;border-radius:6px;padding:0.375rem 0.75rem;font-size:0.75rem;font-weight:600;cursor:pointer;flex-shrink:0;">
            Delete
          </button>
        </div>
      `;
      list.appendChild(card);
    });

    section.appendChild(list);

    list.querySelectorAll(".admin-delete-note-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this discovery?")) return;
        try {
          await deleteStreetNoteById(btn.dataset.noteId);
          await fetchStreetNotes();
          await renderAdminDashboard();
        } catch (e) {
          alert("Failed to delete note.");
        }
      });
    });

    dashboard.appendChild(section);
  } catch (e) {
    console.error("Failed to load admin street notes:", e);
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
      // Refresh public views so admin delete buttons appear on notes
      renderList();
      renderStreetNotes();
    } catch (err) {
      errorEl.textContent = "Invalid account or PIN.";
    }
  });
}

function initAdminModal() {
  const adminModal = document.getElementById("admin-modal");
  const adminBody  = document.getElementById("admin-body");
  if (adminBody && !adminLoginTemplate) adminLoginTemplate = adminBody.innerHTML;

  // 10-tap Easter egg on the M logo box
  const logoBox = document.querySelector(".mhc-logo");
  if (logoBox) {
    let tapCount = 0;
    let tapTimer = null;
    logoBox.addEventListener("click", () => {
      tapCount++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { tapCount = 0; }, 1500);
      if (tapCount >= 10) {
        tapCount = 0;
        adminModal.classList.remove("hidden");
        adminModal.setAttribute("aria-hidden", "false");
        if (!isAdminLoggedIn) setupAdminLoginForm();
      }
    });
  }
}

// ── Peer location broadcasting ────────────────────────────────────────────────
// Peers are stored in MongoDB via /api/peers.
// Each client POSTs its own location every 20 s; GET returns all live peers.
// localStorage is used only as a render cache so markers survive a brief
// network hiccup between poll cycles.

const PEERS_KEY = "communityMapPeers_v1";

function getPeerStore() {
  try { return JSON.parse(localStorage.getItem(PEERS_KEY) || "{}"); } catch { return {}; }
}
function savePeerStore(store) {
  try { localStorage.setItem(PEERS_KEY, JSON.stringify(store)); } catch {}
}

async function broadcastOwnLocation() {
  if (avatar.emoji === "🚫" || !userLocation) return;
  const payload = {
    id: getChatUserId(),
    emoji: avatar.emoji,
    title: avatar.title || "Anonymous",
    lat: userLocation.lat,
    lng: userLocation.lng,
    ts: Date.now(),
  };
  try {
    await fetch(`${API_BASE}/peers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (_) {}
  // Also update local cache so own marker is instant
  const store = getPeerStore();
  store[payload.id] = payload;
  savePeerStore(store);
  renderPeerMarkers();
}

async function fetchPeers() {
  try {
    const res = await fetch(`${API_BASE}/peers`);
    if (res.ok) {
      const remote = await res.json();
      if (Array.isArray(remote)) {
        // Replace local cache with fresh server data
        const store = {};
        remote.forEach(p => { store[p.id] = p; });
        savePeerStore(store);
      }
    }
  } catch (_) {}
  renderPeerMarkers();
}

function renderPeerMarkers() {
  if (!peerLayer || !map) return;
  peerLayer.clearLayers();
  const now = Date.now();
  const store = getPeerStore();
  const myId = getChatUserId();
  Object.values(store).forEach(peer => {
    if (now - peer.ts > PEER_TTL_MS) return; // stale fallback guard
    const isMe = peer.id === myId;
    const icon = L.divIcon({
      html: `<div class="peer-emoji-marker${isMe ? " peer-self" : ""}" title="${peer.title}">${peer.emoji}</div>`,
      className: "",
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
    const marker = L.marker([peer.lat, peer.lng], { icon, zIndexOffset: isMe ? 1000 : 500 });
    const label = isMe ? `${peer.title} <span class="peer-popup-you">(you)</span>` : peer.title;
    marker.bindPopup(`<div class="peer-popup"><span class="peer-popup-emoji">${peer.emoji}</span><strong>${label}</strong></div>`, { maxWidth: 180 });
    peerLayer.addLayer(marker);
  });
}

async function removeSelfFromPeers() {
  // Called when user switches back to 🚫 — removes own marker from server
  try {
    await fetch(`${API_BASE}/peers/${getChatUserId()}`, { method: "DELETE" });
  } catch (_) {}
  const store = getPeerStore();
  delete store[getChatUserId()];
  savePeerStore(store);
  renderPeerMarkers();
}

function updateOwnMapMarker() {
  if (avatar.emoji === "🚫") {
    removeSelfFromPeers();
    return;
  }
  broadcastOwnLocation();
}

function initPeerBroadcasting() {
  peerLocationInterval = setInterval(() => {
    broadcastOwnLocation();
    fetchPeers();
  }, 20000);
  fetchPeers(); // initial load of other users
}
// ─────────────────────────────────────────────────────────────────────────────

function initAvatarPicker() {
  applyAvatarToUI();

  const pickerOverlay = document.getElementById("avatar-picker-overlay");
  const nameOverlay   = document.getElementById("avatar-name-overlay");
  const avatarBtn     = document.getElementById("avatar-btn");
  const pickerClose   = document.getElementById("avatar-picker-close");
  const nameClose     = document.getElementById("avatar-name-close");
  const nameConfirm   = document.getElementById("avatar-name-confirm");
  const nameInput     = document.getElementById("avatar-name-input");
  const nameTitle     = document.getElementById("avatar-name-title");
  const clearBtn      = document.getElementById("avatar-clear-btn");

  let pendingEmoji = null;

  function openPicker() {
    pickerOverlay.classList.remove("hidden");
    pickerOverlay.setAttribute("aria-hidden", "false");
  }
  function closePicker() {
    pickerOverlay.classList.add("hidden");
    pickerOverlay.setAttribute("aria-hidden", "true");
  }
  function openNameSheet(emoji) {
    pendingEmoji = emoji;
    if (nameTitle) nameTitle.textContent = `What should we call you? ${emoji}`;
    nameInput.value = avatar.title || "";
    nameOverlay.classList.remove("hidden");
    nameOverlay.setAttribute("aria-hidden", "false");
    setTimeout(() => nameInput.focus(), 120);
  }
  function closeNameSheet() {
    nameOverlay.classList.add("hidden");
    nameOverlay.setAttribute("aria-hidden", "true");
  }

  if (avatarBtn) avatarBtn.addEventListener("click", openPicker);
  if (pickerClose) pickerClose.addEventListener("click", closePicker);
  if (pickerOverlay) pickerOverlay.addEventListener("click", e => { if (e.target === pickerOverlay) closePicker(); });

  document.querySelectorAll(".avatar-emoji-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const emoji = btn.dataset.emoji;
      closePicker();
      if (emoji === "🚫") {
        avatar.emoji = "🚫";
        avatar.title = "";
        saveAvatar();
        applyAvatarToUI();
        updateOwnMapMarker();
      } else {
        openNameSheet(emoji);
      }
    });
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      avatar.emoji = "🚫";
      avatar.title = "";
      saveAvatar();
      applyAvatarToUI();
      updateOwnMapMarker();
      closePicker();
    });
  }

  if (nameClose)   nameClose.addEventListener("click", closeNameSheet);
  if (nameOverlay) nameOverlay.addEventListener("click", e => { if (e.target === nameOverlay) closeNameSheet(); });

  if (nameConfirm) {
    nameConfirm.addEventListener("click", () => {
      const rawName = nameInput.value.trim();
      avatar.emoji = pendingEmoji;
      avatar.title = rawName || randomAnimalName();
      saveAvatar();
      applyAvatarToUI();
      closeNameSheet();
      updateOwnMapMarker();
    });
  }
  if (nameInput) {
    nameInput.addEventListener("keypress", e => {
      if (e.key === "Enter") nameConfirm && nameConfirm.click();
    });
  }
}

function initViewControls() {
  // Map → List entry (bottom-left "List" button)
  const listToggleBtn = document.getElementById("list-toggle-btn");
  if (listToggleBtn) listToggleBtn.addEventListener("click", () => activateView("list"));

  // List view: back arrow + segmented Map/List toggle
  const listBack = document.getElementById("list-back");
  if (listBack) listBack.addEventListener("click", () => activateView("map"));
  const segMap = document.getElementById("seg-map");
  if (segMap) segMap.addEventListener("click", () => activateView("map"));
  const segList = document.getElementById("seg-list");
  if (segList) segList.addEventListener("click", () => activateView("list"));
}

function initViewToggle_LEGACY_UNUSED() {
  const mapTab  = document.getElementById("tab-map");
  const listTab = document.getElementById("tab-list");
  const mapView  = document.getElementById("view-map");
  const listView = document.getElementById("view-list");

  // Map is "left", List is "right" conceptually
  let currentView = "map";

  function clearSlideClasses(el) {
    el.classList.remove("slide-from-left", "slide-from-right");
  }

  function activate(tab) {
    if (tab === currentView) return;
    const goingRight = tab === "list"; // map → list = slide in from right

    if (tab === "map") {
      mapTab.classList.add("active");
      listTab.classList.remove("active");
      clearSlideClasses(mapView);
      mapView.classList.add("active", "slide-from-left");
      listView.classList.remove("active");
      if (map) setTimeout(() => map.invalidateSize(), 100);
    } else {
      listTab.classList.add("active");
      mapTab.classList.remove("active");
      clearSlideClasses(listView);
      listView.classList.add("active", "slide-from-right");
      mapView.classList.remove("active");
    }

    // Remove animation class after it plays so re-triggering works
    const animated = tab === "map" ? mapView : listView;
    animated.addEventListener("animationend", () => clearSlideClasses(animated), { once: true });
    currentView = tab;
  }

  mapTab.addEventListener("click",  () => activate("map"));
  listTab.addEventListener("click", () => activate("list"));
}

function initMap() {
  map = L.map("map").setView(
    [MELBOURNE_CBD.lat, MELBOURNE_CBD.lng],
    MELBOURNE_CBD.zoom
  );
  map.attributionControl.setPrefix(false);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    subdomains: "abcd",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
  }).addTo(map);
  mainMarkersLayer = createMarkerClusterGroup("incident-cluster-count").addTo(map);
  adminHighlightsLayer = L.layerGroup().addTo(map);
  cityFountainsLayer = createMarkerClusterGroup("fountain-cluster-count").addTo(map);
  cityToiletsLayer = createMarkerClusterGroup("toilet-cluster-count").addTo(map);
  streetNotesLayer = createMarkerClusterGroup("note-cluster-count").addTo(map);
  peerLayer = L.layerGroup().addTo(map);
  
  // Layer toggles now live in the Layers bottom sheet (no map control)
  // Locate button is a floating HTML control (see initLocateButton)
  
  // Load and render admin street highlights
  fetchAdminStreetHighlights();
  
  // Official City of Melbourne drinking fountains & public toilets
  loadCityDrinkingFountains();
  loadCityPublicToilets();

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

  if (!showHighlights) return;

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
        <div style="font-weight: 600; margin-bottom: 0.5rem; color: var(--ui-text);">${reasonText}</div>
        <div style="font-size: 0.875rem; color: var(--ui-soft); line-height: 1.5;">${description}</div>
        <div style="font-size: 0.75rem; color: var(--ui-muted); margin-top: 0.5rem;">
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
    div.style.cssText = "padding: 0.375rem 0.5rem; font-size: 0.6875rem; line-height: 1.3; min-width: 140px; max-width: 160px; z-index: 1000;";
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
      <div class="map-popup__divider">
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
  locationMap.attributionControl.setPrefix(false);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    subdomains: "abcd",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
  }).addTo(locationMap);

  locationMap.on("click", (e) => {
    setLocationMarker(e.latlng.lat, e.latlng.lng);
  });
}

// ── Filter bottom sheet ──────────────────────────────────────────────────────
function openFilterSheet() {
  const overlay = document.getElementById("filter-sheet-overlay");
  if (overlay) { overlay.classList.remove("hidden"); overlay.setAttribute("aria-hidden", "false"); }
}
function closeFilterSheet() {
  const overlay = document.getElementById("filter-sheet-overlay");
  if (overlay) { overlay.classList.add("hidden"); overlay.setAttribute("aria-hidden", "true"); }
}

function setActivePill(rowId, value) {
  const row = document.getElementById(rowId);
  if (!row) return;
  row.querySelectorAll(".filter-pill").forEach((pill) => {
    pill.classList.toggle("active", pill.dataset.value === value);
  });
}

function applyUiFilter() {
  renderMapMarkers();
  renderList();
}

function initFilters() {
  // Single-select pill groups inside the filter sheet
  const timeRow = document.getElementById("filter-time");
  const catRow = document.getElementById("filter-category");
  const urgRow = document.getElementById("filter-urgency");

  if (timeRow) {
    timeRow.querySelectorAll(".filter-pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        setActivePill("filter-time", pill.dataset.value);
        uiFilter.hours = pill.dataset.value === "all" ? null : parseInt(pill.dataset.value, 10);
      });
    });
  }
  if (catRow) {
    catRow.querySelectorAll(".filter-pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        setActivePill("filter-category", pill.dataset.value);
        uiFilter.category = pill.dataset.value === "all" ? null : pill.dataset.value;
      });
    });
  }
  if (urgRow) {
    urgRow.querySelectorAll(".filter-pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        setActivePill("filter-urgency", pill.dataset.value);
        uiFilter.urgency = pill.dataset.value === "all" ? null : pill.dataset.value;
      });
    });
  }

  // Open / close
  const filterBtn = document.getElementById("filter-btn");
  if (filterBtn) filterBtn.addEventListener("click", openFilterSheet);
  const listFiltersBtn = document.getElementById("list-filters-btn");
  if (listFiltersBtn) listFiltersBtn.addEventListener("click", openFilterSheet);
  const backdrop = document.getElementById("filter-sheet-backdrop");
  if (backdrop) backdrop.addEventListener("click", closeFilterSheet);

  // Apply
  const applyBtn = document.getElementById("filter-apply");
  if (applyBtn) applyBtn.addEventListener("click", () => { applyUiFilter(); closeFilterSheet(); });

  // Reset
  const resetBtn = document.getElementById("filter-reset");
  if (resetBtn) resetBtn.addEventListener("click", () => {
    uiFilter = { hours: 6, category: null, urgency: null };
    setActivePill("filter-time", "6");
    setActivePill("filter-category", "all");
    setActivePill("filter-urgency", "all");
    applyUiFilter();
  });
}

// ── Layers bottom sheet ──────────────────────────────────────────────────────
function openLayersSheet() {
  const overlay = document.getElementById("layers-sheet-overlay");
  if (overlay) { overlay.classList.remove("hidden"); overlay.setAttribute("aria-hidden", "false"); }
}
function closeLayersSheet() {
  const overlay = document.getElementById("layers-sheet-overlay");
  if (overlay) { overlay.classList.add("hidden"); overlay.setAttribute("aria-hidden", "true"); }
}

function setSwitch(id, on) {
  const sw = document.getElementById(id);
  if (!sw) return;
  sw.classList.toggle("active", on);
  sw.setAttribute("aria-checked", String(on));
}

function initLayersSheet() {
  const layersBtn = document.getElementById("layers-btn");
  if (layersBtn) layersBtn.addEventListener("click", openLayersSheet);
  const backdrop = document.getElementById("layers-sheet-backdrop");
  if (backdrop) backdrop.addEventListener("click", closeLayersSheet);
  const doneBtn = document.getElementById("layers-done");
  if (doneBtn) doneBtn.addEventListener("click", closeLayersSheet);

  document.querySelectorAll(".layers-sheet .layer-row").forEach((row) => {
    row.addEventListener("click", () => {
      const layer = row.dataset.layer;
      if (layer === "reports") {
        showIncidents = !showIncidents;
        setSwitch("layer-reports", showIncidents);
        renderMapMarkers();
      } else if (layer === "discoveries") {
        showStreetNotes = !showStreetNotes;
        setSwitch("layer-discoveries", showStreetNotes);
        renderStreetNotes();
      } else if (layer === "highlights") {
        showHighlights = !showHighlights;
        setSwitch("layer-highlights", showHighlights);
        renderAdminStreetHighlights();
      } else if (layer === "facilities") {
        showPublicFacilities = !showPublicFacilities;
        showCityFountains = showPublicFacilities;
        showCityToilets = showPublicFacilities;
        setSwitch("layer-facilities", showPublicFacilities);
        renderCityDrinkingFountains();
        renderCityPublicToilets();
        renderStreetNotes(); // user-reported toilets/fountains follow this toggle too
      }
      renderList();
    });
  });
}

// ── Map header (online pill → chat) ──────────────────────────────────────────
function initMapHeader() {
  const onlinePill = document.getElementById("online-pill");
  if (onlinePill) {
    onlinePill.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openChatModal();
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

async function loadCityDrinkingFountains() {
  try {
    const response = await fetch("/data/melbourne-drinking-fountains.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    cityDrinkingFountains = await response.json();
    renderCityDrinkingFountains();
    renderList();
  } catch (error) {
    console.error("Failed to load city drinking fountains:", error);
  }
}

function renderCityDrinkingFountains() {
  if (!cityFountainsLayer) return;
  cityFountainsLayer.clearLayers();
  if (!showCityFountains) return;

  cityDrinkingFountains.forEach((fountain) => {
    const icon = L.divIcon({
      className: "city-fountain-pin",
      html: `<div style="background:#e3f2fd;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #1565c0;box-shadow:0 1px 4px rgba(0,0,0,0.25);font-size:14px;">💧</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });
    const marker = L.marker([fountain.lat, fountain.lng], { icon });
    marker.bindPopup(`
      <div style="max-width: 240px; padding: 0.25rem;">
        <div style="font-size: 0.9375rem; color: var(--ui-text); line-height: 1.5; margin-bottom: 0.5rem;">${fountain.description}</div>
        <div style="font-size: 0.75rem; color: var(--ui-muted);">Official · ${fountain.source || "City of Melbourne"}</div>
      </div>
    `);
    cityFountainsLayer.addLayer(marker);
  });
}

async function loadCityPublicToilets() {
  try {
    const response = await fetch("/data/melbourne-public-toilets.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    cityPublicToilets = await response.json();
    renderCityPublicToilets();
    renderList();
  } catch (error) {
    console.error("Failed to load city public toilets:", error);
  }
}

function renderCityPublicToilets() {
  if (!cityToiletsLayer) return;
  cityToiletsLayer.clearLayers();
  if (!showCityToilets) return;

  cityPublicToilets.forEach((toilet) => {
    const icon = L.divIcon({
      className: "city-toilet-pin",
      html: `<div style="background:#f3e8ff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #7c3aed;box-shadow:0 1px 4px rgba(0,0,0,0.25);font-size:14px;">🚽</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });
    const marker = L.marker([toilet.lat, toilet.lng], { icon });
    marker.bindPopup(buildToiletPopupHtml(toilet));
    cityToiletsLayer.addLayer(marker);
  });
}

function renderStreetNotes() {
  if (!streetNotesLayer) return;
  streetNotesLayer.clearLayers();

  streetNotes.forEach((note) => {
    // Facility notes follow the Public Facilities toggle; everything else
    // follows the Discoveries toggle.
    if (isFacilityNote(note) ? !showPublicFacilities : !showStreetNotes) return;
    const pinEmoji = note.emoji || "📝";
    // Tint the pin ring per discovery category so notes read instantly.
    const accent = streetNoteAccent(pinEmoji);
    const icon = L.divIcon({
      className: "map-pin-wrap",
      html: `
        <div class="map-pin map-pin-note" style="--pin-accent:${accent}">
          <span class="map-pin-emoji">${pinEmoji}</span>
        </div>`,
      iconSize: [38, 46],
      iconAnchor: [19, 44],
      popupAnchor: [0, -40]
    });
    
    const marker = L.marker([note.latitude, note.longitude], { icon });

    const timeAgo = humanTimeAgo(note.created_at);
    const isForever = note.forever || !note.expires_at;
    const expiryText = isForever ? "Permanent" : formatRemainingTime(note.expires_at);
    const permBadge = isForever ? '<span class="note-permanent-badge">PERMANENT</span>' : '';
    const imageHtml = note.image_url
      ? `<div style="margin-bottom: 0.5rem;"><img src="${note.image_url}" alt="Street note image" style="display:block; width:100%; max-width:200px; max-height:140px; object-fit:cover; border-radius: 6px; border: 1px solid var(--ui-border);" /></div>`
      : "";
    const locationHtml = note.location_text
      ? `<div style="font-size: 0.75rem; color: var(--ui-muted); margin-bottom: 0.5rem;">📍 ${note.location_text}</div>`
      : "";
    const adminDeleteHtml = isAdminLoggedIn
      ? `<div style="margin-top: 0.5rem;"><button type="button" class="note-admin-delete" data-note-id="${note.id}">🗑️ Delete note</button></div>`
      : "";
    marker.bindPopup(`
      <div style="max-width: 220px; padding: 0.25rem;">
        ${imageHtml}
        ${locationHtml}
        <div style="font-size: 0.9375rem; color: var(--ui-text); line-height: 1.5; margin-bottom: 0.5rem;">${note.text}${permBadge}</div>
        <div style="font-size: 0.75rem; color: var(--ui-muted);">${timeAgo} &middot; ${expiryText}</div>
        ${adminDeleteHtml}
      </div>
    `);

    marker.on("popupopen", (e) => {
      const btn = e.popup.getElement().querySelector(".note-admin-delete");
      if (btn) {
        btn.addEventListener("click", async () => {
          if (!confirm("Delete this street note?")) return;
          try {
            await deleteStreetNoteById(note.id);
            map.closePopup();
            await fetchStreetNotes();
          } catch (err) {
            alert("Failed to delete note.");
          }
        });
      }
    });

    streetNotesLayer.addLayer(marker);
  });
}

function addNotesToggle() {
  if (!map) return;

  const toggle = L.control({ position: "bottomright" });

  toggle.onAdd = function () {
    const div = L.DomUtil.create("div", "notes-toggle-container");
    div.innerHTML = `
      <button type="button" class="map-layer-toggle active" id="notes-toggle" aria-pressed="true">Notes</button>
      <button type="button" class="map-layer-toggle" id="fountains-toggle" aria-pressed="false">Fountains</button>
      <button type="button" class="map-layer-toggle" id="toilets-toggle" aria-pressed="false">WC</button>
    `;

    L.DomEvent.disableClickPropagation(div);

    const notesBtn = div.querySelector("#notes-toggle");
    notesBtn.addEventListener("click", () => {
      showStreetNotes = !showStreetNotes;
      notesBtn.classList.toggle("active", showStreetNotes);
      notesBtn.setAttribute("aria-pressed", String(showStreetNotes));
      renderStreetNotes();
      renderList();
    });

    const fountainsBtn = div.querySelector("#fountains-toggle");
    fountainsBtn.addEventListener("click", () => {
      showCityFountains = !showCityFountains;
      fountainsBtn.classList.toggle("active", showCityFountains);
      fountainsBtn.setAttribute("aria-pressed", String(showCityFountains));
      renderCityDrinkingFountains();
      renderList();
    });

    const toiletsBtn = div.querySelector("#toilets-toggle");
    toiletsBtn.addEventListener("click", () => {
      showCityToilets = !showCityToilets;
      toiletsBtn.classList.toggle("active", showCityToilets);
      toiletsBtn.setAttribute("aria-pressed", String(showCityToilets));
      renderCityPublicToilets();
      renderList();
    });

    return div;
  };

  toggle.addTo(map);
}

// Centre the map on the user's current location (used by the floating Locate button)
function goToMyLocation(triggerEl) {
  if (!map) return;
  if (userLocation) {
    map.setView([userLocation.lat, userLocation.lng], 17);
    updateUserMarkers();
    return;
  }
  if (!navigator.geolocation) return;
  if (triggerEl) triggerEl.classList.add('locating');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      map.setView([userLocation.lat, userLocation.lng], 17);
      updateUserMarkers();
      if (triggerEl) triggerEl.classList.remove('locating');
    },
    () => { if (triggerEl) triggerEl.classList.remove('locating'); },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function initLocateButton() {
  const btn = document.getElementById("locate-fab");
  if (btn) btn.addEventListener("click", () => goToMyLocation(btn));
}

function openStreetNoteModal() {
  const modal = document.getElementById("street-note-modal");
  if (!modal) return;

  // Reset wizard state
  discoveryWizardStep = 1;
  discoveryWizardData = { emoji: null, label: '', questionAnswer: null, note: '', photoDataUrl: null };
  selectedNoteEmoji = null;
  streetNoteLocation = null;

  // Reset duration slider + forever toggle
  noteDurationHours = 12;
  noteForever = false;
  const durSlider = document.getElementById("street-note-duration");
  const durBubble = document.getElementById("duration-bubble");
  const durPlayer = document.querySelector(".duration-player");
  const foreverCb = document.getElementById("street-note-forever");
  if (durSlider) {
    durSlider.value = 12;
    durSlider.disabled = false;
    const pct = `${((12 - 1) / (72 - 1)) * 100}%`;
    durSlider.style.setProperty("--fill", pct);
    if (durBubble) {
      durBubble.style.setProperty("--fill", pct);
      durBubble.textContent = "12 hours";
    }
  }
  if (durPlayer) durPlayer.classList.remove("is-forever");
  if (foreverCb) foreverCb.checked = false;

  // Reset all step visibility
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`discovery-step-${i}`);
    if (el) { el.style.display = i === 1 ? '' : 'none'; }
  }

  // Reset category grid selection
  const catGrid = document.getElementById("discovery-category-grid");
  if (catGrid) catGrid.querySelectorAll(".cat-card").forEach(c => c.classList.remove("selected"));

  // Reset step 2 fields
  const textarea = document.getElementById("street-note-text");
  if (textarea) textarea.value = "";
  const countEl = document.getElementById("street-note-count");
  if (countEl) countEl.textContent = "0";
  const imageInput = document.getElementById("street-note-image");
  if (imageInput) imageInput.value = "";
  const photoPreview = document.getElementById("discovery-photo-preview");
  if (photoPreview) { photoPreview.style.display = 'none'; photoPreview.src = ''; }
  const photoPlaceholder = document.getElementById("discovery-photo-placeholder");
  if (photoPlaceholder) photoPlaceholder.style.display = '';
  const photoRemove = document.getElementById("discovery-photo-remove");
  if (photoRemove) photoRemove.style.display = 'none';

  // Reset binary selector
  document.querySelectorAll('#discovery-question-selector .binary-btn').forEach(b => b.classList.remove('active'));

  // Update dots + back btn
  updateDiscoveryStepDots();
  updateDiscoveryBackBtn();

  // Show modal and init discovery map if needed
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");

  // Pre-fill user GPS location if available
  if (userLocation) {
    streetNoteLocation = { lat: userLocation.lat, lng: userLocation.lng };
  } else {
    streetNoteLocation = { lat: MELBOURNE_CBD.lat, lng: MELBOURNE_CBD.lng };
  }
}

function closeStreetNoteModal() {
  const modal = document.getElementById("street-note-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function updateDiscoveryStepDots() {
  const dotsEl = document.getElementById('discovery-step-dots');
  if (!dotsEl) return;
  const dots = dotsEl.querySelectorAll('.wdot');
  dots.forEach((dot, i) => dot.classList.toggle('active', i === discoveryWizardStep - 1));
}

function updateDiscoveryBackBtn() {
  const btn = document.getElementById('discovery-back-btn');
  if (btn) btn.style.visibility = discoveryWizardStep > 1 ? 'visible' : 'hidden';
}

function goToDiscoveryStep(step) {
  const current = document.getElementById(`discovery-step-${discoveryWizardStep}`);
  if (current) current.style.display = 'none';
  discoveryWizardStep = step;
  const next = document.getElementById(`discovery-step-${discoveryWizardStep}`);
  if (next) next.style.display = '';
  updateDiscoveryStepDots();
  updateDiscoveryBackBtn();
  if (step === 3) {
    // Init or refresh discovery location map
    setTimeout(() => {
      if (!discoveryLocationMap) {
        initDiscoveryLocationMap();
      } else {
        discoveryLocationMap.invalidateSize();
        if (streetNoteLocation) {
          discoveryLocationMap.setView([streetNoteLocation.lat, streetNoteLocation.lng], 16);
          setDiscoveryMarker(streetNoteLocation.lat, streetNoteLocation.lng);
        }
      }
    }, 250);
  }
  if (step === 4) buildDiscoveryReviewCard();
}

function buildDiscoveryReviewCard() {
  const reviewCard = document.getElementById("discovery-review-card");
  if (!reviewCard) return;
  const loc = streetNoteLocation || { lat: MELBOURNE_CBD.lat, lng: MELBOURNE_CBD.lng };
  const locInput = document.getElementById("street-note-location");
  const locText = (locInput && locInput.value.trim()) || `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`;
  const noteText = discoveryWizardData.note || '';
  const questionHtml = discoveryWizardData.questionAnswer
    ? `<div class="review-row"><span class="review-row-icon">💬</span><span class="review-row-label">Status</span><span>${discoveryWizardData.questionAnswer === 'yes' ? 'Yes ✓' : 'No ✗'}</span></div>`
    : '';

  let photoHtml = '';
  if (discoveryWizardData.photoDataUrl) {
    photoHtml = `<img src="${discoveryWizardData.photoDataUrl}" alt="Discovery photo" style="width:100%;height:120px;object-fit:cover;border-radius:10px;margin-bottom:0.625rem;display:block;" />`;
  }

  reviewCard.innerHTML = `
    ${photoHtml}
    <div class="review-row">
      <span class="review-row-icon">${discoveryWizardData.emoji || '📍'}</span>
      <span class="review-row-label">Type</span>
      <span>${discoveryWizardData.label || 'Discovery'}</span>
    </div>
    ${questionHtml}
    ${noteText ? `<div class="review-row"><span class="review-row-icon">📝</span><span class="review-row-label">Note</span><span style="font-size:0.8rem">${noteText.substring(0,80)}${noteText.length>80?'…':''}</span></div>` : ''}
    <div class="review-row">
      <span class="review-row-icon">⏳</span>
      <span class="review-row-label">Duration</span>
      <span>${noteForever ? 'Forever' : formatDurationText(noteDurationHours)}</span>
    </div>
    <div class="review-row">
      <span class="review-row-icon">📍</span>
      <span class="review-row-label">Location</span>
      <span style="font-size:0.8rem">${locText}</span>
    </div>
  `;
  const submitBtn = document.getElementById("street-note-submit");
  if (submitBtn) submitBtn.disabled = false;
}

function renderEmojiShortcutBar() {
  const bar = document.getElementById("emoji-shortcut-bar");
  if (!bar) return;
  bar.innerHTML = "";
  EMOJI_SHORTCUTS.forEach((item) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "emoji-shortcut-btn";
    btn.dataset.emoji = item.emoji;
    if (selectedNoteEmoji === item.emoji) btn.classList.add("selected");
    btn.innerHTML = `<span class="emoji-shortcut-emoji">${item.emoji}</span><span class="emoji-shortcut-label">${item.label}</span>`;
    btn.addEventListener("click", () => handleEmojiShortcut(item));
    bar.appendChild(btn);
  });
}

function updateEmojiButtonStates() {
  const bar = document.getElementById("emoji-shortcut-bar");
  if (!bar) return;
  bar.querySelectorAll(".emoji-shortcut-btn").forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.emoji === selectedNoteEmoji);
  });
}

function handleEmojiShortcut(item) {
  const textarea = document.getElementById("street-note-text");
  if (!textarea) return;

  // Tap same emoji again -> deselect (text stays so user can edit)
  if (selectedNoteEmoji === item.emoji) {
    selectedNoteEmoji = null;
    updateEmojiButtonStates();
    return;
  }

  selectedNoteEmoji = item.emoji;

  // Autofill only if textbox is empty OR still holds the previous autofill phrase
  const current = textarea.value;
  const canAutofill = current.trim() === "" || current === lastAutofilledPhrase;
  if (canAutofill) {
    textarea.value = item.phrase;
    lastAutofilledPhrase = item.phrase;
    const countEl = document.getElementById("street-note-count");
    if (countEl) countEl.textContent = item.phrase.length;
    const submitBtn = document.getElementById("street-note-submit");
    if (submitBtn) submitBtn.disabled = item.phrase.length === 0 || item.phrase.length > 150;
  }

  updateEmojiButtonStates();
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
  const locInput = document.getElementById("street-note-location");
  const locationText = locInput ? locInput.value.trim() : "";
  const lat = streetNoteLocation ? streetNoteLocation.lat : (userLocation ? userLocation.lat : MELBOURNE_CBD.lat);
  const lng = streetNoteLocation ? streetNoteLocation.lng : (userLocation ? userLocation.lng : MELBOURNE_CBD.lng);

  // Build note text from question answer + user note
  let text = discoveryWizardData.note || "";
  if (discoveryWizardData.questionAnswer && discoveryWizardData.label) {
    const statusPrefix = discoveryWizardData.questionAnswer === 'yes'
      ? `${discoveryWizardData.label}: Working`
      : `${discoveryWizardData.label}: Not working`;
    text = text ? `${statusPrefix} — ${text}` : statusPrefix;
  }
  if (!text && discoveryWizardData.label) {
    text = `${discoveryWizardData.label} here`;
  }
  if (!text) text = "Discovery";

  const submitBtn = document.getElementById("street-note-submit");
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Posting…"; }

  try {
    const response = await fetch(`${API_BASE}/street-notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        latitude: lat,
        longitude: lng,
        location_text: locationText,
        image_url: discoveryWizardData.photoDataUrl || "",
        emoji: discoveryWizardData.emoji || null,
        duration_hours: noteForever ? null : noteDurationHours,
        forever: noteForever
      }),
    });

    if (response.ok) {
      await fetchStreetNotes();
      closeStreetNoteModal();
      showToast('📍 Discovery posted!');
    } else {
      const errText = await response.text();
      throw new Error(`Failed to post: ${response.status} ${errText}`);
    }
  } catch (error) {
    console.error("Failed to post discovery:", error);
    alert(error && error.message ? error.message : "Failed to post. Please try again.");
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Post Discovery"; }
  }
}

function initDiscoveryLocationMap() {
  const container = document.getElementById("discovery-location-map");
  if (!container || discoveryLocationMap) return;

  const center = streetNoteLocation || userLocation || MELBOURNE_CBD;
  discoveryLocationMap = L.map("discovery-location-map").setView([center.lat, center.lng], 16);
  discoveryLocationMap.attributionControl.setPrefix(false);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    subdomains: "abcd",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
  }).addTo(discoveryLocationMap);

  discoveryLocationMap.on("click", (e) => {
    setDiscoveryMarker(e.latlng.lat, e.latlng.lng);
  });

  // Place initial marker
  setDiscoveryMarker(center.lat, center.lng);
}

function setDiscoveryMarker(lat, lng) {
  streetNoteLocation = { lat, lng };
  if (!discoveryLocationMap) return;
  if (!discoveryLocationMarker) {
    discoveryLocationMarker = L.marker([lat, lng], { draggable: true }).addTo(discoveryLocationMap);
    discoveryLocationMarker.on("dragend", (e) => {
      const pos = e.target.getLatLng();
      streetNoteLocation = { lat: pos.lat, lng: pos.lng };
      reverseGeocode(pos.lat, pos.lng).then(desc => {
        const locInput = document.getElementById("street-note-location");
        if (locInput && desc) locInput.value = desc;
      });
    });
  } else {
    discoveryLocationMarker.setLatLng([lat, lng]);
  }
  discoveryLocationMap.setView([lat, lng], 16);
  reverseGeocode(lat, lng).then(desc => {
    const locInput = document.getElementById("street-note-location");
    if (locInput && desc) locInput.value = desc;
  });
}

function initStreetNoteModal() {
  // Notes button in header nav
  const notesBtn = document.getElementById("notes-button");
  if (notesBtn) notesBtn.addEventListener("click", openStreetNoteModal);

  // Close button
  const closeBtn = document.getElementById("street-note-close");
  if (closeBtn) closeBtn.addEventListener("click", closeStreetNoteModal);

  // Submit button
  const submitBtn = document.getElementById("street-note-submit");
  if (submitBtn) submitBtn.addEventListener("click", submitStreetNote);

  // ── Duration slider + "keep forever" toggle ────────────────────────────
  const durSlider = document.getElementById("street-note-duration");
  const durBubble = document.getElementById("duration-bubble");
  const durPlayer = document.querySelector(".duration-player");
  if (durSlider) {
    durSlider.addEventListener("input", () => {
      const hours = parseInt(durSlider.value, 10) || 12;
      noteDurationHours = hours;
      const pct = `${((hours - 1) / (72 - 1)) * 100}%`;
      durSlider.style.setProperty("--fill", pct);
      if (durBubble) {
        durBubble.style.setProperty("--fill", pct);
        durBubble.textContent = formatDurationText(hours);
      }
    });
  }
  const foreverCb = document.getElementById("street-note-forever");
  if (foreverCb) {
    foreverCb.addEventListener("change", () => {
      noteForever = foreverCb.checked;
      if (durSlider) durSlider.disabled = noteForever;
      if (durPlayer) durPlayer.classList.toggle("is-forever", noteForever);
    });
  }

  // ── Discovery step 1: category grid ────────────────────────────────────
  const discCatGrid = document.getElementById("discovery-category-grid");
  if (discCatGrid) {
    discCatGrid.addEventListener("click", (e) => {
      const card = e.target.closest(".cat-card");
      if (!card) return;
      discCatGrid.querySelectorAll(".cat-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      discoveryWizardData.emoji = card.dataset.value;
      discoveryWizardData.label = card.dataset.label || card.querySelector(".cat-label")?.textContent || '';
      selectedNoteEmoji = discoveryWizardData.emoji;

      // Update step 2 title
      const step2Title = document.getElementById("discovery-step2-title");
      if (step2Title) step2Title.textContent = discoveryWizardData.label || "Discovery Details";

      // Show category-specific question
      const questionField = document.getElementById("discovery-question-field");
      const questionLabel = document.getElementById("discovery-question-label");
      const questionMeta = {
        '💧': 'Is the fountain working?',
        '🚻': 'Is it accessible / clean?',
        '🔌': 'Is it available?',
      };
      const q = questionMeta[discoveryWizardData.emoji];
      if (questionField && questionLabel) {
        if (q) {
          questionLabel.textContent = q;
          questionField.style.display = '';
        } else {
          questionField.style.display = 'none';
        }
      }
      // Reset binary selector
      document.querySelectorAll('#discovery-question-selector .binary-btn').forEach(b => b.classList.remove('active'));
      discoveryWizardData.questionAnswer = null;

      setTimeout(() => goToDiscoveryStep(2), 180);
    });
  }

  // ── Discovery back button ──────────────────────────────────────────────
  const discBackBtn = document.getElementById("discovery-back-btn");
  if (discBackBtn) {
    discBackBtn.addEventListener("click", () => {
      if (discoveryWizardStep > 1) goToDiscoveryStep(discoveryWizardStep - 1);
    });
  }

  // ── Discovery step 2: photo upload ─────────────────────────────────────
  const discPhotoInput = document.getElementById("street-note-image");
  if (discPhotoInput) {
    discPhotoInput.addEventListener("change", async () => {
      const file = discPhotoInput.files[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { alert("Image too large (max 10MB)."); return; }
      try {
        const dataUrl = await fileToImageDataUrl(file, 1280, 1280, 0.8);
        if (dataUrl.length > 2_000_000) { alert("Image still too large after compression."); return; }
        discoveryWizardData.photoDataUrl = dataUrl;
        const preview = document.getElementById("discovery-photo-preview");
        const placeholder = document.getElementById("discovery-photo-placeholder");
        const removeBtn = document.getElementById("discovery-photo-remove");
        if (preview) { preview.src = dataUrl; preview.style.display = 'block'; }
        if (placeholder) placeholder.style.display = 'none';
        if (removeBtn) removeBtn.style.display = 'block';
      } catch (err) { alert(err.message || "Could not load image."); }
    });
  }
  const discPhotoRemove = document.getElementById("discovery-photo-remove");
  if (discPhotoRemove) {
    discPhotoRemove.addEventListener("click", (e) => {
      e.stopPropagation();
      discoveryWizardData.photoDataUrl = null;
      const preview = document.getElementById("discovery-photo-preview");
      const placeholder = document.getElementById("discovery-photo-placeholder");
      if (preview) { preview.src = ''; preview.style.display = 'none'; }
      if (placeholder) placeholder.style.display = '';
      discPhotoRemove.style.display = 'none';
      if (discPhotoInput) discPhotoInput.value = '';
    });
  }

  // ── Discovery step 2: binary question buttons ──────────────────────────
  const yesBtn = document.getElementById("disc-yes-btn");
  const noBtn = document.getElementById("disc-no-btn");
  if (yesBtn) {
    yesBtn.addEventListener("click", () => {
      yesBtn.classList.add("active"); if (noBtn) noBtn.classList.remove("active");
      discoveryWizardData.questionAnswer = 'yes';
    });
  }
  if (noBtn) {
    noBtn.addEventListener("click", () => {
      noBtn.classList.add("active"); if (yesBtn) yesBtn.classList.remove("active");
      discoveryWizardData.questionAnswer = 'no';
    });
  }

  // ── Discovery step 2: note textarea ───────────────────────────────────
  const noteTextarea = document.getElementById("street-note-text");
  if (noteTextarea) {
    noteTextarea.addEventListener("input", () => {
      const count = noteTextarea.value.length;
      const countEl = document.getElementById("street-note-count");
      if (countEl) countEl.textContent = count;
      discoveryWizardData.note = noteTextarea.value;
    });
  }

  // ── Discovery step 2: continue ────────────────────────────────────────
  const disc2Next = document.getElementById("discovery-step2-next");
  if (disc2Next) disc2Next.addEventListener("click", () => goToDiscoveryStep(3));

  // ── Discovery step 3: use GPS location ────────────────────────────────
  const useLocBtn = document.getElementById("street-note-use-location");
  if (useLocBtn) {
    useLocBtn.addEventListener("click", () => {
      if (!navigator.geolocation) {
        streetNoteLocation = { lat: MELBOURNE_CBD.lat, lng: MELBOURNE_CBD.lng };
        return;
      }
      useLocBtn.textContent = "Getting location…";
      useLocBtn.disabled = true;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setDiscoveryMarker(pos.coords.latitude, pos.coords.longitude);
          useLocBtn.disabled = false;
          useLocBtn.innerHTML = '<span>📍</span> Use current location';
        },
        () => {
          useLocBtn.disabled = false;
          useLocBtn.innerHTML = '<span>📍</span> Use current location';
          alert("Could not access GPS location.");
        },
        { enableHighAccuracy: true, maximumAge: 60000, timeout: 10000 }
      );
    });
  }

  // ── Discovery step 3: address search ──────────────────────────────────
  const discAddrToggle = document.getElementById("discovery-addr-toggle");
  if (discAddrToggle) {
    discAddrToggle.addEventListener("click", () => {
      const row = document.getElementById("discovery-addr-row");
      if (row) row.style.display = row.style.display === 'none' ? 'flex' : 'none';
    });
  }
  const discSearchGo = document.getElementById("discovery-search-go");
  if (discSearchGo) {
    discSearchGo.addEventListener("click", async () => {
      const input = document.getElementById("street-note-location");
      if (!input || !input.value.trim()) return;
      try {
        const res = await fetch(`${API_BASE}/geocode`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: input.value.trim() }),
        });
        const data = await res.json();
        if (data.success && data.locations && data.locations.length > 0) {
          const loc = data.locations[0];
          setDiscoveryMarker(loc.latitude, loc.longitude);
        } else {
          alert("No matching locations found.");
        }
      } catch (e) { alert("Unable to search address."); }
    });
  }

  // ── Discovery step 3: continue ────────────────────────────────────────
  const disc3Next = document.getElementById("discovery-step3-next");
  if (disc3Next) disc3Next.addEventListener("click", () => goToDiscoveryStep(4));

  // Backdrop click to close
  const modal = document.getElementById("street-note-modal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeStreetNoteModal();
    });
  }
}

function initModalsAndButtons() {
  // ── Report wizard button bindings ──────────────────────────────────────
  const reportBtn = document.getElementById("report-button");
  if (reportBtn) reportBtn.addEventListener("click", openReportModal);

  const reportClose = document.getElementById("report-close");
  if (reportClose) reportClose.addEventListener("click", closeReportModal);

  const reportBackdrop = document.getElementById("report-modal-backdrop");
  if (reportBackdrop) reportBackdrop.addEventListener("click", closeReportModal);

  const submitReportBtn = document.getElementById("submit-report");
  if (submitReportBtn) submitReportBtn.addEventListener("click", submitReport);

  const addrSearchBtn = document.getElementById("address-search-button");
  if (addrSearchBtn) addrSearchBtn.addEventListener("click", geocodeAddress);

  const useLocBtn = document.getElementById("use-location");
  if (useLocBtn) useLocBtn.addEventListener("click", useCurrentLocation);

  const detailClose = document.getElementById("detail-close");
  if (detailClose) detailClose.addEventListener("click", closeDetailModal);

  // ── Report back button ─────────────────────────────────────────────────
  const reportBackBtn = document.getElementById("report-back-btn");
  if (reportBackBtn) {
    reportBackBtn.addEventListener("click", () => {
      if (reportWizardStep > 1) goToReportStep(reportWizardStep - 1);
    });
  }

  // ── Report step 1: category grid — auto-advance ────────────────────────
  const reportCatGrid = document.getElementById("report-category-grid");
  if (reportCatGrid) {
    reportCatGrid.addEventListener("click", (e) => {
      const card = e.target.closest(".cat-card");
      if (!card) return;
      reportCatGrid.querySelectorAll(".cat-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      reportWizardData.category = card.dataset.value;
      setTimeout(() => goToReportStep(2), 180);
    });
  }

  // ── Report step 2: address toggle ─────────────────────────────────────
  const reportAddrToggle = document.getElementById("report-addr-toggle");
  if (reportAddrToggle) {
    reportAddrToggle.addEventListener("click", () => {
      const row = document.getElementById("report-addr-row");
      if (row) row.style.display = row.style.display === 'none' ? 'flex' : 'none';
    });
  }

  // ── Report step 2: continue ────────────────────────────────────────────
  const step2Next = document.getElementById("report-step2-next");
  if (step2Next) {
    step2Next.addEventListener("click", () => {
      if (!locationMarker) {
        alert("Please set a location first.");
        return;
      }
      goToReportStep(3);
    });
  }

  // ── Report step 3: description char count ─────────────────────────────
  const descInput = document.getElementById("description-input");
  if (descInput) {
    descInput.addEventListener("input", () => {
      const count = document.getElementById("desc-char-count");
      if (count) count.textContent = descInput.value.length;
      reportWizardData.description = descInput.value;
    });
  }

  // ── Report step 3: urgency buttons ────────────────────────────────────
  const urgencySelector = document.getElementById("urgency-selector");
  if (urgencySelector) {
    urgencySelector.addEventListener("click", (e) => {
      const btn = e.target.closest(".urg-btn");
      if (!btn) return;
      urgencySelector.querySelectorAll(".urg-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      reportWizardData.urgency = btn.dataset.value;
    });
  }

  // ── Report step 3: photo upload ────────────────────────────────────────
  const reportPhotoInput = document.getElementById("report-photo-input");
  if (reportPhotoInput) {
    reportPhotoInput.addEventListener("change", async () => {
      const file = reportPhotoInput.files[0];
      if (!file) return;
      try {
        const dataUrl = await fileToImageDataUrl(file, 1280, 1280, 0.8);
        reportWizardData.photoDataUrl = dataUrl;
        const preview = document.getElementById("report-photo-preview");
        const placeholder = document.getElementById("report-photo-placeholder");
        const removeBtn = document.getElementById("report-photo-remove");
        if (preview) { preview.src = dataUrl; preview.style.display = 'block'; }
        if (placeholder) placeholder.style.display = 'none';
        if (removeBtn) removeBtn.style.display = 'block';
      } catch (err) {
        alert(err.message || "Could not load image.");
      }
    });
  }
  const reportPhotoRemove = document.getElementById("report-photo-remove");
  if (reportPhotoRemove) {
    reportPhotoRemove.addEventListener("click", (e) => {
      e.stopPropagation();
      reportWizardData.photoDataUrl = null;
      const preview = document.getElementById("report-photo-preview");
      const placeholder = document.getElementById("report-photo-placeholder");
      if (preview) { preview.src = ''; preview.style.display = 'none'; }
      if (placeholder) placeholder.style.display = '';
      reportPhotoRemove.style.display = 'none';
      const photoInput = document.getElementById("report-photo-input");
      if (photoInput) photoInput.value = '';
    });
  }

  // ── Report step 3: continue ────────────────────────────────────────────
  const step3Next = document.getElementById("report-step3-next");
  if (step3Next) step3Next.addEventListener("click", () => goToReportStep(4));

  // ── Report step 4: verification options ───────────────────────────────
  const anonBtn = document.getElementById("verify-anon-btn");
  const verifiedBtn = document.getElementById("verify-verified-btn");
  const contactFields = document.getElementById("contact-fields");

  function selectIdentityMode(mode) {
    reportWizardData.identityMode = mode;
    const isAnon = mode === 'anonymous';
    if (anonBtn) anonBtn.classList.toggle('active', isAnon);
    if (verifiedBtn) verifiedBtn.classList.toggle('active', !isAnon);
    const anonCheck = document.getElementById("verify-anon-check");
    const verifiedCheck = document.getElementById("verify-verified-check");
    if (anonCheck) anonCheck.classList.toggle('verify-check-hidden', !isAnon);
    if (verifiedCheck) verifiedCheck.classList.toggle('verify-check-hidden', isAnon);
    if (contactFields) contactFields.style.display = isAnon ? 'none' : 'block';
  }

  if (anonBtn) anonBtn.addEventListener("click", () => selectIdentityMode('anonymous'));
  if (verifiedBtn) verifiedBtn.addEventListener("click", () => selectIdentityMode('verified'));

  // ── Report step 4: continue ────────────────────────────────────────────
  const step4Next = document.getElementById("report-step4-next");
  if (step4Next) step4Next.addEventListener("click", () => goToReportStep(5));
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

  container.innerHTML = "";
  container.appendChild(buildAnnouncementBubble());

  if (chatMessages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "chat-loading";
    empty.textContent = "No messages yet. Be the first to say something!";
    container.appendChild(empty);
    return;
  }

  // Pinned messages surface at the top in their own banner (admin-decided).
  const pinned = chatMessages.filter((m) => m.pinned);
  if (pinned.length) {
    const pinnedWrap = document.createElement("div");
    pinnedWrap.className = "chat-pinned";
    const header = document.createElement("div");
    header.className = "chat-pinned-header";
    header.innerHTML = `<span aria-hidden="true">📌</span> Pinned`;
    pinnedWrap.appendChild(header);
    pinned.forEach((msg) => pinnedWrap.appendChild(buildChatBubble(msg, true)));
    container.appendChild(pinnedWrap);
  }

  chatMessages.forEach((msg) => {
    if (msg.pinned) return;
    container.appendChild(buildChatBubble(msg, false));
  });

  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

function buildAnnouncementBubble() {
  const messageDiv = document.createElement("div");
  messageDiv.className = "chat-message chat-announcement";
  messageDiv.setAttribute("aria-live", "polite");

  const authorDiv = document.createElement("div");
  authorDiv.className = "chat-message-author";
  authorDiv.textContent = "Announcement";

  const textDiv = document.createElement("div");
  textDiv.className = "chat-message-text";
  textDiv.textContent = liveUpdatesContent || "";

  messageDiv.appendChild(authorDiv);
  messageDiv.appendChild(textDiv);
  return messageDiv;
}

function buildChatBubble(msg, inPinnedSection) {
  const messageDiv = document.createElement("div");
  messageDiv.className = "chat-message";
  if (msg.pinned && !inPinnedSection) messageDiv.classList.add("is-pinned");

  const authorDiv = document.createElement("div");
  authorDiv.className = "chat-message-author";
  authorDiv.textContent = msg.author || "Anonymous";

  const textDiv = document.createElement("div");
  textDiv.className = "chat-message-text";
  textDiv.textContent = msg.message;

  const timeDiv = document.createElement("div");
  timeDiv.className = "chat-message-time";
  const msgTime = typeof msg.timestamp === "string" ? new Date(msg.timestamp) : msg.timestamp;
  timeDiv.textContent = formatChatTime(msgTime);

  messageDiv.appendChild(authorDiv);
  messageDiv.appendChild(textDiv);
  messageDiv.appendChild(timeDiv);

  // Admins can pin/unpin any message
  if (isAdminLoggedIn) {
    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    pinBtn.className = "chat-pin-btn";
    pinBtn.textContent = msg.pinned ? "📌 Unpin" : "📌 Pin";
    pinBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePinMessage(msg);
    });
    messageDiv.appendChild(pinBtn);
  }

  return messageDiv;
}

async function togglePinMessage(msg) {
  try {
    const res = await fetch(`${API_BASE}/admin/chat/messages/${msg.id}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !msg.pinned }),
    });
    if (!res.ok) throw new Error("Failed to update pin");
    msg.pinned = !msg.pinned;
    renderChatMessages();
  } catch (e) {
    console.error("Pin toggle failed:", e);
    alert("Could not update the pin. Please try again.");
  }
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
        author: avatar.title && avatar.emoji !== "🚫"
          ? `${avatar.emoji} ${avatar.title}`
          : "Anonymous",
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

  // Show admin scrolling announcement at top of chat
  displayLiveUpdates();
  
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
    const hlCenter = userLocation ? [userLocation.lat, userLocation.lng] : [MELBOURNE_CBD.lat, MELBOURNE_CBD.lng];
    const hlZoom = userLocation ? 16 : MELBOURNE_CBD.zoom;
    highlightMap = L.map("highlight-map").setView(hlCenter, hlZoom);
    highlightMap.attributionControl.setPrefix(false);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      subdomains: "abcd",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
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
<p>A real-time community layer for Melbourne — see what's happening around you, share what you know, and stay connected with your neighbours.</p>

<h3>Report an Incident</h3>
<p>Spotted something the community should know about? Tap <strong>Report Incident</strong> to pin it on the map. Category and urgency help others filter; description is optional.</p>

<h3>Community Discoveries</h3>
<p>Share quick community tips — a free drinking fountain, a toilet, cheap eats, a parking spot, live music, and more.</p>
<ul>
<li>Tap <strong>Discoveries</strong> or the + button to start sharing</li>
<li>Choose a category, add a photo, and confirm the location in a few taps</li>
</ul>

<h3>Your Avatar</h3>
<p>Tap the emoji button in the top-right corner to pick an animal avatar and set a title. Your emoji will appear on the map at your location so others can see you — tap any emoji marker to see their name.</p>

<h3>Group Chat</h3>
<p>Tap the active users badge in Live Updates to open the community group chat. Your avatar title appears as your name. Messages clear every 24 hours.</p>

<h3>Map Tips</h3>
<ul>
<li>Tap the crosshair button to centre the map on your location</li>
<li>Swipe up on the map to collapse the header for a fullscreen view</li>
<li>Tap coloured street segments to read admin context notes</li>
</ul>

<h3>Install as an App</h3>
<p>Tap Share → Add to Home Screen (iOS) or Install App (Android/Chrome) for a native-app feel with offline support.</p>

<p style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid rgba(255,255,255,0.1);font-size:0.8rem;opacity:0.55;">In an emergency, always call <strong>000</strong> first. This app is for community awareness only — not an official emergency service.</p>`;
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
        <p style="font-size: 0.8125rem; color: var(--ui-muted); margin-bottom: 0.75rem;">
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
<p>Your friendly neighbourhood map for staying informed and helping each other out around Melbourne.</p>

<h3>🚨 Report Incidents</h3>
<p>Spotted something the community should know about? Tap <strong>Report Incident</strong> to flag it on the map. Description is optional — share as much or as little as you like.</p>

<h3>📍 Community Discoveries</h3>
<p>Share quick tips with your neighbours — where the nearest toilet is, a coffee deal, a busker worth checking out, and more. Tap <strong>Discoveries</strong> or the <strong>+</strong> button to get started.</p>

<h3>🗺️ Map Tricks</h3>
<ul>
<li>Tap the blue crosshair button to centre the map on your current location</li>
<li>Swipe up anywhere to hide the header for a fullscreen map view — tap the minimise button to bring it back</li>
<li>Streets highlighted by admins flag helpful context like poor lighting or crowded areas</li>
</ul>

<h3>💬 Live Updates & Community Chat</h3>
<p>Tap the active users badge in the Live Updates banner to drop into the community group chat. Messages clear every 24 hours.</p>

<h3>📲 Install on your home screen</h3>
<p>For the full experience, add this app to your home screen — it opens like a native app, no browser bars.</p>

<p style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--ui-border); font-size: 0.85rem; color: var(--ui-muted);">In an emergency, always call <strong>000</strong> first. This app is for community awareness only.</p>`;
  
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

function openActionSheet() {
  const overlay = document.getElementById("action-sheet-overlay");
  const fab = document.getElementById("fab-button");
  if (overlay) { overlay.classList.remove("hidden"); overlay.setAttribute("aria-hidden", "false"); }
  if (fab) fab.classList.add("fab-open");
}

function closeActionSheet() {
  const overlay = document.getElementById("action-sheet-overlay");
  const fab = document.getElementById("fab-button");
  if (overlay) { overlay.classList.add("hidden"); overlay.setAttribute("aria-hidden", "true"); }
  if (fab) fab.classList.remove("fab-open");
}

function initFab() {
  const fab = document.getElementById("fab-button");
  if (fab) fab.addEventListener("click", openActionSheet);

  const backdrop = document.getElementById("action-sheet-backdrop");
  if (backdrop) backdrop.addEventListener("click", closeActionSheet);

  const cancelBtn = document.getElementById("action-sheet-cancel");
  if (cancelBtn) cancelBtn.addEventListener("click", closeActionSheet);

  const reportBtn = document.getElementById("action-report-btn");
  if (reportBtn) {
    reportBtn.addEventListener("click", () => {
      closeActionSheet();
      setTimeout(() => openReportModal(), 100);
    });
  }

  const discoveryBtn = document.getElementById("action-discovery-btn");
  if (discoveryBtn) {
    discoveryBtn.addEventListener("click", () => {
      closeActionSheet();
      setTimeout(() => openStreetNoteModal(), 100);
    });
  }

  const emergencyBtn = document.getElementById("action-emergency-btn");
  if (emergencyBtn) {
    let emgPressTimer = null;
    let emgLongPressed = false;
    const clearPress = () => { if (emgPressTimer) { clearTimeout(emgPressTimer); emgPressTimer = null; } };
    // Press-and-hold to edit the saved contact
    emergencyBtn.addEventListener("pointerdown", () => {
      emgLongPressed = false;
      emgPressTimer = setTimeout(() => {
        emgLongPressed = true;
        closeActionSheet();
        openEmergencyModal(true);
      }, 600);
    });
    emergencyBtn.addEventListener("pointerup", clearPress);
    emergencyBtn.addEventListener("pointerleave", clearPress);
    emergencyBtn.addEventListener("pointercancel", clearPress);

    emergencyBtn.addEventListener("click", () => {
      if (emgLongPressed) { emgLongPressed = false; return; }
      clearPress();
      closeActionSheet();
      const contact = getEmergencyContact();
      if (contact && contact.number) {
        // Already set → dial straight away
        window.location.href = "tel:" + contact.number.replace(/[^0-9+]/g, "");
      } else {
        // First use → set it up
        setTimeout(() => openEmergencyModal(false), 100);
      }
    });
  }
}

const EMERGENCY_CONTACT_KEY = "emergencyContact_v1";

function getEmergencyContact() {
  try {
    const raw = localStorage.getItem(EMERGENCY_CONTACT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.number ? parsed : null;
  } catch { return null; }
}

function saveEmergencyContact(contact) {
  try { localStorage.setItem(EMERGENCY_CONTACT_KEY, JSON.stringify(contact)); }
  catch (e) { console.error("Failed to save emergency contact:", e); }
}

function openEmergencyModal(forceSetup) {
  const modal = document.getElementById("emergency-contact-modal");
  if (!modal) return;
  const contact = getEmergencyContact();
  const setup = document.getElementById("emergency-setup");
  const saved = document.getElementById("emergency-saved");
  const title = document.getElementById("emergency-title");

  if (contact && !forceSetup) {
    setup.style.display = "none";
    saved.style.display = "";
    title.textContent = "Emergency contact";
    document.getElementById("emergency-saved-name").textContent = contact.name || "My contact";
    document.getElementById("emergency-saved-number").textContent = contact.number;
    const callBtn = document.getElementById("emergency-call-btn");
    if (callBtn) callBtn.href = "tel:" + contact.number.replace(/[^0-9+]/g, "");
  } else {
    setup.style.display = "";
    saved.style.display = "none";
    title.textContent = contact ? "Edit emergency contact" : "Set emergency contact";
    document.getElementById("emergency-name").value = contact ? (contact.name || "") : "";
    document.getElementById("emergency-number").value = contact ? (contact.number || "") : "";
  }

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function initEmergencyContact() {
  const modal = document.getElementById("emergency-contact-modal");
  if (!modal) return;
  const close = () => {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  };
  document.getElementById("emergency-close")?.addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  document.getElementById("emergency-save")?.addEventListener("click", () => {
    const name = document.getElementById("emergency-name").value.trim();
    const number = document.getElementById("emergency-number").value.trim();
    if (!number) { alert("Please enter a phone number."); return; }
    saveEmergencyContact({ name, number });
    openEmergencyModal(false); // show saved view with Call now
  });

  document.getElementById("emergency-edit-btn")?.addEventListener("click", () => openEmergencyModal(true));
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

async function waitForBackend() {
  const overlay = document.getElementById('loading-overlay');
  const msgEl = document.getElementById('loading-message');
  const FAST_TIMEOUT = 2500;

  const ping = (timeout) =>
    Promise.race([
      fetch(`${API_BASE}/`, { method: 'GET', cache: 'no-store' }).then(r => r.ok),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout))
    ]);

  try {
    await ping(FAST_TIMEOUT);
    return;
  } catch (_) {
    // Backend is slow/sleeping — show the loading overlay
  }

  overlay.style.display = 'flex';

  const messages = [
    'Waking up the server...',
    'Server is starting up, hang tight...',
    'Almost there, loading data...',
    'Still warming up, just a moment...',
  ];
  let attempt = 0;

  while (true) {
    if (msgEl) msgEl.textContent = messages[Math.min(attempt, messages.length - 1)];
    attempt++;
    try {
      await ping(5000);
      break;
    } catch (_) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  if (msgEl) msgEl.textContent = 'Ready!';
  overlay.classList.add('fade-out');
  setTimeout(() => { overlay.style.display = 'none'; }, 600);
}

window.addEventListener("DOMContentLoaded", async () => {
  loadUserReactions();

  initMap();
  initLocationMap();
  initViewControls();
  initFilters();
  initLayersSheet();
  initMapHeader();
  initLocateButton();
  initModalsAndButtons();
  initAdminModal();
  initAvatarPicker();
  setupEditForm();
  initFab();
  initChat();
  initEmergencyContact();
  initHighlightStreetModal();
  initStreetNoteModal();
  initPeerBroadcasting();

  await waitForBackend();

  await fetchLiveUpdates();

  try {
    await fetchIncidents();
    await fetchAdminStreetHighlights();
    await checkAndShowWelcomeNotice();
  } catch (e) {
    console.error(e);
  }

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
      userLocation = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      };
      if (map) map.setView([userLocation.lat, userLocation.lng], 16);
      if (locationMap) locationMap.setView([userLocation.lat, userLocation.lng], 16);
      updateUserMarkers();
      checkNearbyAlerts();
      updateActiveUsersCount();
      broadcastOwnLocation();
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


