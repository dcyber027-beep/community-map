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
    
    # Convert ISO string timestamps back to datetime objects and ensure like/dislike counts exist
    for incident in incidents:
        if isinstance(incident['timestamp'], str):
            incident['timestamp'] = datetime.fromisoformat(incident['timestamp'])
        # Ensure like_count and dislike_count exist for backward compatibility
        if 'like_count' not in incident:
            incident['like_count'] = 0
        if 'dislike_count' not in incident:
            incident['dislike_count'] = 0
    
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