# Melbourne Community Map

A community-driven safety and awareness web app for Melbourne. Users can report incidents, drop short-lived street notes, see official drinking fountains and public toilets, pick an emoji avatar that appears on the map live, chat in real time, and admins can highlight street segments with context. Installable as a PWA on mobile and desktop.

> **Live stack:** static frontend on **Netlify** · FastAPI backend on **Render** · **MongoDB Atlas** for data · **Leaflet + CARTO Voyager** for the map · **Leaflet.markercluster** for pin grouping · GitHub auto-deploy on push to `main`.

**Tagline:** *see it, post it, sort it*

## Recent improvements

- Added a **Now Bar** at the top of the map — a rotating stack of contextual notification cards built on the existing Emergency banner (see [Now Bar](#now-bar--rotating-notifications)). One card shows at a time with the next peeking beneath; auto-rotates, swipeable, and works on phone + desktop.
- Added a **content flagging & moderation** system (see [Flagging & moderation](#flagging--moderation)). Anyone can flag a misleading/wrong/abusive incident, street note, or chat message; admins review a queue and can **delete reports or street highlights by tapping them directly on the map**.
- **Security & robustness hardening** — separated the public *flag content* flow from the *Report Incident* wizard (they previously collided on one function name), routed all moderation through the JWT-protected admin API, and kept reported-content previews injection-safe (`textContent`/DOM, never `innerHTML`).
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
- **Now Bar** — A rotating notification pill at the top of the map (see [Now Bar](#now-bar--rotating-notifications)). Surfaces Emergency, Incident summary, Highlighted streets, Community activity, and a Tutorial card.
- **Flag content** — Flag any incident, street note, or chat message as misleading, wrong, or abusive for moderator review (see [Flagging & moderation](#flagging--moderation)). Separate from posting a new incident.
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

### Now Bar — rotating notifications

The static Emergency banner is now the first card in a **Now Bar**: a vertically-rotating stack of contextual notification cards at the top of the map. The Emergency banner is treated as the base component, so every card inherits its exact radius, shadow, height, and typography — only the accent gradient changes per type. The design matches the Community Map glass UI (Samsung-style "peek", no arrows or pagination dots).

- **Behaviour** — One card is fully visible; the next **peeks ~8%** beneath it as the only "there's more" cue. Auto-rotates every **5 seconds** when idle, pauses on interaction, and supports **vertical swipe** to browse. Honours `prefers-reduced-motion` and pauses while the tab is hidden.
- **Cards (in order)** — Emergency → Incidents nearby → Highlighted streets → Community online → Tutorial. Each card is tappable and runs an action:
  - **Emergency** → dials `tel:000`.
  - **Incidents nearby** → opens the list view (count is live from the incidents feed).
  - **Highlighted streets** → zooms the map to the CBD street highlights.
  - **Community online** → opens community chat (count is live from active-user presence).
  - **Tutorial** → opens a short walkthrough video; the card always stays in the rotation (last position). Completion is remembered in `localStorage` (`tutorialCompleted`) and mirrored to the user profile when available.
- **Cross-platform** — The same component renders on phone and desktop (it lives inside the shared top overlay), feeling native on both iOS and Android.

### Flagging & moderation

A community **content-flagging** system, kept deliberately separate from the *Report Incident* wizard. Anyone can flag a piece of content as misleading, wrong, or abusive; flags land in an admin-only moderation queue.

- **What can be flagged** — incidents (map pins), street notes, and chat messages.
- **User flow** — Tap a pin → **🚩 Flag as misleading or wrong** (or the ⚑ control on notes/chat) → choose a reason (spam, harassment, violence, sexual, hate, shares private info, false/misleading, other) → optional details → submit. Posts to `POST /api/reports`; rate-limited per IP.
- **Admin review** — Only visible when logged in. The dashboard shows a **🚩 Reported content (N)** queue with an injection-safe preview of each item and **Dismiss / Hide / Unhide / Delete** actions. *Hide* removes content from public views (`hidden` flag) without deleting it; *Delete* removes it permanently.
- **Tap-to-moderate on the map** — When logged in as admin, tapping a **pin** shows **🗑 Delete this report**, and tapping a **street highlight** shows **🗑 Delete highlight** — no need to open the dashboard.

**Data model:** flags are stored in a `content_reports` collection (`target_type`, `target_id`, `reason`, `details`, `status` open/actioned/dismissed, `resolution`, timestamps). Hidden content carries a `hidden: true` flag on its own document and is filtered out of all public `GET` endpoints.

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
- **Review flagged content** — a moderation queue with Dismiss / Hide / Unhide / Delete (see [Flagging & moderation](#flagging--moderation)).
- **Tap-to-moderate** — delete a report or street highlight by tapping it directly on the map.
- Edit live-updates banner and welcome notice.
- Dashboard for incidents, highlights, notes, and reports.

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
# Local dev only. ENVIRONMENT=development relaxes the production guard so the
# app can boot with an ephemeral JWT secret and the default admin PIN.
# In production (the default if ENVIRONMENT is unset) the app FAILS CLOSED and
# refuses to start without a real ADMIN_JWT_SECRET and a non-default ADMIN_PIN.
ENVIRONMENT=development
MONGO_URL=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?appName=Cluster0
DB_NAME=community_map
# Comma-separated allowlist of browser origins. NEVER use "*" in production —
# CORS only constrains browsers, not curl/bots, so keep it tight regardless.
CORS_ORIGINS=https://commap.netlify.app,http://localhost:5173,http://127.0.0.1:5173
ADMIN_ACCOUNT=admin
ADMIN_PIN=change-me
# Required in production: signs the admin session JWT returned by /admin/verify.
# Generate with: python -c "import secrets; print(secrets.token_urlsafe(48))"
ADMIN_JWT_SECRET=replace-with-a-long-random-secret
ADMIN_TOKEN_TTL_HOURS=12
# Trusted reverse-proxy hops for client-IP resolution in rate limiting.
# Render = 1 (real client IP is the LAST X-Forwarded-For entry). 0 = no proxy.
TRUSTED_PROXY_HOPS=1
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
| POST | `/api/reports` | Flag content for moderation (incident / note / chat) |
| GET | `/api/welcome-notice` | Welcome popup HTML |
| POST | `/api/peers` | Upsert live avatar location |
| GET | `/api/peers` | List active peers (60s TTL) |
| DELETE | `/api/peers/{peer_id}` | Remove peer (e.g. go anonymous) |

### Admin (after `/api/admin/verify`)

`POST /api/admin/verify` returns a short-lived signed JWT (`token`). Every
`/api/admin/*` route is protected server-side by `Depends(require_admin)` and
requires that token as `Authorization: Bearer <token>`. The frontend stores it
in `sessionStorage` and attaches it via the `adminFetch()` wrapper; a 401
transparently logs the admin out.

Protected: incidents CRUD, live-updates, street-highlights CRUD, street-notes
delete, welcome-notice update, chat pin, and **moderation**:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/reports?status=open` | Moderation queue with content previews + open count |
| POST | `/api/admin/reports/{id}/action` | Resolve a flag: `dismiss` / `hide` / `unhide` / `delete` |
| DELETE | `/api/admin/incidents/{id}` | Delete a report (used by tap-to-moderate) |
| DELETE | `/api/admin/street-highlights/{id}` | Delete a highlight (used by tap-to-moderate) |

### Security hardening (Phase 0)

- **Auth** — all `/admin/*` routes require a valid admin JWT (not just the old
  client-side check). PIN check uses constant-time comparison.
- **Fail-closed config** — `ENVIRONMENT` defaults to `production`; in production
  the app refuses to boot if `ADMIN_JWT_SECRET` is missing or if `ADMIN_PIN` is
  unset, the well-known default, or shorter than 6 chars. Set
  `ENVIRONMENT=development` locally to relax this.
- **Trustworthy client IP** — rate limiting reads the client IP from the
  trusted (right-hand) side of `X-Forwarded-For` based on `TRUSTED_PROXY_HOPS`
  (1 on Render), so attackers can't rotate a spoofed leftmost value to dodge
  per-IP limits.
- **Stored XSS** — frontend escapes all untrusted text via `escapeHtml()`,
  validates URLs via `safeUrl()`, and sanitizes admin-authored HTML (welcome
  notice) with DOMPurify (vendored at `frontend/vendor/purify.min.js`).
- **Rate limits** — in-memory per-IP sliding windows on `/admin/verify`,
  `/incidents`, `/street-notes`, `/chat/messages`, `/geocode`, `/peers`,
  reactions and heartbeat.
- **CORS** — restricted to the real frontend origins; credentials disabled if a
  wildcard origin is ever configured.
- **Validation** — Pydantic validators enforce category/urgency/colour enums,
  lat/lng ranges, text lengths, and safe image-URL schemes.
- **Headers** — backend sends `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy` and a locked-down CSP; Netlify
  `_headers` ships a strict CSP for the static site.
- **Content moderation** — community flagging (`/api/reports`) feeds an
  admin-only queue; all moderation actions go through JWT-protected `/admin/*`
  routes. *Hidden* content (`hidden: true`) is filtered out of every public
  `GET`, and reported-content previews in the dashboard are rendered with
  `textContent`/DOM nodes (never `innerHTML`) so flagged content can never run.
- **No flag/report confusion** — the public *flag content* modal and the
  *Report Incident* wizard are now distinct functions (`openFlagModal` vs
  `openReportModal`), fixing a name collision that previously routed flags into
  the wrong flow.

### Collections

`incidents` · `street_notes` · `street_highlights` · `chat_messages` · `peers` · `active_users` · `live_updates` · `welcome_notice` · `content_reports` · `migrations`

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
