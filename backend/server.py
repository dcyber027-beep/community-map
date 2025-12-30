from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
import math

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Define Models
class IncidentCreate(BaseModel):
    category: str  # "protest", "theft", "harassment"
    urgency: str  # "low", "medium", "high"
    description: str
    latitude: float
    longitude: float
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    is_verified: bool = False

class Incident(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    category: str
    urgency: str
    description: str
    latitude: float
    longitude: float
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    is_verified: bool = False
    cluster_count: int = 1
    like_count: int = 0
    dislike_count: int = 0
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class AdminAuth(BaseModel):
    account: str
    pin: str

class AddressSearch(BaseModel):
    address: str

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

@api_router.post("/admin/verify", response_model=dict)
async def verify_admin(auth: AdminAuth):
    """
    Verify admin account and PIN
    """
    # Default credentials
    admin_account = os.environ.get('ADMIN_ACCOUNT', 'admin')
    admin_pin = os.environ.get('ADMIN_PIN', '123456')
    
    if auth.account == admin_account and auth.pin == admin_pin:
        return {"success": True, "message": "Admin verified"}
    else:
        raise HTTPException(status_code=401, detail="Invalid account or PIN")

@api_router.post("/geocode", response_model=dict)
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

@api_router.post("/incidents", response_model=Incident)
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
    
    # Convert to dict and serialize datetime to ISO string for MongoDB
    doc = incident_obj.model_dump()
    doc['timestamp'] = doc['timestamp'].isoformat()
    
    _ = await db.incidents.insert_one(doc)
    return incident_obj

@api_router.get("/incidents", response_model=List[Incident])
async def get_incidents(hours: Optional[int] = None):
    """
    Get all incidents with optional time filter
    """
    # Auto-cleanup: Remove incidents older than 6 hours
    cutoff_time = datetime.now(timezone.utc) - timedelta(hours=6)
    await db.incidents.delete_many({
        "timestamp": {"$lt": cutoff_time.isoformat()}
    })
    
    # Exclude MongoDB's _id field and contact info from public results
    incidents = await db.incidents.find({}, {
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
async def get_admin_incidents():
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
async def delete_incident(incident_id: str):
    """
    Delete an incident (admin only)
    """
    result = await db.incidents.delete_one({"id": incident_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Incident not found")
    
    return {"success": True, "message": "Incident deleted"}

@api_router.put("/admin/incidents/{incident_id}")
async def update_incident(incident_id: str, update_data: dict):
    """
    Update an incident (admin only)
    """
    # Remove fields that shouldn't be updated
    update_data.pop('id', None)
    update_data.pop('timestamp', None)
    
    result = await db.incidents.update_one(
        {"id": incident_id},
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Incident not found")
    
    return {"success": True, "message": "Incident updated"}

class ReactionRequest(BaseModel):
    reaction: str  # "like" or "dislike"

@api_router.post("/incidents/{incident_id}/react")
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
@api_router.post("/users/heartbeat/{session_id}")
async def user_heartbeat(session_id: str):
    """
    Track active users viewing the map
    """
    now = datetime.now(timezone.utc)
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=2)
    
    # Record/update this user's heartbeat
    await db.active_users.update_one(
        {"session_id": session_id},
        {"$set": {"last_heartbeat": now.isoformat()}},
        upsert=True
    )
    
    # Clean up stale users and count active ones
    await db.active_users.delete_many({"last_heartbeat": {"$lt": cutoff.isoformat()}})
    active_count = await db.active_users.count_documents({"last_heartbeat": {"$gte": cutoff.isoformat()}})
    
    return {
        "success": True,
        "active_count": active_count
    }

# Group Chat Endpoints
class ChatMessageCreate(BaseModel):
    message: str
    author: Optional[str] = "Anonymous"

class ChatMessage(BaseModel):
    id: str
    message: str
    author: str
    timestamp: datetime

@api_router.get("/chat/messages")
async def get_chat_messages():
    """
    Get all chat messages (auto-cleanup messages older than 24 hours)
    """
    # Auto-cleanup: Remove messages older than 24 hours
    cutoff_time = datetime.now(timezone.utc) - timedelta(hours=24)
    await db.chat_messages.delete_many({
        "timestamp": {"$lt": cutoff_time.isoformat()}
    })
    
    # Get all messages
    messages = await db.chat_messages.find({}, {"_id": 0}).sort("timestamp", 1).to_list(1000)
    
    # Convert timestamps to ISO strings for JSON serialization
    result = []
    for message in messages:
        msg_dict = dict(message)
        # Keep timestamp as ISO string for frontend
        if isinstance(msg_dict['timestamp'], datetime):
            msg_dict['timestamp'] = msg_dict['timestamp'].isoformat()
        elif isinstance(msg_dict['timestamp'], str):
            msg_dict['timestamp'] = msg_dict['timestamp']
        result.append(msg_dict)
    
    return result

@api_router.post("/chat/messages")
async def create_chat_message(message_data: ChatMessageCreate):
    """
    Create a new chat message
    """
    message_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    
    message_doc = {
        "id": message_id,
        "message": message_data.message,
        "author": message_data.author or "Anonymous",
        "timestamp": now.isoformat()
    }
    
    await db.chat_messages.insert_one(message_doc)
    
    return {
        "success": True,
        "message": {
            "id": message_id,
            "message": message_data.message,
            "author": message_data.author or "Anonymous",
            "timestamp": now.isoformat()
        }
    }

# Live Updates Content Management
@api_router.get("/live-updates")
async def get_live_updates():
    """
    Get the current live updates content
    """
    # Try to get from database, if not found use default
    content = await db.live_updates.find_one({"_id": "content"})
    
    default_content = "Reports clear after 6 hours • Notifications for urgent incidents within 500m"
    
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
    content: str

@api_router.post("/admin/live-updates")
async def update_live_updates(update: LiveUpdatesRequest):
    """
    Admin endpoint to update live updates content
    """
    # Verify admin (in production, add proper auth check)
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
class StreetHighlightCreate(BaseModel):
    start_lat: float
    start_lng: float
    end_lat: float
    end_lng: float
    color: str  # "red", "yellow", "green"
    reason: str  # "poor_lighting", "crowded", "harassment", "protest", "other"
    description: Optional[str] = ""

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
async def create_street_highlight(highlight_data: StreetHighlightCreate):
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
        "created_at": now.isoformat(),
        "created_by": "admin"
    }
    
    await db.street_highlights.insert_one(highlight_doc)
    
    highlight_doc["_id"] = 0  # Remove MongoDB _id
    return {
        "success": True,
        "highlight": highlight_doc
    }

@api_router.put("/admin/street-highlights/{highlight_id}")
async def update_street_highlight(highlight_id: str, update_data: dict):
    """
    Admin endpoint to update a street highlight (e.g., change color)
    """
    # Only allow updating certain fields
    allowed_fields = {"color", "reason", "description"}
    update_dict = {k: v for k, v in update_data.items() if k in allowed_fields}
    
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
async def delete_street_highlight(highlight_id: str):
    """
    Admin endpoint to delete a street highlight
    """
    result = await db.street_highlights.delete_one({"id": highlight_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Street highlight not found")
    
    return {"success": True, "message": "Street highlight deleted"}

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
<p>This interactive map helps you stay informed about community incidents and safety in Melbourne.</p>
<ul>
<li>📍 Report incidents you've witnessed or experienced</li>
<li>🗺️ View recent community reports on the map</li>
<li>💬 Join the community chat to share updates</li>
<li>📍 Check admin-highlighted streets for important information</li>
</ul>
<p>Your reports help keep the community safe. Stay alert and report responsibly.</p>"""
    
    return {
        "content": default_content,
        "enabled": True
    }

class WelcomeNoticeRequest(BaseModel):
    content: str
    enabled: bool = True

@api_router.post("/admin/welcome-notice")
async def update_welcome_notice(update: WelcomeNoticeRequest):
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

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()