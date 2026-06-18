# Melbourne Community Map

A community-driven safety and awareness web app for Melbourne. Users can report incidents, drop short-lived street notes, see official drinking fountains and public toilets, pick an emoji avatar that appears on the map live, chat in real time, and admins can highlight street segments with context. Installable as a PWA on mobile and desktop.

> **Live stack:** static frontend on **Netlify** · FastAPI backend on **Render** · **MongoDB Atlas** for data · **Leaflet + CARTO Voyager** for the map · **Leaflet.markercluster** for pin grouping · GitHub auto-deploy on push to `main`.

**Tagline:** *see it, post it, sort it*

## Recent improvements

- Added the **Helping Hand** community mutual-aid flow (see [What the app does](#helping-hand--community-mutual-aid)) — lost pet/kid posts, plus sharing an umbrella, spare charger, or first aid.
- Added a **desktop-specific layout** (≥769px) that keeps the mobile UI minimal while giving large screens more chrome — see [Responsive layout](#responsive-layout-mobile-vs-desktop).
- Added a **presence indicator dot** on the online/chat control: **green** when your avatar + location are visible to others, **red** when you've hidden your avatar (which also turns location sharing off).
- Improved the overall UI design with a more consistent Apple Maps-inspired frosted-glass system, larger touch-friendly controls, and better spacing hierarchy.
- Redesigned key surfaces (map controls, list sheet, and chat presentation) to feel more unified and readable across mobile contexts.
- Fixed dark-mode consistency issues where some surfaces and text could mismatch (especially in embedded third-party in-app browsers), so light/dark now switch coherently.

---

## Table of contents

1. [What the app does](#what-the-app-does)
2. [Map design](#map-design)
3. [Architecture overview](#architecture-overview)
4. [Project structure](#project-structure)
5. [How it is deployed](#how-it-is-deployed)
6. [Local development](#local-development)
7. [Official POI data](#official-poi-data)
8. [Backend reference](#backend-reference)
9. [Frontend reference](#frontend-reference)
10. [Day-to-day workflow](#day-to-day-workflow)
11. [Roadmap](#roadmap)
12. [License & attribution](#license--attribution)

---

## What the app does

### Public users

- **Incidents** — Report protests, theft, harassment, anti-social behaviour, or other events with GPS, address search, or pin-drop. Optional description and photo (client-side compressed). Filter by category, urgency, and time (2h / 4h / 6h).
- **Street notes** — Short community tips (fountain, toilet, coffee, food, parking, music, mood emojis, etc.) with optional image, duration (1 hour – 3 days), or “Keep forever”.
- **Helping Hand** — Community mutual aid posts (see [below](#helping-hand--community-mutual-aid)).
- **Official amenities** — City of Melbourne **drinking fountains** (~302) and **public toilets** (~74) as static reference layers. Toggle on from the map; off by default so the map stays uncluttered.
- **Map + list views** — Interactive map with filterable list. List supports incidents, notes, and official POIs by category.
- **Reactions** — 👍 / 👎 on incidents.
- **Avatar & presence** — Choose an emoji avatar and display title; your marker appears on the map at GPS. Peer locations sync across devices via `/api/peers`. The online/chat control shows a **presence dot** — **green** when your avatar + location are shared, **red** when your avatar is off (🚫), which also stops location sharing.
- **Responsive layout** — Mobile stays deliberately minimal; desktop unlocks a richer layout (see [Responsive layout](#responsive-layout-mobile-vs-desktop)).
- **Group chat** — Anonymous chat linked to the live-updates banner; messages auto-clear after 24 hours.
- **Welcome notice** — Admin-editable popup on load.
- **PWA** — Install to home screen; offline shell via service worker.
- **Theming** — Light and dark mode via `prefers-color-scheme`, with frosted-glass map chrome in both.

### Responsive layout (mobile vs desktop)

The app is a single responsive frontend — the **same** `index.html` / `app.js` / `styles.css` runs everywhere, so every feature is available on both. The layout adapts at a **769px** breakpoint:

- **Mobile (<769px)** — deliberately minimal: floating List / Filter / Layers pills (bottom-left), the compact online pill, and the `+` action button. Nothing extra.
- **Desktop (≥769px)** — a tidy left-hand column adds:
  - A **grouped control panel** anchored top-left: **Map / List** toggle, **All Reports** (filter), **Layers**, **Street Notes**, and **Report Incident** — all wired to the same handlers as mobile.
  - A **Live Updates** ticker plus a full **"N people active on the map, tap to chat"** button (carrying the same green/red presence dot).
  - The **Street Highlights legend** in the **top-right** corner.

  The redundant mobile pills and compact online pill are hidden on desktop. The mobile experience is untouched (all desktop-only chrome lives inside a `@media (min-width: 769px)` block).

### Helping Hand — community mutual aid

A third posting flow that sits **parallel to "Report Incident" and "Share Discovery."** Tapping the **+** button and choosing **Share Discovery** opens a fork screen:

- **📝 Leave a Street Note** — the classic short-lived community tip.
- **🖐 Need a Helping Hand** — ask the community for help or share something.

Helping Hand posts reuse the Street Note experience (optional photo, optional description, the same **"how long should this last"** duration slider, default **12 hours**) and ride under the existing **Discoveries** map layer.

**Categories:** 🐶 Dog · 🐱 Cat · 🐾 Lost Pet · 👩‍👦 Lost Kid · ☔ Umbrella · 🔋 Spare Charger · 🩹 First Aid.

**Contact & privacy**
- In-app **community chat is the default** contact channel.
- The author chooses whether they can be reached at all ("Let people reach me").
- Phone/email exposure is **opt-in** — leave them blank to be reached via chat only. Personal contact fields are stripped server-side from the public feed unless the author opted in.

**Resolved status (owner toggle)**
- Only the **original poster** can toggle a post's resolved state (and toggle it back off); other users only see the result.
- The wording adapts to the category: **lost** posts (🐾 Lost Pet, 👩‍👦 Lost Kid) use **"Found ✓"**; all other helping types (umbrella, charger, first aid, dog, cat) use **"No longer needed ✓"**.
- A resolved post stays on the map with a green badge (and green pin) until its duration expires; otherwise it simply expires on its timer like any other note.

**Data model:** Helping Hand posts are stored in the existing `street_notes` collection with a `kind: "helping_hand"` discriminator, plus `owner_id`, `contact_name`, `contact_phone`, `contact_email`, `contact_public`, and `resolved`. A `POST /api/street-notes/{id}/resolve` endpoint toggles the resolved status (owner-verified).

> **Planned (deferred) — 000 safety banner.** For **Lost Kid** (and possibly **Lost Pet**) posts we plan to surface a prominent safety banner so the post never substitutes for emergency services:
>
> > ⚠️ If a child is missing right now, call 000 immediately. This post is only to help spread the word.
>
> This is intentionally **not implemented yet** and reserved for a future release.

### Admins (tap the **M** logo 10 times)

- Edit / delete incidents (including verified contact info).
- Draw **street highlights** (two pins, colour, reason, description).
- Delete any street note (including permanent).
- Edit live-updates banner and welcome notice.
- Dashboard for incidents, highlights, and notes.

### Background behaviour

- Incidents older than **6 hours** auto-purge on fetch.
- Chat messages older than **24 hours** auto-purge.
- Street notes expire per `expires_at` (unless `forever`).
- Peer markers drop off after **60 seconds** without a heartbeat.
- Content migrations run on backend startup when shipped defaults change.

---

## Map design

The map is the primary surface. Layers stack as follows:

```
┌─────────────────────────────────────────────────────────────┐
│  CARTO Voyager basemap                                      │
├─────────────────────────────────────────────────────────────┤
│  Admin street highlights (polylines, bottom-left legend)    │
├─────────────────────────────────────────────────────────────┤
│  Incidents (emoji pins, urgency colour) — always on         │
│  Street notes (emoji pins) — toggle: Notes                  │
│  Drinking fountains 💧 (official) — toggle: Fountains       │
│  Public toilets 🚽 (official) — toggle: WC                  │
│  Peer avatars (other users + self)                          │
└─────────────────────────────────────────────────────────────┘
```

### Marker clustering

All pin layers use **Leaflet.markercluster** when zoomed out:

| Layer | Cluster colour | Individual pin |
|-------|----------------|----------------|
| Incidents | Red | Category emoji on urgency background |
| Street notes | Blue | Note emoji |
| Drinking fountains | Blue | 💧 on light-blue circle |
| Public toilets | Purple | 🚽 on light-purple circle |

Clusters show a **count**. Zoom in (clustering disables at zoom **17**) or tap a cluster to expand. Spiderfy at max zoom when pins overlap.

### Map controls (bottom-right)

Compact **text toggles** (no switch widgets), stacked vertically:

1. **Notes** — on by default  
2. **Fountains** — off by default  
3. **WC** — off by default  

Active = bold text; inactive = faded. Positioned above the OpenStreetMap / CARTO attribution to reduce overlap.

Other controls: zoom (+/−), locate-me (top-left), street-highlights legend (bottom-left), exit-fullscreen on mobile when header is collapsed.

### List view filters

- **Incidents only** / **All (Incidents + Notes)** / per-category filters.
- **💧 Drinking fountain** and **🚽 Toilet** street notes are **hidden** in “All” and “All Street Notes” aggregates — select those categories explicitly to see user tips *and* official POIs.
- Official fountains and toilets appear in list only when the matching note category is selected.

---

## Architecture overview

```
                ┌────────────────────────────────────────────┐
                │            User's browser / PWA            │
                │  index.html · app.js · styles.css · sw.js  │
                │  + /data/*.json (official POIs, static)    │
                └──────────────┬─────────────────────────────┘
                               │   HTTPS (CORS)
                               ▼
        ┌────────────────────────────────────────────────────┐
        │  Netlify                                           │
        │  Publishes frontend/ · auto-deploy on push         │
        └──────────────┬─────────────────────────────────────┘
                       │  fetch() → /api/*
                       ▼
        ┌────────────────────────────────────────────────────┐
        │  Render.com                                        │
        │  FastAPI (backend/server.py) · uvicorn             │
        │  Cold-start overlay if first ping is slow          │
        └──────────────┬─────────────────────────────────────┘
                       │  Motor (mongodb+srv://)
                       ▼
        ┌────────────────────────────────────────────────────┐
        │  MongoDB Atlas (M0)                                │
        │  incidents · street_notes · street_highlights ·    │
        │  chat_messages · peers · active_users · …          │
        └────────────────────────────────────────────────────┘

        Map tiles:     CARTO Voyager (no API key)
        Clustering:    leaflet.markercluster (CDN)
        Geocoding:     OpenStreetMap Nominatim
        Official POIs: City of Melbourne open data → JSON in repo
```

| Concern | Choice | Why |
|---------|--------|-----|
| Frontend | Vanilla JS, no build step | Simple Netlify deploys |
| Map | Leaflet + markercluster | Free, mature, clusters dense POIs |
| Tiles | CARTO Voyager | Clean look, retina, no key |
| API | FastAPI + Motor | Async, typed, `/docs` |
| Official POIs | Static JSON + scripts | Fast map load; refreshable from council data |

---

## Project structure

```
EmergentApp1/
├── backend/
│   ├── server.py              # FastAPI routes, models, DB logic
│   ├── requirements.txt
│   └── .env                   # gitignored — MONGO_URL, ADMIN_PIN, …
│
├── frontend/
│   ├── index.html             # App shell, modals, PWA meta, CDN scripts
│   ├── app.js                 # Map, list, API, clustering, layers
│   ├── styles.css             # UI + light/dark tokens + map chrome
│   ├── manifest.json
│   ├── sw.js
│   ├── _headers
│   ├── icons/
│   ├── data/
│   │   ├── melbourne-drinking-fountains.json   # ~302 fountains
│   │   ├── melbourne-public-toilets.json       # ~74 toilets
│   │   └── public-toilets-source.csv           # rebuild source
│   ├── privacy.html · terms.html · support.html
│
├── scripts/
│   ├── build_drinking_fountains.py   # API → JSON
│   └── build_public_toilets.py       # CSV → JSON
│
├── store/                     # PWA / Play Store audit notes
├── netlify.toml
├── render.yaml
├── DEPLOYMENT.md
└── README.md
```

---

## How it is deployed

1. **GitHub** — `main` is source of truth.
2. **Netlify** — publishes `frontend/` on every push to `main` (no build command).
3. **Render** — `pip install -r backend/requirements.txt`, then `uvicorn server:app --host 0.0.0.0 --port $PORT`.
4. **MongoDB Atlas** — `community_map` database; network `0.0.0.0/0` on free tier.

```bash
git add .
git commit -m "feat: your change"
git push origin main
# Netlify + Render rebuild in parallel
```

Hard-refresh (Ctrl+Shift+R) or bump `CACHE_NAME` in `sw.js` after deploys.

**Snapshot branches** (e.g. `snapshot/map-fountains-wc-clustering`) can be used to freeze a release without touching `main`.

---

## Local development

### Prerequisites

- Python 3.11+
- MongoDB Atlas connection string

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1          # Windows PowerShell
pip install -r requirements.txt
```

`backend/.env`:

```env
MONGO_URL=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?appName=Cluster0
DB_NAME=community_map
CORS_ORIGINS=*
ADMIN_ACCOUNT=admin
ADMIN_PIN=123456
```

```bash
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

API docs: `http://localhost:8000/docs`

### Frontend

`app.js` uses `http://localhost:8000/api` when hostname is `localhost` or `127.0.0.1`.

```bash
cd frontend
python -m http.server 5173
```

Open `http://localhost:5173`.

> **PWA tip:** Unregister the service worker in DevTools if cached assets block your changes.

---

## Official POI data

| Dataset | Count | Source | Rebuild |
|---------|-------|--------|---------|
| Drinking fountains | ~302 | [City of Melbourne open data](https://data.melbourne.vic.gov.au/explore/dataset/drinking-fountains) | `python scripts/build_drinking_fountains.py` |
| Public toilets | ~74 | `frontend/data/public-toilets-source.csv` | `python scripts/build_public_toilets.py` |

Output JSON lives in `frontend/data/` and is served statically by Netlify. Toilet records include female / male / wheelchair / baby-change flags shown in map popups.

After rebuilding, commit the updated JSON and push.

---

## Backend reference

All routes under `/api`. Interactive docs at `/docs`.

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/` | Health check |
| POST | `/api/geocode` | Nominatim geocoding |
| GET | `/api/incidents?hours=` | List incidents (purges > 6h) |
| POST | `/api/incidents` | Create incident |
| POST | `/api/incidents/{id}/react` | 👍 / 👎 |
| POST | `/api/users/heartbeat/{session_id}` | Active-user count |
| GET/POST | `/api/chat/messages` | Group chat |
| GET | `/api/live-updates` | Banner text |
| GET | `/api/street-highlights` | Admin polylines |
| GET/POST | `/api/street-notes` | Community tips |
| GET | `/api/welcome-notice` | Welcome popup HTML |
| POST | `/api/peers` | Upsert live avatar location |
| GET | `/api/peers` | List active peers (60s TTL) |
| DELETE | `/api/peers/{peer_id}` | Remove peer (e.g. go anonymous) |

### Admin (after `/api/admin/verify`)

Incidents CRUD, live-updates, street-highlights CRUD, street-notes delete, welcome-notice update.

### Collections

`incidents` · `street_notes` · `street_highlights` · `chat_messages` · `peers` · `active_users` · `live_updates` · `welcome_notice` · `migrations`

---

## Frontend reference

| Topic | Implementation |
|-------|----------------|
| API base | `API_BASE` in `app.js` — localhost vs `community-map.onrender.com` |
| Clustering | `createMarkerClusterGroup()` — shared options, per-layer CSS class |
| Layer toggles | `addNotesToggle()` — `showStreetNotes`, `showCityFountains`, `showCityToilets` |
| List filtering | `getListFilterState()`, `LIST_UTILITY_NOTE_EMOJIS` for 💧/🚽 in aggregates |
| Theme | CSS variables + `@media (prefers-color-scheme: dark)` |
| Images | Canvas resize/compress before base64 upload |
| Cold start | Loading overlay if backend > ~1s |
| PWA | `manifest.json` + `sw.js` network-first for `/api` |

---

## Day-to-day workflow

```bash
git pull origin main
git checkout -b feat/your-feature
# edit, test locally
git add .
git commit -m "feat: short description"
git push -u origin feat/your-feature
# merge to main → auto-deploy
```

---

## Roadmap

### Short term

- Tighten `CORS_ORIGINS` to the Netlify domain
- UptimeRobot ping to reduce Render cold starts
- Lighthouse / accessibility pass
- Optional in-app theme toggle (system-only today)

### Medium term

- Web Push for nearby high-urgency incidents (opt-in)
- MongoDB `2dsphere` for server-side geo queries at scale
- User accounts (magic link / OAuth) for editing own posts
- Heatmap mode for incident density

### Intentionally out of scope

- Likes / followers on street notes
- Permanent “safe / unsafe” street ratings
- AI sentiment on user content
- Turn-by-turn navigation

The app is a **community awareness layer**, not a judgement engine.

---

## License & attribution

- **Map tiles:** © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, © [CARTO](https://carto.com/attributions)
- **Geocoding:** OpenStreetMap Nominatim
- **Drinking fountains & public toilets:** [City of Melbourne](https://data.melbourne.vic.gov.au/) open data (CC BY 4.0)
- **Leaflet.markercluster:** MIT
- **Application code:** © project authors. Licence TBD.
