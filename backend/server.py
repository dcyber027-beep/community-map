from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from motor.motor_asyncio import AsyncIOMotorClient
import os
import hashlib
import logging
import secrets
import time
import threading
from collections import defaultdict, deque
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import List, Optional, Deque, Dict, Tuple
import uuid
from datetime import datetime, timezone, timedelta
import math
import jwt

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection. tz_aware=True makes all dates read back as timezone-aware
# UTC datetimes (BSON dates are naive by default), so comparisons against
# datetime.now(timezone.utc) and ISO serialization stay correct.
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url, tz_aware=True)
db = client[os.environ['DB_NAME']]

logger = logging.getLogger(__name__)

# ── Data retention (drives TTL indexes + on-fetch cleanup fallbacks) ──────────
# MongoDB TTL indexes (created in ensure_indexes on startup) delete expired
# documents automatically in the background. The on-fetch deletes are kept as a
# belt-and-braces fallback so data is never stale between TTL sweeps (~60s).
INCIDENT_TTL_SECONDS = 6 * 3600        # incidents auto-expire 6h after creation
CHAT_TTL_HOURS = 24                    # non-pinned chat messages live 24h
ACTIVE_USER_TTL_SECONDS = 120          # "active now" presence window
PEER_TTL_SECONDS = 60                  # live avatar markers expire after 60s

# ── Environment / deployment mode ─────────────────────────────────────────────
# Default to "production" so the app FAILS CLOSED: a misconfigured deploy refuses
# to boot rather than silently running with insecure defaults. For local work,
# set ENVIRONMENT=development in backend/.env.
ENVIRONMENT = os.environ.get("ENVIRONMENT", "production").strip().lower()
IS_PRODUCTION = ENVIRONMENT in ("production", "prod")

# ── Admin credentials ─────────────────────────────────────────────────────────
DEFAULT_ADMIN_ACCOUNT = "admin"
DEFAULT_ADMIN_PIN = "123456"
MIN_ADMIN_PIN_LEN = 6

_raw_admin_account = os.environ.get("ADMIN_ACCOUNT")
_raw_admin_pin = os.environ.get("ADMIN_PIN")
# Dev-convenience fallbacks; the production guard below rejects these.
ADMIN_ACCOUNT = _raw_admin_account or DEFAULT_ADMIN_ACCOUNT
ADMIN_PIN = _raw_admin_pin or DEFAULT_ADMIN_PIN

# ── Admin authentication (signed JWT) ─────────────────────────────────────────
_raw_jwt_secret = os.environ.get("ADMIN_JWT_SECRET")
ADMIN_JWT_SECRET = _raw_jwt_secret
ADMIN_JWT_ALGORITHM = "HS256"
ADMIN_TOKEN_TTL_HOURS = int(os.environ.get("ADMIN_TOKEN_TTL_HOURS", "12"))


def _validate_admin_config() -> None:
    """
    Fail closed in production: refuse to start when the JWT secret is missing or
    the admin credentials are unset / left at their well-known defaults. In
    development we fall back to ephemeral/default values with loud warnings.
    """
    global ADMIN_JWT_SECRET

    problems = []

    if not _raw_jwt_secret:
        if IS_PRODUCTION:
            # Don't fail-closed here: a missing secret should not take the whole
            # API down (that previously bricked report submission, flagging, and
            # admin login on deploys where the dashboard env var wasn't set).
            # Derive a STABLE secret from MONGO_URL (already a deployment secret)
            # so issued admin tokens survive restarts. Strongly prefer setting an
            # explicit ADMIN_JWT_SECRET in the dashboard.
            ADMIN_JWT_SECRET = hashlib.sha256(
                ("admin-jwt-v1:" + mongo_url).encode("utf-8")
            ).hexdigest()
            logger.warning(
                "ADMIN_JWT_SECRET not set; deriving a stable fallback secret from "
                "MONGO_URL. Set ADMIN_JWT_SECRET in the environment for a "
                "dedicated, rotatable secret."
            )
        else:
            ADMIN_JWT_SECRET = secrets.token_urlsafe(48)
            logger.warning(
                "ADMIN_JWT_SECRET not set; using an ephemeral dev secret. "
                "Admin sessions will reset on every restart."
            )

    if IS_PRODUCTION:
        if not _raw_admin_account:
            problems.append("ADMIN_ACCOUNT is not set (required in production).")
        if not _raw_admin_pin:
            problems.append("ADMIN_PIN is not set (required in production).")
        elif _raw_admin_pin == DEFAULT_ADMIN_PIN:
            problems.append(
                "ADMIN_PIN is set to the insecure default '123456'; choose a private value."
            )
        elif len(_raw_admin_pin) < MIN_ADMIN_PIN_LEN:
            problems.append(
                f"ADMIN_PIN must be at least {MIN_ADMIN_PIN_LEN} characters."
            )
    else:
        if ADMIN_PIN == DEFAULT_ADMIN_PIN:
            logger.warning(
                "Using the default admin PIN (development only). "
                "Set ADMIN_ACCOUNT/ADMIN_PIN before deploying to production."
            )

    if problems:
        raise RuntimeError(
            "Refusing to start due to insecure configuration:\n  - "
            + "\n  - ".join(problems)
            + "\n\nSet the required environment variables, or set "
            "ENVIRONMENT=development for local development."
        )


_validate_admin_config()

_bearer_scheme = HTTPBearer(auto_error=False)


def create_admin_token(account: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": account,
        "role": "admin",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=ADMIN_TOKEN_TTL_HOURS)).timestamp()),
    }
    return jwt.encode(payload, ADMIN_JWT_SECRET, algorithm=ADMIN_JWT_ALGORITHM)


async def require_admin(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> str:
    """
    Dependency that enforces a valid admin JWT. Returns the admin account on
    success and raises 401 otherwise. Attach to every /admin/* route.
    """
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Admin authentication required")
    token = credentials.credentials
    try:
        payload = jwt.decode(token, ADMIN_JWT_SECRET, algorithms=[ADMIN_JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Admin session expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid admin token")
    if payload.get("role") != "admin":
        raise HTTPException(status_code=401, detail="Invalid admin token")
    return payload.get("sub", "admin")


# ── Lightweight in-memory rate limiting ───────────────────────────────────────
# Sliding-window limiter keyed by client IP + scope. Suitable for a single
# instance (Render free tier). For multi-instance deployments swap for a Redis
# backed limiter. CORS is NOT a substitute for this — it only constrains
# browsers, not curl/bots/direct API calls.
_rate_lock = threading.Lock()
_rate_store: Dict[Tuple[str, str], Deque[float]] = defaultdict(deque)


# Number of trusted reverse-proxy hops in front of the app. Render's edge
# APPENDS the real client IP as the LAST X-Forwarded-For entry, so we read from
# the RIGHT — the leftmost entries are attacker-controlled and must be ignored.
# Set TRUSTED_PROXY_HOPS=0 to disable XFF trust entirely (use the raw socket
# peer), e.g. when running with no proxy in front.
TRUSTED_PROXY_HOPS = int(os.environ.get("TRUSTED_PROXY_HOPS", "1"))


def _client_ip(request: Request) -> str:
    """
    Resolve the client IP for rate limiting in a way that cannot be bypassed by
    spoofing X-Forwarded-For.

    X-Forwarded-For looks like: "spoofable, spoofable, <real-client>, proxyA".
    Each trusted proxy appends the address it received the connection from, so
    the trustworthy client IP is the Nth entry counting from the END, where N is
    the number of trusted proxy hops. Taking the leftmost value (the old
    behaviour) lets an attacker rotate the header to dodge every per-IP limit.
    """
    peer = request.client.host if request.client else "unknown"
    if TRUSTED_PROXY_HOPS <= 0:
        return peer
    fwd = request.headers.get("x-forwarded-for")
    if not fwd:
        return peer
    parts = [p.strip() for p in fwd.split(",") if p.strip()]
    if len(parts) >= TRUSTED_PROXY_HOPS:
        return parts[-TRUSTED_PROXY_HOPS]
    # Header shorter than the expected proxy chain → it didn't traverse our
    # proxies as expected (possibly spoofed/direct); don't trust it.
    return peer


def rate_limit(scope: str, max_requests: int, window_seconds: int):
    """
    Returns a FastAPI dependency enforcing `max_requests` per `window_seconds`
    per client IP for the given scope.
    """
    async def _dependency(request: Request):
        now = time.monotonic()
        key = (scope, _client_ip(request))
        with _rate_lock:
            bucket = _rate_store[key]
            cutoff = now - window_seconds
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= max_requests:
                retry_after = max(1, int(window_seconds - (now - bucket[0])))
                raise HTTPException(
                    status_code=429,
                    detail="Too many requests. Please slow down.",
                    headers={"Retry-After": str(retry_after)},
                )
            bucket.append(now)
    return _dependency


# ── Security headers middleware ───────────────────────────────────────────────
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Cross-Origin-Resource-Policy", "same-site")
        response.headers.setdefault(
            "Permissions-Policy",
            "geolocation=(), microphone=(), camera=()",
        )
        # API only serves JSON; lock it down hard.
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        )
        return response


# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# ── Validation constants & helpers ────────────────────────────────────────────
ALLOWED_CATEGORIES = {"protest", "theft", "harassment", "antisocial", "other"}
ALLOWED_URGENCY = {"low", "medium", "high"}
MAX_DESCRIPTION_LEN = 500
MAX_IMAGE_URL_LEN = 3_000_000  # base64 data URLs for compressed images
MAX_CONTACT_LEN = 200
MAX_TEXT_NOTE_LEN = 150
MAX_CHAT_LEN = 1000
MAX_LOCATION_TEXT_LEN = 200
MAX_NAME_LEN = 100


def _validate_lat(v: float) -> float:
    if v is None or not (-90.0 <= float(v) <= 90.0):
        raise ValueError("latitude must be between -90 and 90")
    return float(v)


def _validate_lng(v: float) -> float:
    if v is None or not (-180.0 <= float(v) <= 180.0):
        raise ValueError("longitude must be between -180 and 180")
    return float(v)


def _validate_image_url(v: Optional[str]) -> Optional[str]:
    if v is None or v == "":
        return v
    if len(v) > MAX_IMAGE_URL_LEN:
        raise ValueError("image is too large")
    # Only permit safe schemes; reject javascript:, etc.
    lowered = v.strip().lower()
    if not (lowered.startswith("data:image/") or lowered.startswith("https://") or lowered.startswith("http://")):
        raise ValueError("unsupported image url scheme")
    return v


# Define Models
class IncidentCreate(BaseModel):
    category: str  # "protest", "theft", "harassment", "antisocial", "other"
    urgency: str  # "low", "medium", "high"
    description: Optional[str] = ""
    latitude: float
    longitude: float
    image_url: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    is_verified: bool = False

    @field_validator("category")
    @classmethod
    def _check_category(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if v not in ALLOWED_CATEGORIES:
            raise ValueError(f"category must be one of {sorted(ALLOWED_CATEGORIES)}")
        return v

    @field_validator("urgency")
    @classmethod
    def _check_urgency(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if v not in ALLOWED_URGENCY:
            raise ValueError(f"urgency must be one of {sorted(ALLOWED_URGENCY)}")
        return v

    @field_validator("description")
    @classmethod
    def _check_description(cls, v: Optional[str]) -> str:
        v = (v or "").strip()
        if len(v) > MAX_DESCRIPTION_LEN:
            raise ValueError(f"description must be {MAX_DESCRIPTION_LEN} characters or less")
        return v

    @field_validator("latitude")
    @classmethod
    def _check_lat(cls, v: float) -> float:
        return _validate_lat(v)

    @field_validator("longitude")
    @classmethod
    def _check_lng(cls, v: float) -> float:
        return _validate_lng(v)

    @field_validator("image_url")
    @classmethod
    def _check_image(cls, v: Optional[str]) -> Optional[str]:
        return _validate_image_url(v)

    @field_validator("contact_email", "contact_phone")
    @classmethod
    def _check_contact(cls, v: Optional[str]) -> Optional[str]:
        if v and len(v) > MAX_CONTACT_LEN:
            raise ValueError("contact field is too long")
        return v

class Incident(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    category: str
    urgency: str
    description: str
    latitude: float
    longitude: float
    image_url: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    is_verified: bool = False
    cluster_count: int = 1
    like_count: int = 0
    dislike_count: int = 0
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class AdminAuth(BaseModel):
    account: str = Field(min_length=1, max_length=100)
    pin: str = Field(min_length=1, max_length=100)

class AddressSearch(BaseModel):
    address: str = Field(min_length=1, max_length=300)

# Helper function to calculate distance between two coordinates
def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate distance between two coordinates in meters using Haversine formula
    """
    R = 6371000  # Earth's radius in meters
    
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    
    return R * c

@api_router.get("/")
async def root():
    return {"message": "Community Map API"}

@api_router.post(
    "/admin/verify",
    response_model=dict,
    dependencies=[Depends(rate_limit("admin_verify", max_requests=5, window_seconds=60))],
)
async def verify_admin(auth: AdminAuth):
    """
    Verify admin account and PIN. On success returns a short-lived signed JWT
    that the client must send as `Authorization: Bearer <token>` on every
    /admin/* request.
    """
    # Constant-time comparison to avoid leaking length/timing information.
    account_ok = secrets.compare_digest(auth.account, ADMIN_ACCOUNT)
    pin_ok = secrets.compare_digest(auth.pin, ADMIN_PIN)

    if account_ok and pin_ok:
        token = create_admin_token(ADMIN_ACCOUNT)
        return {
            "success": True,
            "message": "Admin verified",
            "token": token,
            "token_type": "bearer",
            "expires_in": ADMIN_TOKEN_TTL_HOURS * 3600,
        }
    raise HTTPException(status_code=401, detail="Invalid account or PIN")

@api_router.post(
    "/geocode",
    response_model=dict,
    dependencies=[Depends(rate_limit("geocode", max_requests=20, window_seconds=60))],
)
async def geocode_address(address_search: AddressSearch):
    """
    Geocode an address using Nominatim (OpenStreetMap)
    """
    import urllib.parse
    import aiohttp
    
    encoded_address = urllib.parse.quote(address_search.address)
    url = f"https://nominatim.openstreetmap.org/search?q={encoded_address}&format=json&limit=5"
    
    headers = {
        'User-Agent': 'CommunityMapApp/1.0'
    }
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as response:
                if response.status == 200:
                    results = await response.json()
                    if results:
                        locations = [{
                            'display_name': result.get('display_name', ''),
                            'latitude': float(result.get('lat', 0)),
                            'longitude': float(result.get('lon', 0))
                        } for result in results]
                        return {"success": True, "locations": locations}
                    else:
                        return {"success": False, "message": "No locations found"}
                else:
                    return {"success": False, "message": "Geocoding service unavailable"}
    except Exception as e:
        logger.error(f"Geocoding error: {str(e)}")
        return {"success": False, "message": "Error searching address"}

@api_router.post(
    "/incidents",
    response_model=Incident,
    dependencies=[Depends(rate_limit("create_incident", max_requests=10, window_seconds=60))],
)
async def create_incident(input: IncidentCreate):
    """
    Create a new incident report with clustering logic
    """
    # Check if contact info is provided
    is_verified = bool(input.contact_email or input.contact_phone)
    
    # Check for nearby incidents (within 500m) with same category
    existing_incidents = await db.incidents.find({
        "category": input.category
    }, {"_id": 0}).to_list(1000)
    
    cluster_count = 1
    for existing in existing_incidents:
        if isinstance(existing['timestamp'], str):
            existing_time = datetime.fromisoformat(existing['timestamp'])
        else:
            existing_time = existing['timestamp']
            
        # Only check incidents from last 6 hours
        if datetime.now(timezone.utc) - existing_time > timedelta(hours=6):
            continue
            
        distance = calculate_distance(
            input.latitude, input.longitude,
            existing['latitude'], existing['longitude']
        )
        
        if distance <= 500:  # Within 500 meters
            cluster_count += 1
    
    incident_dict = input.model_dump()
    incident_dict['is_verified'] = is_verified
    incident_dict['cluster_count'] = cluster_count
    incident_dict['like_count'] = 0
    incident_dict['dislike_count'] = 0
    
    incident_obj = Incident(**incident_dict)

    # Store timestamp as a real BSON date so the TTL index can expire it.
    doc = incident_obj.model_dump()
    _ = await db.incidents.insert_one(doc)
    return incident_obj

@api_router.get("/incidents", response_model=List[Incident])
async def get_incidents(hours: Optional[int] = None):
    """
    Get all incidents with optional time filter
    """
    # Auto-cleanup fallback: remove incidents older than the TTL window. The TTL
    # index normally handles this in the background; this covers the gap between
    # sweeps so the public feed is never stale.
    cutoff_time = datetime.now(timezone.utc) - timedelta(seconds=INCIDENT_TTL_SECONDS)
    await db.incidents.delete_many({
        "timestamp": {"$lt": cutoff_time}
    })
    
    # Exclude MongoDB's _id field and contact info from public results, and hide
    # any content moderators have taken down.
    incidents = await db.incidents.find({"hidden": {"$ne": True}}, {
        "_id": 0,
        "contact_email": 0,
        "contact_phone": 0
    }).to_list(1000)
    
    # Convert ISO string timestamps back to datetime objects and ensure like/dislike counts exist
    for incident in incidents:
        if isinstance(incident['timestamp'], str):
            incident['timestamp'] = datetime.fromisoformat(incident['timestamp'])
        # Ensure like_count and dislike_count exist for backward compatibility
        if 'like_count' not in incident:
            incident['like_count'] = 0
        if 'dislike_count' not in incident:
            incident['dislike_count'] = 0
    
    # Filter by time if specified
    if hours:
        time_filter = datetime.now(timezone.utc) - timedelta(hours=hours)
        incidents = [i for i in incidents if i['timestamp'] >= time_filter]
    
    return incidents

@api_router.get("/admin/incidents", response_model=List[dict])
async def get_admin_incidents(_admin: str = Depends(require_admin)):
    """
    Get all incidents with contact info (admin only)
    """
    incidents = await db.incidents.find({}, {"_id": 0}).to_list(1000)
    
    # Convert ISO string timestamps to ISO strings (not datetime objects) for JSON serialization
    for incident in incidents:
        # Handle timestamp - ensure it's always an ISO string
        if 'timestamp' in incident:
            if isinstance(incident.get('timestamp'), str):
                # Already a string, keep it as is
                pass
            elif isinstance(incident.get('timestamp'), datetime):
                # Convert datetime to ISO string
                incident['timestamp'] = incident['timestamp'].isoformat()
            else:
                # Handle other types (e.g., None)
                incident['timestamp'] = datetime.now(timezone.utc).isoformat()
        else:
            # Missing timestamp, add current time
            incident['timestamp'] = datetime.now(timezone.utc).isoformat()
        
        # Ensure like_count and dislike_count exist for backward compatibility
        if 'like_count' not in incident:
            incident['like_count'] = 0
        if 'dislike_count' not in incident:
            incident['dislike_count'] = 0
    
    # Filter incidents from last 24 hours for admin dashboard
    # (Still return all incidents, but the frontend may want to filter)
    return incidents

@api_router.delete("/admin/incidents/{incident_id}")
async def delete_incident(incident_id: str, _admin: str = Depends(require_admin)):
    """
    Delete an incident (admin only)
    """
    result = await db.incidents.delete_one({"id": incident_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Incident not found")
    
    return {"success": True, "message": "Incident deleted"}

ALLOWED_INCIDENT_UPDATE_FIELDS = {
    "category", "urgency", "description", "is_verified",
    "contact_email", "contact_phone", "image_url", "latitude", "longitude",
}

@api_router.put("/admin/incidents/{incident_id}")
async def update_incident(incident_id: str, update_data: dict, _admin: str = Depends(require_admin)):
    """
    Update an incident (admin only)
    """
    # Whitelist updatable fields and validate constrained ones.
    update_data = {k: v for k, v in update_data.items() if k in ALLOWED_INCIDENT_UPDATE_FIELDS}
    if "category" in update_data:
        cat = str(update_data["category"]).strip().lower()
        if cat not in ALLOWED_CATEGORIES:
            raise HTTPException(status_code=422, detail="Invalid category")
        update_data["category"] = cat
    if "urgency" in update_data:
        urg = str(update_data["urgency"]).strip().lower()
        if urg not in ALLOWED_URGENCY:
            raise HTTPException(status_code=422, detail="Invalid urgency")
        update_data["urgency"] = urg
    if "description" in update_data:
        desc = str(update_data["description"] or "").strip()
        if len(desc) > MAX_DESCRIPTION_LEN:
            raise HTTPException(status_code=422, detail="Description too long")
        update_data["description"] = desc
    if not update_data:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    result = await db.incidents.update_one(
        {"id": incident_id},
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Incident not found")
    
    return {"success": True, "message": "Incident updated"}

class ReactionRequest(BaseModel):
    reaction: str  # "like" or "dislike"

    @field_validator("reaction")
    @classmethod
    def _check_reaction(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if v not in {"like", "dislike"}:
            raise ValueError("reaction must be 'like' or 'dislike'")
        return v

@api_router.post(
    "/incidents/{incident_id}/react",
    dependencies=[Depends(rate_limit("react", max_requests=30, window_seconds=60))],
)
async def react_to_incident(incident_id: str, reaction: ReactionRequest):
    """
    Add a like or dislike to an incident
    """
    if reaction.reaction not in ["like", "dislike"]:
        raise HTTPException(status_code=400, detail="Reaction must be 'like' or 'dislike'")
    
    # Increment the appropriate count
    field = "like_count" if reaction.reaction == "like" else "dislike_count"
    
    result = await db.incidents.update_one(
        {"id": incident_id},
        {"$inc": {field: 1}}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Incident not found")
    
    # Get updated incident to return counts
    updated = await db.incidents.find_one({"id": incident_id}, {"_id": 0})
    if not updated:
        raise HTTPException(status_code=404, detail="Incident not found")
    
    return {
        "success": True,
        "like_count": updated.get("like_count", 0),
        "dislike_count": updated.get("dislike_count", 0)
    }

# Active Users Tracking
@api_router.post(
    "/users/heartbeat/{session_id}",
    dependencies=[Depends(rate_limit("heartbeat", max_requests=60, window_seconds=60))],
)
async def user_heartbeat(session_id: str):
    """
    Track active users viewing the map
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=ACTIVE_USER_TTL_SECONDS)
    
    # Record/update this user's heartbeat as a real BSON date (TTL-indexed).
    await db.active_users.update_one(
        {"session_id": session_id},
        {"$set": {"last_heartbeat": now}},
        upsert=True
    )
    
    # Clean up stale users and count active ones
    await db.active_users.delete_many({"last_heartbeat": {"$lt": cutoff}})
    active_count = await db.active_users.count_documents({"last_heartbeat": {"$gte": cutoff}})
    
    return {
        "success": True,
        "active_count": active_count
    }

# Group Chat Endpoints
class ChatMessageCreate(BaseModel):
    message: str = Field(min_length=1, max_length=MAX_CHAT_LEN)
    author: Optional[str] = "Anonymous"

    @field_validator("message")
    @classmethod
    def _check_message(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("message is required")
        if len(v) > MAX_CHAT_LEN:
            raise ValueError(f"message must be {MAX_CHAT_LEN} characters or less")
        return v

    @field_validator("author")
    @classmethod
    def _check_author(cls, v: Optional[str]) -> str:
        v = (v or "Anonymous").strip() or "Anonymous"
        if len(v) > MAX_NAME_LEN:
            v = v[:MAX_NAME_LEN]
        return v

class ChatMessage(BaseModel):
    id: str
    message: str
    author: str
    timestamp: datetime
    pinned: bool = False

class ChatPinRequest(BaseModel):
    pinned: bool

@api_router.get("/chat/messages")
async def get_chat_messages():
    """
    Get all chat messages (auto-cleanup messages older than 24 hours).
    Pinned messages are kept indefinitely so admins can keep them visible.
    """
    # Auto-cleanup fallback: remove non-pinned messages older than the TTL
    # window. The TTL index on expire_at handles this automatically; this covers
    # the gap between background sweeps.
    cutoff_time = datetime.now(timezone.utc) - timedelta(hours=CHAT_TTL_HOURS)
    await db.chat_messages.delete_many({
        "timestamp": {"$lt": cutoff_time},
        "pinned": {"$ne": True}
    })
    
    # Get all messages (excluding any hidden by moderators)
    messages = await db.chat_messages.find(
        {"hidden": {"$ne": True}}, {"_id": 0, "expire_at": 0}
    ).sort("timestamp", 1).to_list(1000)
    
    # Convert timestamps to ISO strings for JSON serialization
    result = []
    for message in messages:
        msg_dict = dict(message)
        # Keep timestamp as ISO string for frontend
        if isinstance(msg_dict['timestamp'], datetime):
            msg_dict['timestamp'] = msg_dict['timestamp'].isoformat()
        elif isinstance(msg_dict['timestamp'], str):
            msg_dict['timestamp'] = msg_dict['timestamp']
        # Backward compatibility for messages stored before pinning existed
        msg_dict.setdefault('pinned', False)
        result.append(msg_dict)
    
    return result

@api_router.post(
    "/chat/messages",
    dependencies=[Depends(rate_limit("chat", max_requests=20, window_seconds=60))],
)
async def create_chat_message(message_data: ChatMessageCreate):
    """
    Create a new chat message
    """
    message_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    
    # timestamp + expire_at are real BSON dates. expire_at drives the TTL index;
    # pinned messages have it removed so they survive indefinitely.
    message_doc = {
        "id": message_id,
        "message": message_data.message,
        "author": message_data.author or "Anonymous",
        "timestamp": now,
        "expire_at": now + timedelta(hours=CHAT_TTL_HOURS),
        "pinned": False
    }
    
    await db.chat_messages.insert_one(message_doc)
    
    return {
        "success": True,
        "message": {
            "id": message_id,
            "message": message_data.message,
            "author": message_data.author or "Anonymous",
            "timestamp": now.isoformat(),
            "pinned": False
        }
    }

@api_router.post("/admin/chat/messages/{message_id}/pin")
async def pin_chat_message(message_id: str, req: ChatPinRequest, _admin: str = Depends(require_admin)):
    """
    Admin endpoint to pin or unpin a chat message. Pinned messages survive the
    24-hour auto-cleanup and are surfaced at the top of the chat for everyone.
    """
    if req.pinned:
        # Pinned: drop expire_at so the TTL index never removes it.
        update = {"$set": {"pinned": True}, "$unset": {"expire_at": ""}}
    else:
        # Unpinned: restore expiry relative to the original post time.
        existing = await db.chat_messages.find_one({"id": message_id}, {"timestamp": 1})
        ts = existing.get("timestamp") if existing else None
        if isinstance(ts, str):
            try:
                ts = datetime.fromisoformat(ts)
            except ValueError:
                ts = datetime.now(timezone.utc)
        if not isinstance(ts, datetime):
            ts = datetime.now(timezone.utc)
        update = {"$set": {"pinned": False, "expire_at": ts + timedelta(hours=CHAT_TTL_HOURS)}}

    result = await db.chat_messages.update_one({"id": message_id}, update)
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Message not found")
    return {"success": True, "pinned": bool(req.pinned)}

# Live Updates Content Management
@api_router.get("/live-updates")
async def get_live_updates():
    """
    Get the current live updates content
    """
    # Try to get from database, if not found use default
    content = await db.live_updates.find_one({"_id": "content"})
    
    default_content = "📝 NEW: Street Notes with emoji shortcuts 🚽 ☕ 🧋 🅿️ 🎵 — share tips with your neighbours  •  Choose how long your note lasts: 1 hour, 3 days, or forever  •  Tap the blue crosshair to find yourself on the map  •  Add this app to your home screen for a native-app feel  •  Tap the active users badge to chat with the community"
    
    if content:
        return {
            "success": True,
            "content": content.get("text", default_content)
        }
    
    return {
        "success": True,
        "content": default_content
    }

class LiveUpdatesRequest(BaseModel):
    content: str = Field(max_length=5000)

@api_router.post("/admin/live-updates")
async def update_live_updates(update: LiveUpdatesRequest, _admin: str = Depends(require_admin)):
    """
    Admin endpoint to update live updates content
    """
    await db.live_updates.update_one(
        {"_id": "content"},
        {"$set": {"text": update.content, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    
    return {
        "success": True,
        "message": "Live updates content updated",
        "content": update.content
    }

# Admin Street Highlights (persistent, not auto-cleared)
ALLOWED_HIGHLIGHT_COLORS = {"red", "yellow", "green"}
ALLOWED_HIGHLIGHT_REASONS = {"poor_lighting", "crowded", "harassment", "protest", "other"}

class StreetHighlightCreate(BaseModel):
    start_lat: float
    start_lng: float
    end_lat: float
    end_lng: float
    color: str  # "red", "yellow", "green"
    reason: str  # "poor_lighting", "crowded", "harassment", "protest", "other"
    description: Optional[str] = ""

    @field_validator("start_lat", "end_lat")
    @classmethod
    def _check_lat(cls, v: float) -> float:
        return _validate_lat(v)

    @field_validator("start_lng", "end_lng")
    @classmethod
    def _check_lng(cls, v: float) -> float:
        return _validate_lng(v)

    @field_validator("color")
    @classmethod
    def _check_color(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if v not in ALLOWED_HIGHLIGHT_COLORS:
            raise ValueError(f"color must be one of {sorted(ALLOWED_HIGHLIGHT_COLORS)}")
        return v

    @field_validator("reason")
    @classmethod
    def _check_reason(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if v not in ALLOWED_HIGHLIGHT_REASONS:
            raise ValueError(f"reason must be one of {sorted(ALLOWED_HIGHLIGHT_REASONS)}")
        return v

    @field_validator("description")
    @classmethod
    def _check_description(cls, v: Optional[str]) -> str:
        v = (v or "").strip()
        if len(v) > MAX_DESCRIPTION_LEN:
            raise ValueError(f"description must be {MAX_DESCRIPTION_LEN} characters or less")
        return v

class StreetHighlight(BaseModel):
    id: str
    start_lat: float
    start_lng: float
    end_lat: float
    end_lng: float
    color: str
    reason: str
    description: str
    created_at: datetime
    created_by: str = "admin"

@api_router.get("/street-highlights")
async def get_street_highlights():
    """
    Get all admin-created street highlights (persistent, not auto-cleared)
    """
    highlights = await db.street_highlights.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    
    # Convert timestamps
    for highlight in highlights:
        if isinstance(highlight.get('created_at'), str):
            highlight['created_at'] = highlight['created_at']
        elif isinstance(highlight.get('created_at'), datetime):
            highlight['created_at'] = highlight['created_at'].isoformat()
    
    return highlights

@api_router.post("/admin/street-highlights")
async def create_street_highlight(highlight_data: StreetHighlightCreate, _admin: str = Depends(require_admin)):
    """
    Admin endpoint to create a street highlight
    """
    highlight_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    
    highlight_doc = {
        "id": highlight_id,
        "start_lat": highlight_data.start_lat,
        "start_lng": highlight_data.start_lng,
        "end_lat": highlight_data.end_lat,
        "end_lng": highlight_data.end_lng,
        "color": highlight_data.color,
        "reason": highlight_data.reason,
        "description": highlight_data.description or "",
        "created_at": now,
        "created_by": "admin"
    }
    
    await db.street_highlights.insert_one(highlight_doc)
    
    # Serialize for the JSON response (DB keeps the real date).
    highlight_doc.pop("_id", None)
    highlight_doc["created_at"] = now.isoformat()
    return {
        "success": True,
        "highlight": highlight_doc
    }

@api_router.put("/admin/street-highlights/{highlight_id}")
async def update_street_highlight(highlight_id: str, update_data: dict, _admin: str = Depends(require_admin)):
    """
    Admin endpoint to update a street highlight (e.g., change color)
    """
    # Only allow updating certain fields
    allowed_fields = {"color", "reason", "description"}
    update_dict = {k: v for k, v in update_data.items() if k in allowed_fields}

    if "color" in update_dict:
        color = str(update_dict["color"]).strip().lower()
        if color not in ALLOWED_HIGHLIGHT_COLORS:
            raise HTTPException(status_code=422, detail="Invalid color")
        update_dict["color"] = color
    if "reason" in update_dict:
        reason = str(update_dict["reason"]).strip().lower()
        if reason not in ALLOWED_HIGHLIGHT_REASONS:
            raise HTTPException(status_code=422, detail="Invalid reason")
        update_dict["reason"] = reason
    if "description" in update_dict:
        desc = str(update_dict["description"] or "").strip()
        if len(desc) > MAX_DESCRIPTION_LEN:
            raise HTTPException(status_code=422, detail="Description too long")
        update_dict["description"] = desc

    if not update_dict:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    
    result = await db.street_highlights.update_one(
        {"id": highlight_id},
        {"$set": update_dict}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Street highlight not found")
    
    # Return updated highlight
    updated = await db.street_highlights.find_one({"id": highlight_id}, {"_id": 0})
    if updated:
        # Ensure timestamp is ISO string
        if isinstance(updated.get('created_at'), datetime):
            updated['created_at'] = updated['created_at'].isoformat()
        elif isinstance(updated.get('created_at'), str):
            pass  # Already a string
    
    return {"success": True, "highlight": updated}

@api_router.delete("/admin/street-highlights/{highlight_id}")
async def delete_street_highlight(highlight_id: str, _admin: str = Depends(require_admin)):
    """
    Admin endpoint to delete a street highlight
    """
    result = await db.street_highlights.delete_one({"id": highlight_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Street highlight not found")
    
    return {"success": True, "message": "Street highlight deleted"}

# Street Notes (temporary, location-based posts that expire in 24 hours)
class StreetNoteCreate(BaseModel):
    text: str
    latitude: float
    longitude: float
    location_text: Optional[str] = ""
    image_url: Optional[str] = None
    emoji: Optional[str] = None
    duration_hours: Optional[int] = 12
    forever: Optional[bool] = False
    # "discovery" (default street note) or "helping_hand" (community mutual aid)
    kind: Optional[str] = "discovery"
    # Stable client id of the author (re-uses chatUserId) so only they can resolve
    owner_id: Optional[str] = None
    # Optional contact details for Helping Hand posts. Only surfaced publicly
    # when contact_public is True (see get_street_notes privacy strip).
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None
    contact_public: Optional[bool] = False
    # Lost pet / lost kid "Found" status — toggled by the owner
    resolved: Optional[bool] = False

    @field_validator("text")
    @classmethod
    def _check_text(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Note text is required")
        if len(v) > MAX_TEXT_NOTE_LEN:
            raise ValueError(f"Note text must be {MAX_TEXT_NOTE_LEN} characters or less")
        return v

    @field_validator("latitude")
    @classmethod
    def _check_lat(cls, v: float) -> float:
        return _validate_lat(v)

    @field_validator("longitude")
    @classmethod
    def _check_lng(cls, v: float) -> float:
        return _validate_lng(v)

    @field_validator("location_text")
    @classmethod
    def _check_location_text(cls, v: Optional[str]) -> Optional[str]:
        if v and len(v) > MAX_LOCATION_TEXT_LEN:
            raise ValueError("location text is too long")
        return v

    @field_validator("image_url")
    @classmethod
    def _check_image(cls, v: Optional[str]) -> Optional[str]:
        return _validate_image_url(v)

    @field_validator("contact_name")
    @classmethod
    def _check_name(cls, v: Optional[str]) -> Optional[str]:
        if v and len(v) > MAX_NAME_LEN:
            raise ValueError("name is too long")
        return v

    @field_validator("contact_phone", "contact_email")
    @classmethod
    def _check_contact(cls, v: Optional[str]) -> Optional[str]:
        if v and len(v) > MAX_CONTACT_LEN:
            raise ValueError("contact field is too long")
        return v

    @field_validator("kind")
    @classmethod
    def _check_kind(cls, v: Optional[str]) -> str:
        v = (v or "discovery").strip().lower()
        if v not in {"discovery", "helping_hand"}:
            raise ValueError("invalid note kind")
        return v

class StreetNoteResolve(BaseModel):
    owner_id: Optional[str] = None
    resolved: bool = True

@api_router.get("/street-notes")
async def get_street_notes():
    """
    Get all non-expired street notes. Notes with expires_at == None are permanent
    and only deletable by admins. Auto-cleanup of expired (non-permanent) notes.
    """
    now = datetime.now(timezone.utc)

    # Auto-cleanup fallback: delete notes whose expires_at is in the past (skip
    # forever notes where expires_at is None). The TTL index normally handles
    # this; this covers the gap between background sweeps.
    await db.street_notes.delete_many({
        "expires_at": {"$ne": None, "$lt": now}
    })

    notes = await db.street_notes.find(
        {"hidden": {"$ne": True}}, {"_id": 0}
    ).sort("created_at", -1).to_list(1000)

    # Ensure timestamps are strings + backfill new fields for older docs
    for note in notes:
        if isinstance(note.get('created_at'), datetime):
            note['created_at'] = note['created_at'].isoformat()
        if isinstance(note.get('expires_at'), datetime):
            note['expires_at'] = note['expires_at'].isoformat()
        note.setdefault('kind', 'discovery')
        note.setdefault('resolved', False)
        note.setdefault('contact_public', False)
        # Privacy: only expose personal contact details when the author opted in
        if not note.get('contact_public'):
            note['contact_phone'] = None
            note['contact_email'] = None

    return notes

@api_router.post(
    "/street-notes",
    dependencies=[Depends(rate_limit("create_note", max_requests=10, window_seconds=60))],
)
async def create_street_note(note_data: StreetNoteCreate):
    """
    Create a new street note. User can choose duration (1-72 hours) or 'forever'.
    """
    if not note_data.text or not note_data.text.strip():
        raise HTTPException(status_code=400, detail="Note text is required")
    if len(note_data.text) > 150:
        raise HTTPException(status_code=400, detail="Note text must be 150 characters or less")

    now = datetime.now(timezone.utc)

    if note_data.forever:
        expires_at = None
    else:
        hours = note_data.duration_hours if note_data.duration_hours is not None else 12
        if hours < 1:
            hours = 1
        if hours > 72:
            hours = 72
        expires_at = now + timedelta(hours=hours)

    note_doc = {
        "id": str(uuid.uuid4()),
        "text": note_data.text.strip(),
        "latitude": note_data.latitude,
        "longitude": note_data.longitude,
        "location_text": (note_data.location_text or "").strip(),
        "image_url": note_data.image_url or "",
        "emoji": (note_data.emoji or "").strip() or None,
        "forever": bool(note_data.forever),
        "kind": note_data.kind or "discovery",
        "owner_id": note_data.owner_id or None,
        "contact_name": (note_data.contact_name or "").strip() or None,
        "contact_phone": (note_data.contact_phone or "").strip() or None,
        "contact_email": (note_data.contact_email or "").strip() or None,
        "contact_public": bool(note_data.contact_public),
        "resolved": bool(note_data.resolved),
        "created_at": now,
        "expires_at": expires_at
    }

    await db.street_notes.insert_one(note_doc)
    note_doc.pop("_id", None)

    # Serialize dates for the JSON response (DB keeps the real BSON dates).
    response_note = dict(note_doc)
    response_note["created_at"] = now.isoformat()
    response_note["expires_at"] = expires_at.isoformat() if expires_at else None
    return {"success": True, "note": response_note}

@api_router.post("/street-notes/{note_id}/resolve")
async def resolve_street_note(note_id: str, req: StreetNoteResolve):
    """
    Mark a Helping Hand post (e.g. lost pet/kid) as found/resolved. Only the
    original author (matching owner_id) may toggle it; the post stays visible
    with a "Found" badge until it expires.
    """
    note = await db.street_notes.find_one({"id": note_id}, {"_id": 0})
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    owner_id = note.get("owner_id")
    if owner_id and req.owner_id != owner_id:
        raise HTTPException(status_code=403, detail="Only the author can update this post")

    await db.street_notes.update_one(
        {"id": note_id},
        {"$set": {"resolved": bool(req.resolved)}}
    )
    return {"success": True, "resolved": bool(req.resolved)}

@api_router.delete("/admin/street-notes/{note_id}")
async def delete_street_note(note_id: str, _admin: str = Depends(require_admin)):
    """
    Delete a street note (admin only).
    """
    result = await db.street_notes.delete_one({"id": note_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"success": True}

# Welcome Popup Notice (first-time visitor notice)
@api_router.get("/welcome-notice")
async def get_welcome_notice():
    """
    Get the welcome notice content (shown to first-time visitors)
    """
    notice = await db.welcome_notice.find_one({})
    
    if notice:
        return {
            "content": notice.get("content", ""),
            "enabled": notice.get("enabled", True)
        }
    
    # Default content
    default_content = """<h2>Welcome to Melbourne Community Map</h2>
<p>Your friendly neighbourhood map for staying informed and helping each other out around Melbourne.</p>

<h3>🚨 Report Incidents</h3>
<p>Spotted something the community should know about? Tap <strong>Report Incident</strong> to flag it on the map. Description is optional — share as much or as little as you like.</p>

<h3>📝 Street Notes</h3>
<p>Share quick tips with your neighbours — where the nearest toilet is, a milk-tea deal, a busker worth checking out, or just a thought about the moment.</p>
<ul>
<li>Tap a quick-shortcut emoji to auto-fill your note (🚽 ☕ 🧋 🍜 🅿️ 🎵 ❤️ 😊 and more)</li>
<li>Choose how long it lasts — from <strong>1 hour</strong> up to <strong>3 days</strong>, or keep it <strong>forever</strong></li>
<li>Add an optional image; everything else is optional too</li>
</ul>

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

<p style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; font-size: 0.85rem; color: #6b7280;">In an emergency, always call <strong>000</strong> first. This app is for community awareness only.</p>"""

    return {
        "content": default_content,
        "enabled": True
    }

class WelcomeNoticeRequest(BaseModel):
    content: str = Field(max_length=20000)
    enabled: bool = True

@api_router.post("/admin/welcome-notice")
async def update_welcome_notice(update: WelcomeNoticeRequest, _admin: str = Depends(require_admin)):
    """
    Admin endpoint to update the welcome notice content
    """
    await db.welcome_notice.update_one(
        {},
        {
            "$set": {
                "content": update.content,
                "enabled": update.enabled,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
        },
        upsert=True
    )
    
    return {
        "success": True,
        "message": "Welcome notice updated",
        "content": update.content,
        "enabled": update.enabled
    }

# ── Peer location (avatar markers on the map) ─────────────────────────────
class PeerLocation(BaseModel):
    id: str = Field(min_length=1, max_length=100)  # stable client-generated UUID
    emoji: str = Field(max_length=16)
    title: str = Field(max_length=MAX_NAME_LEN)
    lat: float
    lng: float
    ts: float         # JS Date.now() milliseconds

    @field_validator("lat")
    @classmethod
    def _check_lat(cls, v: float) -> float:
        return _validate_lat(v)

    @field_validator("lng")
    @classmethod
    def _check_lng(cls, v: float) -> float:
        return _validate_lng(v)

@api_router.post(
    "/peers",
    dependencies=[Depends(rate_limit("peers", max_requests=30, window_seconds=60))],
)
async def upsert_peer(peer: PeerLocation):
    """Upsert a peer's live location. Called by the client every ~20 s."""
    await db.peers.update_one(
        {"id": peer.id},
        {"$set": {
            "id": peer.id,
            "emoji": peer.emoji,
            "title": peer.title,
            "lat": peer.lat,
            "lng": peer.lng,
            "ts": peer.ts,
            "updated_at": datetime.now(timezone.utc)
        }},
        upsert=True
    )
    return {"ok": True}

@api_router.get("/peers")
async def list_peers():
    """Return all peers seen within the last PEER_TTL_SECONDS seconds."""
    cutoff_ms = (datetime.now(timezone.utc).timestamp() - PEER_TTL_SECONDS) * 1000
    peers = await db.peers.find(
        {"ts": {"$gte": cutoff_ms}},
        {"_id": 0}
    ).to_list(500)
    return peers

@api_router.delete("/peers/{peer_id}")
async def remove_peer(peer_id: str):
    """Remove a peer's marker when they switch back to anonymous."""
    await db.peers.delete_one({"id": peer_id})
    return {"ok": True}

# ── Moderation: user reports + admin review queue ─────────────────────────────
# Maps a report target type to the collection it lives in. Used to verify the
# target exists, hide/unhide it, and delete it from the admin queue.
REPORT_TARGET_COLLECTIONS = {
    "incident": "incidents",
    "street_note": "street_notes",
    "chat_message": "chat_messages",
}
ALLOWED_REPORT_REASONS = {
    "spam", "harassment", "violence", "sexual", "hate",
    "personal_info", "misinformation", "other",
}
MAX_REPORT_DETAILS_LEN = 500


def _report_preview(target_type: str, doc: dict) -> dict:
    """Build a compact, safe snapshot of reported content for the admin queue."""
    if not doc:
        return {"exists": False}
    preview = {"exists": True, "hidden": bool(doc.get("hidden", False))}
    if target_type == "incident":
        preview.update({
            "text": doc.get("description", ""),
            "category": doc.get("category"),
            "urgency": doc.get("urgency"),
        })
    elif target_type == "street_note":
        preview.update({
            "text": doc.get("text", ""),
            "kind": doc.get("kind"),
            "location_text": doc.get("location_text", ""),
        })
    elif target_type == "chat_message":
        preview.update({
            "text": doc.get("message", ""),
            "author": doc.get("author", "Anonymous"),
        })
    return preview


class ReportCreate(BaseModel):
    target_type: str
    target_id: str = Field(min_length=1, max_length=100)
    reason: str
    details: Optional[str] = Field(default="", max_length=MAX_REPORT_DETAILS_LEN)

    @field_validator("target_type")
    @classmethod
    def _check_target_type(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if v not in REPORT_TARGET_COLLECTIONS:
            raise ValueError(f"target_type must be one of {sorted(REPORT_TARGET_COLLECTIONS)}")
        return v

    @field_validator("reason")
    @classmethod
    def _check_reason(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if v not in ALLOWED_REPORT_REASONS:
            raise ValueError(f"reason must be one of {sorted(ALLOWED_REPORT_REASONS)}")
        return v

    @field_validator("details")
    @classmethod
    def _check_details(cls, v: Optional[str]) -> str:
        v = (v or "").strip()
        if len(v) > MAX_REPORT_DETAILS_LEN:
            raise ValueError(f"details must be {MAX_REPORT_DETAILS_LEN} characters or less")
        return v


@api_router.post(
    "/reports",
    dependencies=[Depends(rate_limit("report", max_requests=10, window_seconds=60))],
)
async def create_report(report: ReportCreate):
    """
    Public endpoint: flag a piece of content (incident, street note, or chat
    message) for moderator review. Stored in the content_reports queue.
    """
    collection = REPORT_TARGET_COLLECTIONS[report.target_type]
    target = await db[collection].find_one({"id": report.target_id}, {"_id": 0, "id": 1})
    if not target:
        raise HTTPException(status_code=404, detail="Reported content not found")

    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "target_type": report.target_type,
        "target_id": report.target_id,
        "reason": report.reason,
        "details": report.details or "",
        "status": "open",          # open | actioned | dismissed
        "resolution": None,         # hide | delete | dismiss
        "created_at": now,
        "resolved_at": None,
    }
    await db.content_reports.insert_one(doc)
    return {"success": True, "message": "Thanks — our moderators will review this."}


@api_router.get("/admin/reports")
async def list_reports(status: Optional[str] = "open", _admin: str = Depends(require_admin)):
    """
    Admin moderation queue. Returns reports (default: open) enriched with a
    snapshot of the reported content so moderators can decide without leaving
    the dashboard.
    """
    query = {}
    if status and status != "all":
        query["status"] = status
    reports = await db.content_reports.find({**query}, {"_id": 0}).sort("created_at", -1).to_list(500)

    for r in reports:
        if isinstance(r.get("created_at"), datetime):
            r["created_at"] = r["created_at"].isoformat()
        if isinstance(r.get("resolved_at"), datetime):
            r["resolved_at"] = r["resolved_at"].isoformat()
        collection = REPORT_TARGET_COLLECTIONS.get(r.get("target_type"))
        target = None
        if collection:
            target = await db[collection].find_one({"id": r.get("target_id")}, {"_id": 0})
        r["target"] = _report_preview(r.get("target_type"), target)

    open_count = await db.content_reports.count_documents({"status": "open"})
    return {"reports": reports, "open_count": open_count}


class ReportActionRequest(BaseModel):
    action: str  # dismiss | hide | unhide | delete

    @field_validator("action")
    @classmethod
    def _check_action(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if v not in {"dismiss", "hide", "unhide", "delete"}:
            raise ValueError("action must be one of dismiss, hide, unhide, delete")
        return v


@api_router.post("/admin/reports/{report_id}/action")
async def action_report(report_id: str, req: ReportActionRequest, _admin: str = Depends(require_admin)):
    """
    Admin endpoint to resolve a report:
      - dismiss: no change to content; mark the report dismissed
      - hide:    set hidden=true on the target (removed from public views)
      - unhide:  clear hidden on the target
      - delete:  permanently delete the target content
    """
    report = await db.content_reports.find_one({"id": report_id}, {"_id": 0})
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    collection = REPORT_TARGET_COLLECTIONS.get(report.get("target_type"))
    target_id = report.get("target_id")
    now = datetime.now(timezone.utc)

    if req.action == "hide" and collection:
        await db[collection].update_one({"id": target_id}, {"$set": {"hidden": True}})
    elif req.action == "unhide" and collection:
        await db[collection].update_one({"id": target_id}, {"$set": {"hidden": False}})
    elif req.action == "delete" and collection:
        await db[collection].delete_one({"id": target_id})

    new_status = "dismissed" if req.action == "dismiss" else "actioned"
    await db.content_reports.update_one(
        {"id": report_id},
        {"$set": {"status": new_status, "resolution": req.action, "resolved_at": now}},
    )
    return {"success": True, "status": new_status, "resolution": req.action}


# Include the router in the main app
app.include_router(api_router)

# ── CORS ──────────────────────────────────────────────────────────────────────
# CORS only constrains *browsers* — it is not a substitute for auth or rate
# limiting (curl/bots/direct API calls ignore it). Restrict to the real frontend
# origins. Override via CORS_ORIGINS (comma-separated) in the environment.
DEFAULT_CORS_ORIGINS = (
    "https://commap.netlify.app,"
    "http://localhost:5173,http://127.0.0.1:5173,"
    "http://localhost:8000,http://127.0.0.1:8000"
)
_cors_origins = [
    o.strip()
    for o in os.environ.get('CORS_ORIGINS', DEFAULT_CORS_ORIGINS).split(',')
    if o.strip()
]
# Guard against the insecure combination of credentials + wildcard origin.
_allow_credentials = "*" not in _cors_origins

app.add_middleware(
    CORSMiddleware,
    allow_credentials=_allow_credentials,
    allow_origins=_cors_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# Security headers on every response.
app.add_middleware(SecurityHeadersMiddleware)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

DEFAULT_CONTENT_VERSION = "v2_2026_05"

DEFAULT_LIVE_UPDATES_TEXT = "📝 NEW: Street Notes with emoji shortcuts 🚽 ☕ 🧋 🅿️ 🎵 — share tips with your neighbours  •  Choose how long your note lasts: 1 hour, 3 days, or forever  •  Tap the blue crosshair to find yourself on the map  •  Add this app to your home screen for a native-app feel  •  Tap the active users badge to chat with the community"

DEFAULT_WELCOME_NOTICE_CONTENT = """<h2>Welcome to Melbourne Community Map</h2>
<p>Your friendly neighbourhood map for staying informed and helping each other out around Melbourne.</p>

<h3>🚨 Report Incidents</h3>
<p>Spotted something the community should know about? Tap <strong>Report Incident</strong> to flag it on the map. Description is optional — share as much or as little as you like.</p>

<h3>📝 Street Notes</h3>
<p>Share quick tips with your neighbours — where the nearest toilet is, a milk-tea deal, a busker worth checking out, or just a thought about the moment.</p>
<ul>
<li>Tap a quick-shortcut emoji to auto-fill your note (🚽 ☕ 🧋 🍜 🅿️ 🎵 ❤️ 😊 and more)</li>
<li>Choose how long it lasts — from <strong>1 hour</strong> up to <strong>3 days</strong>, or keep it <strong>forever</strong></li>
<li>Add an optional image; everything else is optional too</li>
</ul>

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

<p style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; font-size: 0.85rem; color: #6b7280;">In an emergency, always call <strong>000</strong> first. This app is for community awareness only.</p>"""

@app.on_event("startup")
async def run_content_migrations():
    """
    One-time refresh of live updates and welcome notice when a new content version
    ships. Admin edits made AFTER this version stamp are preserved (because the
    same version stamp is written on every admin save).
    """
    try:
        marker = await db.migrations.find_one({"_id": f"content_refresh_{DEFAULT_CONTENT_VERSION}"})
        if marker:
            return
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.live_updates.update_one(
            {"_id": "content"},
            {"$set": {
                "text": DEFAULT_LIVE_UPDATES_TEXT,
                "updated_at": now_iso,
                "content_version": DEFAULT_CONTENT_VERSION
            }},
            upsert=True
        )
        await db.welcome_notice.update_one(
            {},
            {"$set": {
                "content": DEFAULT_WELCOME_NOTICE_CONTENT,
                "enabled": True,
                "updated_at": now_iso,
                "content_version": DEFAULT_CONTENT_VERSION
            }},
            upsert=True
        )
        await db.migrations.insert_one({
            "_id": f"content_refresh_{DEFAULT_CONTENT_VERSION}",
            "applied_at": now_iso
        })
        logger.info(f"Applied content refresh migration {DEFAULT_CONTENT_VERSION}")
    except Exception as e:
        logger.exception(f"Content migration failed: {e}")

@app.on_event("startup")
async def migrate_dates_to_datetimes():
    """
    One-time migration: convert legacy ISO-string date fields to real BSON dates
    so the TTL indexes work and date range queries are correct. Runs once
    (guarded by a migration marker) and is safe to ship repeatedly.
    """
    marker_id = "dates_to_bson_v1"
    try:
        if await db.migrations.find_one({"_id": marker_id}):
            return

        def _parse(value):
            if isinstance(value, datetime):
                return value
            if isinstance(value, str) and value:
                try:
                    return datetime.fromisoformat(value)
                except ValueError:
                    return None
            return None

        # (collection, [date fields]) — convert any string values in place.
        string_date_fields = [
            ("incidents", ["timestamp"]),
            ("street_notes", ["created_at", "expires_at"]),
            ("street_highlights", ["created_at"]),
            ("chat_messages", ["timestamp"]),
            ("active_users", ["last_heartbeat"]),
        ]
        for coll_name, fields in string_date_fields:
            coll = db[coll_name]
            for field in fields:
                async for doc in coll.find({field: {"$type": "string"}}, {field: 1}):
                    parsed = _parse(doc.get(field))
                    if parsed is not None:
                        await coll.update_one({"_id": doc["_id"]}, {"$set": {field: parsed}})

        # Backfill chat expire_at for non-pinned messages (drives the TTL index).
        async for doc in db.chat_messages.find(
            {"expire_at": {"$exists": False}}, {"timestamp": 1, "pinned": 1}
        ):
            if doc.get("pinned"):
                continue
            ts = _parse(doc.get("timestamp")) or datetime.now(timezone.utc)
            await db.chat_messages.update_one(
                {"_id": doc["_id"]},
                {"$set": {"expire_at": ts + timedelta(hours=CHAT_TTL_HOURS)}},
            )

        await db.migrations.insert_one(
            {"_id": marker_id, "applied_at": datetime.now(timezone.utc)}
        )
        logger.info("Applied date migration %s", marker_id)
    except Exception as e:
        logger.exception("Date migration failed: %s", e)


@app.on_event("startup")
async def ensure_indexes():
    """
    Create the indexes that keep reads fast and let MongoDB auto-expire stale
    data via TTL indexes. Idempotent: create_index is a no-op when the index
    already exists with the same options. TTL indexes only delete documents
    whose indexed field is a Date in the past; missing/None values are ignored
    (so 'forever' notes and pinned chat messages are never removed).
    """
    index_specs = [
        # incidents: fast id lookups + 6h TTL on creation time
        ("incidents", "id", {}),
        ("incidents", "timestamp", {"expireAfterSeconds": INCIDENT_TTL_SECONDS}),
        # street notes: id lookups, recency sort, and per-document expiry
        ("street_notes", "id", {}),
        ("street_notes", "created_at", {}),
        ("street_notes", "expires_at", {"expireAfterSeconds": 0}),
        # chat: recency sort + 24h TTL (pinned messages have no expire_at)
        ("chat_messages", "timestamp", {}),
        ("chat_messages", "expire_at", {"expireAfterSeconds": 0}),
        # live presence markers
        ("peers", "ts", {}),
        ("peers", "updated_at", {"expireAfterSeconds": PEER_TTL_SECONDS}),
        # active users presence window
        ("active_users", "last_heartbeat", {"expireAfterSeconds": ACTIVE_USER_TTL_SECONDS}),
        # moderation queue
        ("content_reports", "status", {}),
        ("content_reports", "created_at", {}),
    ]
    for coll_name, field, opts in index_specs:
        try:
            await db[coll_name].create_index(field, **opts)
        except Exception as e:
            # Most likely an existing index with conflicting options; log and
            # continue so a single clash never blocks startup.
            logger.warning("Could not create index on %s.%s: %s", coll_name, field, e)
    # Compound index for moderation lookups by target.
    try:
        await db.content_reports.create_index([("target_type", 1), ("target_id", 1)])
    except Exception as e:
        logger.warning("Could not create content_reports target index: %s", e)
    logger.info("Index/TTL setup complete")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()