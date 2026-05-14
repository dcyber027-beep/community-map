# Melbourne Community Map

A community-driven safety awareness web app for Melbourne. Users can report incidents, drop short-lived street notes, chat in real time, and admins can highlight street segments with context. Installable as a PWA on mobile and desktop.

> **Live stack:** static frontend on **Netlify** · FastAPI backend on **Render** · **MongoDB Atlas** for data · **Leaflet + CARTO Voyager** for the map · GitHub-driven auto-deploy on every push to `main`.

---

## Table of contents

1. [What the app does](#what-the-app-does)
2. [Architecture overview](#architecture-overview)
3. [Project structure](#project-structure)
4. [How it is deployed (Netlify + Render + MongoDB)](#how-it-is-deployed-netlify--render--mongodb)
5. [Local development](#local-development)
6. [Backend reference](#backend-reference)
7. [Frontend reference](#frontend-reference)
8. [Day-to-day workflow](#day-to-day-workflow)
9. [Next steps / roadmap](#next-steps--roadmap)

---

## What the app does

**Public users can:**
- See community-reported incidents on an interactive map (Leaflet) and a filterable list.
- Filter by category (Protest, Theft, Harassment, Anti-social, Other), urgency, and time window (2h / 4h / 6h / 24h).
- Report an incident with GPS, address search, or pin-drop on a mini-map. Description is optional. Photos can be attached and are compressed client-side.
- Drop a **Street Note** — a short-lived community tip (water fountain, queue at a cafe, parking, etc.) with an optional emoji shortcut, an optional image, a custom duration slider (1 hour – 3 days), or a "Keep forever" toggle.
- React to incidents (👍 / 👎).
- Join an anonymous community **Group Chat** linked to the live updates banner. Messages auto-clear every 24 hours.
- See a "**Welcome Notice**" popup on every page load (closable, admin-editable).
- Install the site as a **Progressive Web App** with offline shell support and an app icon on the home screen.

**Admins (logged in via account + PIN) can:**
- Edit / delete any incident, including ones submitted with verified contact info.
- **Highlight street segments** with two pin-drops, a colour (Red / Yellow / Green), a reason, and a description. Users tap highlights to read the context.
- Edit or delete street highlights at any time.
- Delete any street note (including "forever" notes).
- Edit the rotating **Live Updates** banner text.
- Edit the **Welcome Notice** popup content.
- View a dashboard with all incidents, highlights, and street notes.

**Background behaviour:**
- Incidents older than 6 hours auto-purge on next fetch.
- Chat messages older than 24 hours auto-purge.
- Non-permanent street notes auto-purge when their `expires_at` passes.
- Active-user heartbeats are recorded server-side to power the "X people active on the map" badge.
- A one-time **content migration** runs on backend startup to refresh the default Live Updates text and Welcome Notice when a new content version is shipped.

---

## Architecture overview

```
                ┌────────────────────────────────────────────┐
                │            User's browser / PWA            │
                │   index.html · app.js · styles.css · sw.js │
                └──────────────┬─────────────────────────────┘
                               │   HTTPS (CORS)
                               ▼
        ┌────────────────────────────────────────────────────┐
        │  Netlify (free tier)                               │
        │  - Serves the static frontend from /frontend       │
        │  - Auto-deploy on push to GitHub main              │
        │  - _headers + netlify.toml for PWA + redirects     │
        └──────────────┬─────────────────────────────────────┘
                       │  fetch() calls to /api/*
                       ▼
        ┌────────────────────────────────────────────────────┐
        │  Render.com (free tier)                            │
        │  - Hosts the FastAPI app (backend/server.py)       │
        │  - Build:  pip install -r backend/requirements.txt │
        │  - Start:  uvicorn server:app --host 0.0.0.0       │
        │            --port $PORT                            │
        │  - Sleeps after 15 min idle (cold-start handled    │
        │    by a friendly "waking up" loading overlay)      │
        │  - Auto-deploy on push to GitHub main              │
        └──────────────┬─────────────────────────────────────┘
                       │  Motor (async driver, mongodb+srv://)
                       ▼
        ┌────────────────────────────────────────────────────┐
        │  MongoDB Atlas (free M0 cluster)                   │
        │  Database: community_map                           │
        │  Collections:                                      │
        │    incidents · active_users · chat_messages       │
        │    live_updates · street_highlights · street_notes │
        │    welcome_notice · migrations                     │
        └────────────────────────────────────────────────────┘

        Map tiles:  CARTO Voyager raster tiles (free, no API key)
        Geocoding:  OpenStreetMap Nominatim (free, attribution required)
```

**Why this stack?**

| Concern              | Choice              | Why                                                                     |
| -------------------- | ------------------- | ----------------------------------------------------------------------- |
| Hosting frontend     | Netlify             | Free tier + auto-deploy from GitHub + global CDN + easy custom headers. |
| Hosting backend      | Render              | Free tier with managed HTTPS + auto-deploy + clean env-var UX.          |
| Database             | MongoDB Atlas (M0)  | Free, fully managed, generous for early-stage apps, easy schema.        |
| API framework        | FastAPI             | Async, fast, Pydantic validation, free OpenAPI docs at `/docs`.         |
| Frontend framework   | None (vanilla JS)   | Zero build step → trivial deploys, fewer moving parts.                  |
| Map library          | Leaflet             | Free, mature, full control, works with any tile source.                 |
| Map tiles            | CARTO Voyager       | Google-Maps-like look, free, no API key, retina-ready, CDN-hosted.      |
| PWA shell            | manifest.json + sw.js | Native-app feel on phones without an App Store release.               |

---

## Project structure

```
EmergentApp1/
├── backend/
│   ├── server.py              # All FastAPI routes, models, and DB logic
│   ├── requirements.txt       # Python dependencies (pinned)
│   └── .env                   # Local secrets (MONGO_URL, ADMIN_PIN, ...) — gitignored
│
├── frontend/                  # Static site root (Netlify publish dir)
│   ├── index.html             # App shell, modals, PWA meta tags
│   ├── app.js                 # All client logic (map, modals, API calls, PWA)
│   ├── styles.css             # Full UI styling, mobile-first, collapsible header
│   ├── manifest.json          # PWA manifest (name, icons, theme, standalone)
│   ├── sw.js                  # Service worker — caches static shell, network-first for /api
│   ├── _headers               # Netlify headers (Service-Worker-Allowed, manifest MIME)
│   └── icons/                 # PWA icons (72, 96, 128, 144, 152, 192, 384, 512 px)
│
├── render.yaml                # Render infra-as-code (services + env vars)
├── netlify.toml               # Netlify build + redirects config
├── DEPLOYMENT.md              # Step-by-step deploy walkthrough
├── MANUAL_DEPLOY.md           # Manual / emergency deploy procedure
├── LEARNING.md                # Curated ChatGPT prompts for learning the stack
└── README.md                  # This file
```

---

## How it is deployed (Netlify + Render + MongoDB)

### 1. Source of truth: GitHub

Both Netlify and Render are connected to the GitHub repository. Every `git push origin main` triggers an automatic rebuild on both platforms in parallel.

### 2. Frontend on Netlify

- **Repo subdirectory published:** `frontend/`
- **Build command:** none (static).
- **Auto-publish:** on push to `main`.
- **Special files:**
  - `netlify.toml` sets the publish folder and SPA-style fallback.
  - `_headers` adds `Service-Worker-Allowed: /` so the PWA service worker can control the whole origin, and sets the correct MIME type for `manifest.json`.
- **HTTPS:** automatic via Let's Encrypt.
- **CDN:** Netlify serves from edge locations worldwide.

### 3. Backend on Render

- **Service type:** Web Service (Python).
- **Build command:** `pip install -r backend/requirements.txt`
- **Start command:** `cd backend && uvicorn server:app --host 0.0.0.0 --port $PORT`
- **Environment variables** (configured in the Render dashboard, never committed):
  - `MONGO_URL` — MongoDB Atlas SRV connection string.
  - `DB_NAME` — `community_map`.
  - `CORS_ORIGINS` — `*` for now (tighten to the Netlify domain later).
  - `ADMIN_ACCOUNT` — admin username.
  - `ADMIN_PIN` — admin PIN.
  - `PYTHON_VERSION` — `3.11.0`.
- **Free-tier behaviour:** the service sleeps after ~15 minutes of inactivity. The frontend handles this gracefully with a "waking up the server" loading overlay (themed branding + animated spinner) that only appears if the first ping is slow.
- **Auto-deploy:** on push to `main`.

### 4. Database on MongoDB Atlas

- **Tier:** free M0 shared cluster.
- **Database:** `community_map`.
- **Driver:** [`motor`](https://motor.readthedocs.io/) — the official async Python driver.
- **Network access:** `0.0.0.0/0` (open) for now, since Render does not publish fixed egress IPs on the free tier. Authentication is enforced via the connection-string credentials.
- **Collections used:**
  | Collection         | Purpose                                                                       |
  | ------------------ | ----------------------------------------------------------------------------- |
  | `incidents`        | All user-reported incidents. Auto-purged after 6 hours.                       |
  | `active_users`     | Heartbeat-based session tracking for the "active on the map" badge.           |
  | `chat_messages`    | Group chat. Auto-purged after 24 hours.                                       |
  | `live_updates`     | Single document holding the admin-editable rotating banner text.              |
  | `street_highlights`| Admin-drawn polyline highlights with colour, reason, and description.         |
  | `street_notes`     | Short-lived community tips. Auto-purged via `expires_at`.                     |
  | `welcome_notice`   | Single document holding the admin-editable welcome popup HTML.                |
  | `migrations`       | Markers for one-time content migrations on backend startup.                   |

### 5. The deploy cycle in practice

```bash
# 1. Make changes locally
git status
git diff

# 2. Stage and commit
git add .
git commit -m "feat: add CARTO Voyager map tiles"

# 3. Push — this triggers BOTH deploys
git push origin main

# 4. Watch the deploys
#    Netlify:  https://app.netlify.com/sites/<your-site>/deploys
#    Render:   https://dashboard.render.com → service → Events / Logs

# 5. Hard-refresh the live site to bust the service worker cache
#    (Ctrl+Shift+R on desktop, or close and reopen the PWA)
```

---

## Local development

### Prerequisites

- Python 3.11+
- A MongoDB Atlas connection string (free M0 cluster is fine)
- PowerShell (Windows) or bash (macOS/Linux)

### Backend

```bash
cd backend

# Create and activate a virtual environment
python -m venv .venv
.venv\Scripts\Activate.ps1     # PowerShell
# source .venv/bin/activate    # bash

pip install -r requirements.txt
```

Create `backend/.env`:

```env
MONGO_URL=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?appName=Cluster0
DB_NAME=community_map
CORS_ORIGINS=*
ADMIN_ACCOUNT=admin
ADMIN_PIN=123456
```

Run the server:

```bash
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

Interactive API docs available at `http://localhost:8000/docs`.

### Frontend

The frontend automatically detects `localhost` and points to `http://localhost:8000/api` (see top of `frontend/app.js`).

```bash
cd frontend
python -m http.server 5173
```

Open `http://localhost:5173`.

> ⚠️ **PWA gotcha during local dev:** the service worker caches aggressively. If a change isn't appearing, open DevTools → Application → Service Workers → **Unregister**, then hard-refresh.

---

## Backend reference

All routes are under `/api`. Full details and try-it-out forms at `/docs` on the running server.

### Public endpoints

| Method | Path                                  | Description                                                      |
| ------ | ------------------------------------- | ---------------------------------------------------------------- |
| GET    | `/api/`                               | Health check.                                                    |
| POST   | `/api/geocode`                        | Geocode an address via OpenStreetMap Nominatim.                  |
| GET    | `/api/incidents?hours=2\|4\|6`        | List recent incidents (auto-purges anything > 6h).               |
| POST   | `/api/incidents`                      | Create an incident; clusters with neighbours within 500 m.       |
| POST   | `/api/incidents/{id}/react`           | Add a 👍 or 👎 reaction.                                          |
| POST   | `/api/users/heartbeat/{session_id}`   | Record a heartbeat → returns active-user count.                  |
| GET    | `/api/chat/messages`                  | Fetch chat messages (auto-purges > 24h).                         |
| POST   | `/api/chat/messages`                  | Post a chat message.                                             |
| GET    | `/api/live-updates`                   | Get the rotating banner content.                                 |
| GET    | `/api/street-highlights`              | List all admin-drawn street highlights.                          |
| GET    | `/api/street-notes`                   | List active street notes (auto-purges expired non-permanent ones). |
| POST   | `/api/street-notes`                   | Create a street note with optional emoji, image, duration, forever flag. |
| GET    | `/api/welcome-notice`                 | Get the welcome popup content.                                   |

### Admin endpoints (require `/api/admin/verify` first)

| Method | Path                                          | Description                              |
| ------ | --------------------------------------------- | ---------------------------------------- |
| POST   | `/api/admin/verify`                           | Verify account + PIN.                    |
| GET    | `/api/admin/incidents`                        | All incidents incl. contact info.        |
| PUT    | `/api/admin/incidents/{id}`                   | Edit incident.                           |
| DELETE | `/api/admin/incidents/{id}`                   | Delete incident.                         |
| POST   | `/api/admin/live-updates`                     | Update banner text.                      |
| POST   | `/api/admin/street-highlights`                | Create a highlight.                      |
| PUT    | `/api/admin/street-highlights/{id}`           | Edit highlight colour / description.     |
| DELETE | `/api/admin/street-highlights/{id}`           | Delete highlight.                        |
| DELETE | `/api/admin/street-notes/{id}`                | Delete any note (incl. permanent).       |
| POST   | `/api/admin/welcome-notice`                   | Update welcome popup content.            |

---

## Frontend reference

The frontend is a single-page vanilla-JS app. Key concepts:

- **`API_BASE`** at the top of `app.js` switches between `localhost:8000` and the deployed Render URL based on hostname.
- **Leaflet** powers the main map, the location-picker mini-map in the report modal, and the highlight-drawing mini-map in the admin modal. All three use **CARTO Voyager** tiles.
- **PWA**: `manifest.json` declares `display: standalone`; `sw.js` precaches the app shell and uses a network-first strategy for `/api/*` so users always see fresh data when online but a usable shell when offline.
- **Collapsible header** on mobile hides the header when scrolling down to maximise map area; an exit-fullscreen button appears in map view.
- **Loading overlay** appears only if the backend takes more than a second to respond (Render cold start), so warm boots feel instant.
- **Welcome notice** shows on every page load (configurable to once-per-session in future).
- **Image uploads** are compressed and resized client-side using `<canvas>` before base64-encoding, to keep payloads small.

---

## Day-to-day workflow

```bash
# Pull latest changes
git pull origin main

# Work in a feature branch (recommended even when solo)
git checkout -b feat/your-feature

# Edit, test locally, then:
git add .
git commit -m "feat: short description"

# Push the branch and open a PR on GitHub
git push -u origin feat/your-feature

# After review/merge to main, Netlify + Render auto-deploy in parallel.
```

Useful one-liners:

```bash
# See what changed since last commit
git diff

# Undo the last commit but keep changes staged
git reset --soft HEAD~1

# Discard local changes to a file
git restore frontend/app.js

# View deploy logs (Render uses gh-flavoured event logs)
# Netlify and Render both have rollback buttons in their dashboards.
```

See `LEARNING.md` for a deeper learning roadmap (git, GitHub, bash, project layout) that transfers to ML/PyTorch and robotics work too.

---

## Next steps / roadmap

### Short term (quality + polish)

- **Tighten CORS** — change `CORS_ORIGINS` from `*` to the exact Netlify domain on Render.
- **Cold-start mitigation** — add a free UptimeRobot ping every 10 minutes so the Render backend rarely sleeps.
- **Service-worker versioning** — bump `CACHE_NAME` on every deploy so users get fresh assets without manual unregister.
- **Error reporting** — add Sentry (free tier) on both frontend and backend.
- **Lighthouse pass** — audit PWA / accessibility / performance and fix the easy wins.

### Medium term (features)

- **Push notifications** — Web Push for nearby high-urgency incidents (opt-in only).
- **User accounts (optional)** — magic-link or OAuth login so contributors can edit their own posts.
- **Better clustering** — use MongoDB geospatial indexes (`2dsphere`) instead of in-memory Haversine for incident clustering at scale.
- **Multi-suburb support** — expand beyond Melbourne CBD with a suburb picker on first launch.
- **Multilingual UI** — i18n scaffold for at least English + simplified Chinese + Vietnamese.
- **Heatmap mode** — toggle between pin view and a density heatmap of recent reports.
- **Verified moderators** — community moderation tier between admin and regular user.

### Long term (platform)

- **Migrate to a paid Render plan** so the backend never sleeps, then drop the loading overlay.
- **Move long-term media to S3/R2** — currently images are base64-encoded; switch to object storage with signed URLs.
- **Background jobs** — promote auto-purge logic from "lazy on next request" to a proper scheduled task (Render cron or a worker dyno).
- **CI pipeline** — GitHub Actions workflow that runs pytest + a JS linter on every PR and blocks merge on failure.
- **Native app shells** — wrap the PWA with Capacitor for proper iOS / Android store presence if user demand warrants it.

### Things explicitly **not** on the roadmap

Per design decisions during development, the app intentionally avoids:

- Likes / followers / comments / popularity / profiles on Street Notes.
- Permanent labels or "safe / unsafe" ratings on streets.
- AI sentiment analysis on user-submitted content.
- Route recommendations or navigation features.

The app is a **community awareness layer**, not a judgement engine. New features should preserve that posture.

---

## License & attribution

- **Map tiles:** © OpenStreetMap contributors, © CARTO
- **Geocoding:** OpenStreetMap Nominatim — usage policy respected (low-volume, attributed)
- **Code:** © project authors. Licence TBD.
