# Melbourne Community Map – MVP

Web-based MVP for a community safety map focused on Melbourne CBD.  
Users can report incidents (protests, theft, harassment, anti-social behaviour), see them on a live map and list, and admins can moderate reports.

---

## Project structure

- `backend/` – FastAPI service with MongoDB for storing incidents and handling clustering, filters, and admin actions.
- `frontend/` – Static web frontend (HTML/CSS/JS) with a modern UI and interactive map (Leaflet + OpenStreetMap).

---

## Backend – FastAPI service

### 1. Environment

Create `backend/.env` with at least:

```env
MONGO_URL=mongodb://localhost:27017
DB_NAME=community_map
CORS_ORIGINS=*
ADMIN_ACCOUNT=admin        # change in real use
ADMIN_PIN=123456          # change in real use
```

Install dependencies (from the project root):

```bash
cd backend
pip install -r requirements.txt
```

### 2. Run the API server

From `backend/`:

```bash
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

Key endpoints (all prefixed with `/api`):

- `GET /api/` – health/message.
- `POST /api/incidents` – create an incident (supports clustering within 500m and marks verified when contact is provided).
- `GET /api/incidents?hours=2|4|6` – list incidents, auto-clearing anything older than 6 hours.
- `POST /api/geocode` – search an address using OpenStreetMap Nominatim.
- `POST /api/admin/verify` – admin login (account + PIN).
- `GET /api/admin/incidents` – full incident list for admins (includes contact details).
- `DELETE /api/admin/incidents/{id}` – delete incident.
- `PUT /api/admin/incidents/{id}` – update incident fields (category, urgency, description, etc.).

---

## Frontend – Web app

The frontend is a static app that talks directly to the FastAPI backend.

### 1. Files

- `frontend/index.html` – main app shell, views, and modals.
- `frontend/styles.css` – modern dark-theme UI with responsive layout.
- `frontend/app.js` – map logic, incident fetching, reporting flow, list view, admin UI, and nearby alert banner.

By default, the frontend expects the API at:

```js
const API_BASE = "http://localhost:8000/api";
```

If you run the backend on a different host/port, change `API_BASE` in `frontend/app.js`.

### 2. Running the frontend

Option A (simple Python static server from `frontend/`):

```bash
cd frontend
python -m http.server 5173
```

Then open `http://localhost:5173` in your browser.

Option B (any static file server):

- Serve the `frontend/` folder with your preferred tool, making sure the browser can access `index.html`, `styles.css`, and `app.js`.

---

## Core user flows (implemented)

- **Map view**
  - Top banner: “Emergency? Call 000 for immediate assistance – Stay Safe – Report incidents, find help, discover local opportunities”.
  - Live Leaflet map centred on Melbourne CBD.
  - Emoji pins with urgency colours:
    - ⚠️ Protest / Rally
    - 💰 Theft / Robbery
    - 🚨 Harassment / Assault / Threats
    - 😡 Anti-social Behaviour
    - ❓ Other
  - Clicking a pin opens a detail modal with full info.

- **List view**
  - Time filter: Last 2h, Last 4h, or Last 6h (everything still within the 6 hour window).
  - Category and urgency filters.
  - Each incident card shows category, time ago, description snippet, urgency tag, verified/unverified, and cluster info.

- **Report incident**
  - Use GPS, or type a street name, or click on a mini map and drag the pin to set the exact location.
  - Choose category (including “Anti-social Behaviour”) and urgency (Low, Medium, High).
  - Enter a brief description.
  - Choose between:
    - Verified (email/phone visible only to admins),
    - Anonymous (shown as unverified).
  - Must tick an agreement checkbox before submitting.

- **Nearby alerts (500m)**
  - If user allows location, the app highlights urgent incidents within 500m with an in-app alert banner.

- **Admin dashboard**
  - Login with account + PIN via “Admin Login”.
  - After successful verification:
    - See a list of incidents including contact details.
    - Delete incidents; changes are reflected in the public list/map.

---

## Notes / Next steps

- The backend relies on MongoDB; make sure it is running locally with the connection string in `.env`.
- The app currently uses in-app banners for nearby alerts; you can extend this to use browser notifications.
- You can further enhance the admin dashboard to support full editing (currently deletion + viewer are implemented).  -->
