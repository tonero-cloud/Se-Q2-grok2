from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, Body, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timedelta
import bcrypt
import jwt
from bson import ObjectId
import math
import hashlib

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create geospatial indexes
async def create_indexes():
    await db.civil_reports.create_index([("location", "2dsphere")])
    await db.civil_tracks.create_index([("currentLocation.coordinates", "2dsphere")])
    await db.security_teams.create_index([("teamLocation.coordinates", "2dsphere")])

# JWT Configuration
JWT_SECRET = os.environ.get('JWT_SECRET', 'safeguard-secret-key-2025')
JWT_ALGORITHM = 'HS256'
JWT_EXPIRATION_HOURS = 24 * 30  # 30 days

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ===== MODELS =====
class UserRegister(BaseModel):
    email: EmailStr
    password: str
    confirm_password: str
    phone: Optional[str] = None
    full_name: Optional[str] = None
    role: str = "civil"  # "civil" or "security"
    invite_code: Optional[str] = None  # Required for security role
    security_sub_role: Optional[str] = None  # "supervisor" or "team_member" for security
    team_name: Optional[str] = None  # Optional team name for security

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class AdminLogin(BaseModel):
    email: EmailStr
    password: str

class GoogleAuthData(BaseModel):
    google_id: str
    email: EmailStr
    name: str
    role: str = "civil"

class LocationPoint(BaseModel):
    latitude: float
    longitude: float
    accuracy: Optional[float] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    emergency_category: Optional[str] = None  # For panic events: violence, robbery, kidnapping, etc.

class SetTeamLocation(BaseModel):
    latitude: float
    longitude: float
    radius_km: float = 10.0  # Default 10km radius

class ReportCreate(BaseModel):
    type: str  # "video" or "audio"
    caption: Optional[str] = None
    is_anonymous: bool = False
    file_url: Optional[str] = None
    thumbnail: Optional[str] = None
    uploaded: bool = False
    latitude: float
    longitude: float

class UserSearch(BaseModel):
    search_term: str  # phone or email

class AppCustomization(BaseModel):
    app_name: str
    app_logo: str

class UpdateLocation(BaseModel):
    latitude: float
    longitude: float
    accuracy: Optional[float] = None

class UpdateStatus(BaseModel):
    status: str  # "available", "busy", "responding", "offline"

class UpdateSecuritySettings(BaseModel):
    visibility_radius_km: Optional[int] = None
    status: Optional[str] = None
    is_visible: Optional[bool] = None

class SendMessage(BaseModel):
    to_user_id: str
    content: str
    message_type: str = "text"  # "text", "image", "location", "voice"

class CreateInviteCode(BaseModel):
    code: Optional[str] = None  # Auto-generate if not provided
    max_uses: int = 10
    expires_days: int = 30

# ===== HELPER FUNCTIONS =====
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_token(user_id: str, email: str, role: str) -> str:
    payload = {
        'user_id': user_id,
        'email': email,
        'role': role,
        'exp': datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def verify_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

async def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    token = authorization.split(' ')[1]
    payload = verify_token(token)
    user = await db.users.find_one({'_id': ObjectId(payload['user_id'])})
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return user

def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two points in km using Haversine formula"""
    R = 6371  # Earth's radius in km
    
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    
    a = math.sin(delta_lat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    
    return R * c

def geohash(lat: float, lon: float, precision: int = 6) -> str:
    """Simple geohash implementation"""
    return hashlib.md5(f"{lat:.{precision}f},{lon:.{precision}f}".encode()).hexdigest()[:precision]

# Import services
from services import (
    firebase_service,
    paystack_service,
    expo_push_service,
    email_service
)

# Real Push Notification using Expo
async def send_push_notification(user_ids: List[str], title: str, body: str, data: dict = None):
    """Send push notification using Expo Push Service"""
    try:
        # Get push tokens for these users
        users_with_tokens = await db.users.find({
            '_id': {'$in': [ObjectId(uid) for uid in user_ids]},
            'push_token': {'$exists': True, '$ne': None}
        }).to_list(length=None)
        
        tokens = [user.get('push_token') for user in users_with_tokens if user.get('push_token')]
        
        if not tokens:
            logging.info(f"No push tokens found for {len(user_ids)} users")
            return {"status": "no_tokens", "sent_to": 0}
        
        # Send via Expo Push Service
        result = await expo_push_service.send_push_notification(
            tokens=tokens,
            title=title,
            body=body,
            data=data or {},
            priority='high'
        )
        
        logging.info(f"Push notification sent: {result['success']} success, {result['failed']} failed")
        return {"status": "sent", "sent_to": result['success'], "failed": result['failed']}
        
    except Exception as e:
        logging.error(f"Push notification error: {e}")
        return {"status": "error", "sent_to": 0, "error": str(e)}

# ===== AUTHENTICATION ROUTES =====
@api_router.post("/auth/register")
async def register(user_data: UserRegister):
    # Check passwords match
    if user_data.password != user_data.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    
    # Check if user exists
    existing_user = await db.users.find_one({'email': user_data.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Validate security role and invite code
    if user_data.role == "security":
        if not user_data.invite_code:
            raise HTTPException(status_code=403, detail="Invite code required for security registration")
        
        # Check invite code validity
        invite = await db.invite_codes.find_one({
            'code': user_data.invite_code,
            'is_active': True,
            'expires_at': {'$gt': datetime.utcnow()}
        })
        
        if not invite:
            raise HTTPException(status_code=403, detail="Invalid or expired invite code")
        
        if invite.get('used_count', 0) >= invite.get('max_uses', 10):
            raise HTTPException(status_code=403, detail="Invite code has reached maximum uses")
        
        # Increment used count
        await db.invite_codes.update_one(
            {'_id': invite['_id']},
            {'$inc': {'used_count': 1}}
        )
    
    # Create user
    user = {
        'email': user_data.email.strip().lower(),
        'phone': user_data.phone,
        'full_name': user_data.full_name or '',
        'password': hash_password(user_data.password),
        'role': user_data.role,
        'is_premium': False,
        'is_active': True,
        'is_verified': True,  # Auto-verify for demo
        'app_name': 'SafeGuard',
        'app_logo': 'shield',
        'created_at': datetime.utcnow(),
        'google_id': None
    }
    
    # Add security-specific fields
    if user_data.role == "security":
        user['security_sub_role'] = user_data.security_sub_role or 'team_member'
        user['team_name'] = user_data.team_name or ''
        user['status'] = 'available'
        user['visibility_radius_km'] = 25
        user['is_visible'] = True
    
    result = await db.users.insert_one(user)
    user_id = str(result.inserted_id)
    
    # Create security team entry if security user
    if user_data.role == "security":
        team = {
            'user_id': user_id,
            'teamLocation': {
                'type': 'Point',
                'coordinates': [0, 0]  # Default, user will set
            },
            'radius_km': 10.0,
            'created_at': datetime.utcnow()
        }
        await db.security_teams.insert_one(team)
    
    token = create_token(user_id, user_data.email, user_data.role)
    
    return {
        'token': token,
        'user_id': user_id,
        'email': user_data.email,
        'role': user_data.role,
        'is_premium': False
    }

@api_router.post("/auth/login")
async def login(credentials: UserLogin):
    user = await db.users.find_one({'email': credentials.email})
    if not user or not user.get('password'):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not verify_password(credentials.password, user['password']):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    token = create_token(str(user['_id']), user['email'], user.get('role', 'civil'))
    
    return {
        'token': token,
        'user_id': str(user['_id']),
        'email': user['email'],
        'role': user.get('role', 'civil'),
        'is_premium': user.get('is_premium', False)
    }

@api_router.post("/auth/google")
async def google_auth(auth_data: GoogleAuthData):
    user = await db.users.find_one({'google_id': auth_data.google_id})
    
    if not user:
        user = {
            'email': auth_data.email,
            'name': auth_data.name,
            'google_id': auth_data.google_id,
            'password': None,
            'role': auth_data.role,
            'is_premium': False,
            'is_verified': True,
            'app_name': 'SafeGuard',
            'app_logo': 'shield',
            'created_at': datetime.utcnow()
        }
        result = await db.users.insert_one(user)
        user_id = str(result.inserted_id)
    else:
        user_id = str(user['_id'])
    
    token = create_token(user_id, auth_data.email, user.get('role', auth_data.role))
    
    return {
        'token': token,
        'user_id': user_id,
        'email': auth_data.email,
        'role': user.get('role', auth_data.role),
        'is_premium': user.get('is_premium', False)
    }

# ===== USER ROUTES =====
@api_router.get("/user/profile")
async def get_profile(user = Depends(get_current_user)):
    return {
        'id': str(user['_id']),
        'email': user['email'],
        'full_name': user.get('full_name', ''),
        'phone': user.get('phone'),
        'role': user.get('role', 'civil'),
        'is_premium': user.get('is_premium', False),
        'app_name': user.get('app_name', 'SafeGuard'),
        'app_logo': user.get('app_logo', 'shield'),
        'created_at': user.get('created_at')
    }

@api_router.put("/user/customize-app")
async def customize_app(customization: AppCustomization, user = Depends(get_current_user)):
    await db.users.update_one(
        {'_id': user['_id']},
        {'$set': {'app_name': customization.app_name, 'app_logo': customization.app_logo}}
    )
    return {'message': 'App customization updated'}

class EmergencyContactsUpdate(BaseModel):
    contacts: List[dict]

@api_router.put("/user/emergency-contacts")
async def update_emergency_contacts(data: EmergencyContactsUpdate, user = Depends(get_current_user)):
    """Update user's emergency contacts for panic notifications"""
    valid_contacts = []
    for contact in data.contacts:
        if contact.get('phone'):
            valid_contacts.append({
                'name': contact.get('name', ''),
                'phone': contact.get('phone'),
                'email': contact.get('email', '')
            })
    
    await db.users.update_one(
        {'_id': user['_id']},
        {'$set': {'emergency_contacts': valid_contacts}}
    )
    return {'message': 'Emergency contacts updated', 'count': len(valid_contacts)}

# ===== CIVIL USER ROUTES =====
@api_router.post("/panic/activate")
async def activate_panic(panic_data: LocationPoint, user = Depends(get_current_user)):
    if user.get('role') != 'civil':
        raise HTTPException(status_code=403, detail="Only civil users can activate panic")
    
    # Map category labels for notifications
    CATEGORY_LABELS = {
        'violence': 'Violence/Assault',
        'robbery': 'Armed Robbery',
        'kidnapping': 'Kidnapping/Abduction',
        'burglary': 'Break-in/Burglary',
        'breakin': 'Break-in/Burglary',
        'medical': 'Medical Emergency',
        'fire': 'Fire/Accident',
        'harassment': 'Harassment/Stalking',
        'other': 'Emergency'
    }
    
    category = panic_data.emergency_category or 'other'
    category_label = CATEGORY_LABELS.get(category, 'Emergency')
    
    panic_event = {
        'user_id': str(user['_id']),
        'activated_at': datetime.utcnow(),
        'is_active': True,
        'emergency_category': category,
        'location': {
            'type': 'Point',
            'coordinates': [panic_data.longitude, panic_data.latitude]
        },
        'locations': [{
            'latitude': panic_data.latitude,
            'longitude': panic_data.longitude,
            'accuracy': panic_data.accuracy,
            'timestamp': panic_data.timestamp
        }]
    }
    result = await db.panic_events.insert_one(panic_event)
    
    # Notify nearby security users
    security_teams = await db.security_teams.find({
        'teamLocation.coordinates': {
            '$near': {
                '$geometry': {'type': 'Point', 'coordinates': [panic_data.longitude, panic_data.latitude]},
                '$maxDistance': 50000  # 50km max
            }
        }
    }).to_list(100)
    
    security_user_ids = [team['user_id'] for team in security_teams]
    if security_user_ids:
        # Send push notifications with category
        await send_push_notification(
            security_user_ids,
            f"🚨 {category_label.upper()} ALERT",
            f"{category_label} reported nearby at {panic_data.latitude:.4f}, {panic_data.longitude:.4f}",
            {'type': 'panic', 'event_id': str(result.inserted_id), 'category': category}
        )
        
        # Send email alerts to security users
        try:
            security_users = await db.users.find({
                '_id': {'$in': [ObjectId(uid) for uid in security_user_ids]}
            }).to_list(length=None)
            
            for sec_user in security_users:
                if sec_user.get('email'):
                    await email_service.send_panic_alert_email(
                        to_email=sec_user['email'],
                        reporter_name=user.get('email', 'Unknown'),
                        latitude=panic_data.latitude,
                        longitude=panic_data.longitude,
                        timestamp=datetime.utcnow()
                    )
        except Exception as e:
            logging.error(f"Error sending panic emails: {e}")
    
    return {'panic_id': str(result.inserted_id), 'message': 'Panic activated'}

@api_router.post("/panic/location")
async def log_panic_location(location: LocationPoint, user = Depends(get_current_user)):
    panic_event = await db.panic_events.find_one({'user_id': str(user['_id']), 'is_active': True})
    if not panic_event:
        raise HTTPException(status_code=404, detail="No active panic")
    
    await db.panic_events.update_one(
        {'_id': panic_event['_id']},
        {'$push': {'locations': {
            'latitude': location.latitude,
            'longitude': location.longitude,
            'accuracy': location.accuracy,
            'timestamp': location.timestamp
        }}}
    )
    return {'message': 'Location logged'}

@api_router.post("/panic/deactivate")
async def deactivate_panic(user = Depends(get_current_user)):
    await db.panic_events.update_one(
        {'user_id': str(user['_id']), 'is_active': True},
        {'$set': {'is_active': False, 'deactivated_at': datetime.utcnow()}}
    )
    return {'message': 'Panic deactivated'}

@api_router.post("/escort/action")
async def escort_action(action: str = Body(...), location: LocationPoint = Body(...), user = Depends(get_current_user)):
    if user.get('role') != 'civil':
        raise HTTPException(status_code=403, detail="Only civil users can use escort")
    if not user.get('is_premium'):
        raise HTTPException(status_code=403, detail="Premium feature")
    
    if action == 'start':
        session = {
            'user_id': str(user['_id']),
            'started_at': datetime.utcnow(),
            'is_active': True,
            'currentLocation': {
                'type': 'Point',
                'coordinates': [location.longitude, location.latitude]
            },
            'locations': []
        }
        result = await db.escort_sessions.insert_one(session)
        
        # Create real-time track document
        await db.civil_tracks.insert_one({
            'user_id': str(user['_id']),
            'session_id': str(result.inserted_id),
            'currentLocation': {
                'type': 'Point',
                'coordinates': [location.longitude, location.latitude],
                'timestamp': datetime.utcnow()
            },
            'is_active': True
        })
        
        return {'session_id': str(result.inserted_id), 'message': 'Escort started'}
    
    elif action == 'stop':
        session = await db.escort_sessions.find_one({'user_id': str(user['_id']), 'is_active': True})
        if not session:
            raise HTTPException(status_code=404, detail="No active session")
        
        # Schedule deletion after 24h
        await db.escort_sessions.update_one(
            {'_id': session['_id']},
            {'$set': {'is_active': False, 'ended_at': datetime.utcnow(), 'delete_at': datetime.utcnow() + timedelta(hours=24)}}
        )
        await db.civil_tracks.delete_one({'user_id': str(user['_id']), 'session_id': str(session['_id'])})
        
        return {'message': 'Arrived safely. Data will be deleted in 24h'}

@api_router.post("/escort/location")
async def log_escort_location(location: LocationPoint, user = Depends(get_current_user)):
    if not user.get('is_premium'):
        raise HTTPException(status_code=403, detail="Premium feature")
    
    session = await db.escort_sessions.find_one({'user_id': str(user['_id']), 'is_active': True})
    if not session:
        raise HTTPException(status_code=404, detail="No active session")
    
    # Update session history
    await db.escort_sessions.update_one(
        {'_id': session['_id']},
        {'$push': {'locations': {
            'latitude': location.latitude,
            'longitude': location.longitude,
            'timestamp': location.timestamp
        }}}
    )
    
    # Update real-time track
    await db.civil_tracks.update_one(
        {'user_id': str(user['_id']), 'is_active': True},
        {'$set': {
            'currentLocation': {
                'type': 'Point',
                'coordinates': [location.longitude, location.latitude],
                'timestamp': datetime.utcnow()
            }
        }}
    )
    
    return {'message': 'Location logged'}

@api_router.post("/report/create")
async def create_report(report: ReportCreate, user = Depends(get_current_user)):
    if user.get('role') != 'civil':
        raise HTTPException(status_code=403, detail="Only civil users can create reports")
    
    report_data = {
        'user_id': str(user['_id']),
        'type': report.type,
        'caption': report.caption,
        'is_anonymous': report.is_anonymous,
        'file_url': report.file_url,
        'thumbnail': report.thumbnail,
        'uploaded': report.uploaded,
        'location': {
            'type': 'Point',
            'coordinates': [report.longitude, report.latitude]
        },
        'geohash': geohash(report.latitude, report.longitude),
        'created_at': datetime.utcnow()
    }
    
    result = await db.civil_reports.insert_one(report_data)
    
    # Notify nearby security
    security_teams = await db.security_teams.find({
        'teamLocation.coordinates': {
            '$near': {
                '$geometry': {'type': 'Point', 'coordinates': [report.longitude, report.latitude]},
                '$maxDistance': 50000
            }
        }
    }).to_list(100)
    
    security_user_ids = [team['user_id'] for team in security_teams]
    if security_user_ids:
        await send_push_notification(
            security_user_ids,
            f"📹 New {report.type.upper()} Report",
            f"Report submitted nearby: {report.caption or 'No caption'}",
            {'type': 'report', 'report_id': str(result.inserted_id)}
        )
    
    return {'report_id': str(result.inserted_id), 'message': 'Report created'}

class VideoUpload(BaseModel):
    video_data: str  # Base64 encoded video
    caption: Optional[str] = None
    is_anonymous: bool = False
    latitude: float
    longitude: float
    duration_seconds: Optional[int] = 0

@api_router.post("/report/upload-video")
async def upload_video_report(video: VideoUpload, user = Depends(get_current_user)):
    """Upload video report with actual file data"""
    if user.get('role') != 'civil':
        raise HTTPException(status_code=403, detail="Only civil users can create reports")
    
    try:
        import base64
        import uuid
        
        # Decode base64 video data
        video_bytes = base64.b64decode(video.video_data)
        
        # Generate unique filename
        filename = f"video_{str(user['_id'])}_{uuid.uuid4().hex[:8]}.mp4"
        
        # Try to upload to Firebase Storage
        file_url = await firebase_service.upload_file(
            video_bytes,
            filename,
            'video/mp4',
            'videos'
        )
        
        # Create report record
        report_data = {
            'user_id': str(user['_id']),
            'type': 'video',
            'caption': video.caption or 'Video report',
            'is_anonymous': video.is_anonymous,
            'file_url': file_url,
            'thumbnail': None,
            'uploaded': True,
            'duration_seconds': video.duration_seconds,
            'location': {
                'type': 'Point',
                'coordinates': [video.longitude, video.latitude]
            },
            'geohash': geohash(video.latitude, video.longitude),
            'created_at': datetime.utcnow()
        }
        
        result = await db.civil_reports.insert_one(report_data)
        
        # Notify nearby security
        try:
            security_teams = await db.security_teams.find({
                'teamLocation.coordinates': {
                    '$near': {
                        '$geometry': {'type': 'Point', 'coordinates': [video.longitude, video.latitude]},
                        '$maxDistance': 50000
                    }
                }
            }).to_list(100)
            
            security_user_ids = [team['user_id'] for team in security_teams]
            if security_user_ids:
                await send_push_notification(
                    security_user_ids,
                    "📹 New VIDEO Report",
                    f"Video report submitted nearby: {video.caption or 'No caption'}",
                    {'type': 'report', 'report_id': str(result.inserted_id)}
                )
        except Exception as notify_err:
            logger.warning(f"Failed to notify security: {notify_err}")
        
        return {
            'report_id': str(result.inserted_id),
            'file_url': file_url,
            'message': 'Video report uploaded successfully'
        }
        
    except Exception as e:
        logger.error(f"Video upload error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to upload video: {str(e)}")

@api_router.get("/report/my-reports")
async def get_my_reports(user = Depends(get_current_user)):
    reports = await db.civil_reports.find({'user_id': str(user['_id'])}).sort('created_at', -1).to_list(100)
    return [{
        'id': str(r['_id']),
        'type': r['type'],
        'caption': r.get('caption'),
        'is_anonymous': r.get('is_anonymous'),
        'file_url': r.get('file_url'),
        'thumbnail': r.get('thumbnail'),
        'uploaded': r.get('uploaded'),
        'latitude': r['location']['coordinates'][1],
        'longitude': r['location']['coordinates'][0],
        'created_at': r['created_at']
    } for r in reports]

# ===== SECURITY USER ROUTES =====
@api_router.post("/security/set-location")
async def set_team_location(location: SetTeamLocation, user = Depends(get_current_user)):
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    await db.security_teams.update_one(
        {'user_id': str(user['_id'])},
        {'$set': {
            'teamLocation': {
                'type': 'Point',
                'coordinates': [location.longitude, location.latitude]
            },
            'radius_km': location.radius_km,
            'updated_at': datetime.utcnow()
        }},
        upsert=True
    )
    return {'message': 'Team location set'}

@api_router.get("/security/team-location")
async def get_team_location(user = Depends(get_current_user)):
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    team = await db.security_teams.find_one({'user_id': str(user['_id'])})
    if not team:
        return {'latitude': 0, 'longitude': 0, 'radius_km': 10.0}
    
    return {
        'latitude': team['teamLocation']['coordinates'][1],
        'longitude': team['teamLocation']['coordinates'][0],
        'radius_km': team.get('radius_km', 10.0)
    }

@api_router.get("/security/nearby-reports")
async def get_nearby_reports(user = Depends(get_current_user)):
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    team = await db.security_teams.find_one({'user_id': str(user['_id'])})
    if not team:
        return []
    
    # Check if team location is set
    team_location = team.get('teamLocation')
    if not team_location or team_location.get('coordinates', [0, 0]) == [0, 0]:
        # Return all recent reports if no location set
        reports = await db.civil_reports.find({}).sort('created_at', -1).to_list(50)
    else:
        radius_meters = team.get('radius_km', 10.0) * 1000
        try:
            reports = await db.civil_reports.find({
                'location': {
                    '$near': {
                        '$geometry': team_location,
                        '$maxDistance': radius_meters
                    }
                }
            }).sort('created_at', -1).to_list(100)
        except Exception as e:
            # If geospatial query fails, return recent reports
            logger.warning(f"Geospatial query failed: {e}")
            reports = await db.civil_reports.find({}).sort('created_at', -1).to_list(50)
    
    result = []
    for r in reports:
        user_info = await db.users.find_one({'_id': ObjectId(r['user_id'])})
        if not user_info:
            user_info = {'email': 'Unknown', 'phone': ''}
        
        result.append({
            'id': str(r['_id']),
            'type': r.get('type', 'unknown'),
            'caption': r.get('caption', ''),
            'is_anonymous': r.get('is_anonymous', False),
            'file_url': r.get('file_url'),
            'thumbnail': r.get('thumbnail'),
            'latitude': r.get('location', {}).get('coordinates', [0, 0])[1] if r.get('location') else 0,
            'longitude': r.get('location', {}).get('coordinates', [0, 0])[0] if r.get('location') else 0,
            'created_at': r.get('created_at'),
            'user_email': user_info.get('email', 'Unknown') if not r.get('is_anonymous') else 'Anonymous',
            'user_phone': user_info.get('phone', '') if not r.get('is_anonymous') else 'Anonymous',
            'duration_seconds': r.get('duration_seconds', 0)
        })
    
    return result

@api_router.get("/security/track-user/{user_id}")
async def track_user(user_id: str, user = Depends(get_current_user)):
    """Get tracking data for a specific user (civil user being tracked)"""
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    try:
        # Get the civil user
        target_user = await db.users.find_one({'_id': ObjectId(user_id)})
        if not target_user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Check if user has active panic or escort session
        active_panic = await db.panic_events.find_one({
            'user_id': user_id,
            'is_active': True
        })
        
        active_escort = await db.escort_sessions.find_one({
            'user_id': user_id,
            'status': 'active'
        })
        
        # Get latest location from panic or escort
        latitude = None
        longitude = None
        last_update = None
        is_active = False
        
        if active_panic:
            is_active = True
            if active_panic.get('locations') and len(active_panic['locations']) > 0:
                latest = active_panic['locations'][-1]
                latitude = latest.get('latitude')
                longitude = latest.get('longitude')
                last_update = latest.get('timestamp')
            elif active_panic.get('location'):
                coords = active_panic['location'].get('coordinates', [0, 0])
                longitude = coords[0]
                latitude = coords[1]
                last_update = active_panic.get('activated_at')
        elif active_escort:
            is_active = True
            if active_escort.get('route') and len(active_escort['route']) > 0:
                latest = active_escort['route'][-1]
                latitude = latest.get('latitude')
                longitude = latest.get('longitude')
                last_update = latest.get('timestamp')
        elif target_user.get('current_location'):
            coords = target_user['current_location'].get('coordinates', [0, 0])
            longitude = coords[0]
            latitude = coords[1]
            last_update = target_user.get('last_location_update')
        
        return {
            'user_id': user_id,
            'full_name': target_user.get('full_name', ''),
            'email': target_user.get('email', ''),
            'phone': target_user.get('phone', ''),
            'latitude': latitude,
            'longitude': longitude,
            'last_update': last_update.isoformat() if last_update else None,
            'is_active': is_active,
            'has_panic': active_panic is not None,
            'has_escort': active_escort is not None
        }
    except Exception as e:
        logger.error(f"Error tracking user: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/security/nearby-panics")
async def get_nearby_panics(user = Depends(get_current_user)):
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    team = await db.security_teams.find_one({'user_id': str(user['_id'])})
    if not team:
        return []
    
    # Check if team location is set
    team_location = team.get('teamLocation')
    if not team_location or team_location.get('coordinates', [0, 0]) == [0, 0]:
        # Return all active panics if no location set
        panics = await db.panic_events.find({'is_active': True}).sort('activated_at', -1).to_list(50)
    else:
        radius_meters = team.get('radius_km', 10.0) * 1000
        try:
            panics = await db.panic_events.find({
                'is_active': True,
                'location': {
                    '$near': {
                        '$geometry': team_location,
                        '$maxDistance': radius_meters
                    }
                }
            }).sort('activated_at', -1).to_list(50)
        except Exception as e:
            logger.warning(f"Geospatial query failed for panics: {e}")
            panics = await db.panic_events.find({'is_active': True}).sort('activated_at', -1).to_list(50)
    
    result = []
    for p in panics:
        user_info = await db.users.find_one({'_id': ObjectId(p['user_id'])})
        if not user_info:
            user_info = {'email': 'Unknown', 'phone': ''}
        
        latest_location = p.get('locations', [])[-1] if p.get('locations') else None
        
        # Safely get coordinates
        if latest_location:
            lat = latest_location.get('latitude', 0)
            lng = latest_location.get('longitude', 0)
        elif p.get('location') and p['location'].get('coordinates'):
            lat = p['location']['coordinates'][1]
            lng = p['location']['coordinates'][0]
        else:
            lat, lng = 0, 0
        
        result.append({
            'id': str(p['_id']),
            'user_email': user_info.get('email', 'Unknown'),
            'user_phone': user_info.get('phone', ''),
            'activated_at': p.get('activated_at'),
            'latitude': lat,
            'longitude': lng,
            'location_count': len(p.get('locations', [])),
            'emergency_category': p.get('emergency_category', 'other')
        })
    
    return result

@api_router.post("/security/search-user")
async def search_user(search: UserSearch, user = Depends(get_current_user)):
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    # Search by phone or email
    civil_user = await db.users.find_one({
        '$or': [
            {'email': search.search_term},
            {'phone': search.search_term}
        ],
        'role': 'civil'
    })
    
    if not civil_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get current track
    current_track = await db.civil_tracks.find_one({'user_id': str(civil_user['_id']), 'is_active': True})
    
    # Get historical sessions
    sessions = await db.escort_sessions.find(
        {'user_id': str(civil_user['_id'])}
    ).sort('started_at', -1).limit(10).to_list(10)
    
    return {
        'user_id': str(civil_user['_id']),
        'email': civil_user['email'],
        'phone': civil_user.get('phone'),
        'is_premium': civil_user.get('is_premium', False),
        'current_location': {
            'latitude': current_track['currentLocation']['coordinates'][1],
            'longitude': current_track['currentLocation']['coordinates'][0],
            'timestamp': current_track['currentLocation']['timestamp']
        } if current_track else None,
        'recent_sessions': [{
            'session_id': str(s['_id']),
            'started_at': s['started_at'],
            'ended_at': s.get('ended_at'),
            'is_active': s.get('is_active', False),
            'location_count': len(s.get('locations', []))
        } for s in sessions]
    }

@api_router.get("/security/user-history/{user_id}")
async def get_user_history(user_id: str, user = Depends(get_current_user)):
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    # Get all escort sessions for this user
    sessions = await db.escort_sessions.find(
        {'user_id': user_id}
    ).sort('started_at', -1).to_list(50)
    
    result = []
    for s in sessions:
        result.append({
            'session_id': str(s['_id']),
            'started_at': s['started_at'],
            'ended_at': s.get('ended_at'),
            'is_active': s.get('is_active', False),
            'locations': s.get('locations', [])
        })
    
    return result

# ===== PUSH TOKEN MANAGEMENT =====
@api_router.post("/push-token/register")
async def register_push_token(token: str = Body(...), user = Depends(get_current_user)):
    """Register Expo push token for user"""
    try:
        # Validate token format
        if not expo_push_service.is_valid_token(token):
            raise HTTPException(status_code=400, detail="Invalid Expo push token format")
        
        # Update user's push token
        await db.users.update_one(
            {'_id': user['_id']},
            {'$set': {
                'push_token': token,
                'push_token_updated_at': datetime.utcnow()
            }}
        )
        
        logging.info(f"Push token registered for user {user['email']}")
        return {'message': 'Push token registered successfully'}
        
    except Exception as e:
        logging.error(f"Push token registration error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.delete("/push-token/unregister")
async def unregister_push_token(user = Depends(get_current_user)):
    """Unregister push token"""
    try:
        await db.users.update_one(
            {'_id': user['_id']},
            {'$unset': {'push_token': '', 'push_token_updated_at': ''}}
        )
        return {'message': 'Push token unregistered successfully'}
    except Exception as e:
        logging.error(f"Push token unregister error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ===== PAYMENT ROUTES (REAL PAYSTACK) =====
@api_router.post("/payment/init")
async def init_payment(amount: float = Body(...), user = Depends(get_current_user)):
    """Initialize Paystack payment for premium subscription"""
    try:
        # Generate unique reference
        reference = f"SGD_{uuid.uuid4().hex[:12].upper()}"
        
        # Convert amount to kobo (₦2,000 = 200000 kobo)
        amount_in_kobo = int(amount * 100)
        
        # Initialize payment with Paystack
        result = await paystack_service.initialize_transaction(
            email=user['email'],
            amount=amount_in_kobo,
            reference=reference,
            callback_url=None  # Can add callback URL for mobile app
        )
        
        if result.get('status'):
            data = result.get('data', {})
            
            # Store payment reference in database
            await db.payment_transactions.insert_one({
                'user_id': str(user['_id']),
                'reference': reference,
                'amount': amount,
                'amount_kobo': amount_in_kobo,
                'status': 'pending',
                'created_at': datetime.utcnow()
            })
            
            return {
                'status': True,
                'authorization_url': data.get('authorization_url'),
                'access_code': data.get('access_code'),
                'reference': reference,
                'message': 'Payment initialized successfully'
            }
        else:
            raise HTTPException(status_code=400, detail="Payment initialization failed")
            
    except Exception as e:
        logging.error(f"Payment init error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/payment/verify/{reference}")
async def verify_payment(reference: str, user = Depends(get_current_user)):
    """Verify Paystack payment and activate premium"""
    try:
        # Verify payment with Paystack
        result = await paystack_service.verify_transaction(reference)
        
        if result.get('status'):
            data = result.get('data', {})
            
            if data.get('status') == 'success':
                # Update user to premium
                await db.users.update_one(
                    {'_id': user['_id']},
                    {'$set': {
                        'is_premium': True,
                        'premium_activated_at': datetime.utcnow()
                    }}
                )
                
                # Update transaction status
                await db.payment_transactions.update_one(
                    {'reference': reference},
                    {'$set': {
                        'status': 'completed',
                        'verified_at': datetime.utcnow(),
                        'paystack_data': data
                    }}
                )
                
                # Send confirmation email
                try:
                    await email_service.send_payment_confirmation(
                        to_email=user['email'],
                        amount=data.get('amount', 0) / 100,  # Convert from kobo
                        reference=reference
                    )
                except Exception as e:
                    logging.error(f"Email send error: {e}")
                
                return {
                    'status': 'success',
                    'message': 'Premium activated successfully!',
                    'amount': data.get('amount', 0) / 100,
                    'paid_at': data.get('paid_at')
                }
            else:
                return {
                    'status': 'failed',
                    'message': f"Payment status: {data.get('status')}"
                }
        else:
            raise HTTPException(status_code=400, detail="Payment verification failed")
            
    except Exception as e:
        logging.error(f"Payment verification error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class PaymentVerify(BaseModel):
    reference: str

@api_router.post("/payment/verify")
async def verify_payment_post(data: PaymentVerify, user = Depends(get_current_user)):
    """Verify payment and activate premium - POST version for demo"""
    try:
        # For demo purposes, auto-activate if reference starts with DEMO_
        if data.reference.startswith('DEMO_'):
            await db.users.update_one(
                {'_id': user['_id']},
                {'$set': {
                    'is_premium': True,
                    'premium_activated_at': datetime.utcnow()
                }}
            )
            return {
                'status': 'success',
                'message': 'Premium activated successfully! (Demo Mode)',
                'is_premium': True
            }
        
        # Otherwise try to verify with Paystack
        result = await paystack_service.verify_transaction(data.reference)
        
        if result.get('status') and result.get('data', {}).get('status') == 'success':
            await db.users.update_one(
                {'_id': user['_id']},
                {'$set': {
                    'is_premium': True,
                    'premium_activated_at': datetime.utcnow()
                }}
            )
            return {
                'status': 'success',
                'message': 'Premium activated successfully!',
                'is_premium': True
            }
        else:
            raise HTTPException(status_code=400, detail="Payment verification failed")
            
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Payment verification error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ===== ADMIN ROUTES =====

async def get_admin_user(authorization: Optional[str] = Header(None)):
    """Verify user is an admin"""
    user = await get_current_user(authorization)
    if user.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    return user

@api_router.post("/admin/login")
async def admin_login(login_data: AdminLogin):
    """Admin login endpoint"""
    user = await db.users.find_one({'email': login_data.email, 'role': 'admin'})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid admin credentials")
    
    # Support both 'password' and 'password_hash' field names
    password_field = user.get('password') or user.get('password_hash')
    if not password_field or not verify_password(login_data.password, password_field):
        raise HTTPException(status_code=401, detail="Invalid admin credentials")
    
    if not user.get('is_active', True):
        raise HTTPException(status_code=403, detail="Admin account is deactivated")
    
    token = create_token(str(user['_id']), user['email'], 'admin')
    
    return {
        'token': token,
        'user_id': str(user['_id']),
        'email': user['email'],
        'full_name': user.get('full_name', ''),
        'role': 'admin'
    }

@api_router.get("/admin/dashboard")
async def admin_dashboard(user: dict = Depends(get_admin_user)):
    """Get admin dashboard statistics"""
    total_users = await db.users.count_documents({})
    civil_users = await db.users.count_documents({'role': 'civil'})
    security_users = await db.users.count_documents({'role': 'security'})
    admin_users = await db.users.count_documents({'role': 'admin'})
    
    active_panics = await db.panic_events.count_documents({'is_active': True})
    total_panics = await db.panic_events.count_documents({})
    total_reports = await db.civil_reports.count_documents({})
    
    # Recent activity (last 24 hours)
    yesterday = datetime.utcnow() - timedelta(hours=24)
    recent_panics = await db.panic_events.count_documents({'activated_at': {'$gte': yesterday}})
    recent_reports = await db.civil_reports.count_documents({'created_at': {'$gte': yesterday}})
    new_users = await db.users.count_documents({'created_at': {'$gte': yesterday}})
    
    return {
        'total_users': total_users,
        'civil_users': civil_users,
        'security_users': security_users,
        'admin_users': admin_users,
        'active_panics': active_panics,
        'total_panics': total_panics,
        'total_reports': total_reports,
        'recent_24h': {
            'panics': recent_panics,
            'reports': recent_reports,
            'new_users': new_users
        }
    }

@api_router.get("/admin/users")
async def admin_get_users(
    role: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    user: dict = Depends(get_admin_user)
):
    """Get all users with optional role filter"""
    query = {}
    if role:
        query['role'] = role
    
    users = await db.users.find(query).skip(skip).limit(limit).to_list(length=limit)
    total = await db.users.count_documents(query)
    
    return {
        'users': [{
            'id': str(u['_id']),
            'email': u.get('email'),
            'full_name': u.get('full_name', ''),
            'phone': u.get('phone', ''),
            'role': u.get('role'),
            'security_sub_role': u.get('security_sub_role'),
            'team_name': u.get('team_name', ''),
            'is_active': u.get('is_active', True),
            'is_premium': u.get('is_premium', False),
            'status': u.get('status', 'offline'),
            'created_at': u.get('created_at', datetime.utcnow()).isoformat()
        } for u in users],
        'total': total,
        'skip': skip,
        'limit': limit
    }

@api_router.put("/admin/users/{user_id}/toggle")
async def admin_toggle_user(user_id: str, user: dict = Depends(get_admin_user)):
    """Activate/deactivate a user"""
    target_user = await db.users.find_one({'_id': ObjectId(user_id)})
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    new_status = not target_user.get('is_active', True)
    await db.users.update_one(
        {'_id': ObjectId(user_id)},
        {'$set': {'is_active': new_status}}
    )
    
    return {'message': f"User {'activated' if new_status else 'deactivated'}", 'is_active': new_status}

@api_router.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, user: dict = Depends(get_admin_user)):
    """Delete a user (soft delete by deactivating)"""
    result = await db.users.update_one(
        {'_id': ObjectId(user_id)},
        {'$set': {'is_active': False, 'deleted_at': datetime.utcnow()}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {'message': 'User deleted successfully'}

@api_router.get("/admin/security-map")
async def admin_security_map(user: dict = Depends(get_admin_user)):
    """Get all security users with their locations for map display"""
    security_users = await db.users.find({
        'role': 'security',
        'is_active': True,
        'current_location': {'$exists': True}
    }).to_list(length=500)
    
    return {
        'security_users': [{
            'id': str(u['_id']),
            'full_name': u.get('full_name', u.get('email', 'Unknown')),
            'email': u.get('email'),
            'security_sub_role': u.get('security_sub_role', 'team_member'),
            'team_name': u.get('team_name', ''),
            'status': u.get('status', 'offline'),
            'location': u.get('current_location'),
            'last_location_update': u.get('last_location_update', datetime.utcnow()).isoformat()
        } for u in security_users]
    }

@api_router.get("/admin/all-panics")
async def admin_all_panics(
    active_only: bool = False,
    skip: int = 0,
    limit: int = 50,
    user: dict = Depends(get_admin_user)
):
    """Get all panic events"""
    query = {'is_active': True} if active_only else {}
    panics = await db.panic_events.find(query).sort('activated_at', -1).skip(skip).limit(limit).to_list(length=limit)
    total = await db.panic_events.count_documents(query)
    
    return {
        'panics': [{
            'id': str(p['_id']),
            'user_id': p.get('user_id'),
            'is_active': p.get('is_active'),
            'emergency_category': p.get('emergency_category', 'other'),
            'location': p.get('location'),
            'activated_at': p.get('activated_at', datetime.utcnow()).isoformat(),
            'deactivated_at': p.get('deactivated_at').isoformat() if p.get('deactivated_at') else None
        } for p in panics],
        'total': total
    }

@api_router.get("/admin/all-reports")
async def admin_all_reports(
    report_type: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    user: dict = Depends(get_admin_user)
):
    """Get all reports"""
    query = {}
    if report_type:
        query['type'] = report_type
    
    reports = await db.civil_reports.find(query).sort('created_at', -1).skip(skip).limit(limit).to_list(length=limit)
    total = await db.civil_reports.count_documents(query)
    
    return {
        'reports': [{
            'id': str(r['_id']),
            'user_id': r.get('user_id'),
            'type': r.get('type'),
            'caption': r.get('caption', ''),
            'is_anonymous': r.get('is_anonymous', False),
            'file_url': r.get('file_url'),
            'location': r.get('location'),
            'created_at': r.get('created_at', datetime.utcnow()).isoformat()
        } for r in reports],
        'total': total
    }

@api_router.post("/admin/invite-codes")
async def admin_create_invite_code(code_data: CreateInviteCode, user: dict = Depends(get_admin_user)):
    """Create a new invite code for security registration"""
    code = code_data.code or f"SG-{uuid.uuid4().hex[:8].upper()}"
    
    existing = await db.invite_codes.find_one({'code': code})
    if existing:
        raise HTTPException(status_code=400, detail="Code already exists")
    
    invite = {
        'code': code,
        'max_uses': code_data.max_uses,
        'used_count': 0,
        'created_by': str(user['_id']),
        'created_at': datetime.utcnow(),
        'expires_at': datetime.utcnow() + timedelta(days=code_data.expires_days),
        'is_active': True
    }
    
    await db.invite_codes.insert_one(invite)
    return {'code': code, 'message': 'Invite code created successfully'}

@api_router.get("/admin/invite-codes")
async def admin_list_invite_codes(user: dict = Depends(get_admin_user)):
    """List all invite codes"""
    codes = await db.invite_codes.find().sort('created_at', -1).to_list(length=100)
    return {
        'codes': [{
            'id': str(c['_id']),
            'code': c['code'],
            'max_uses': c.get('max_uses', 10),
            'used_count': c.get('used_count', 0),
            'is_active': c.get('is_active', True),
            'expires_at': c.get('expires_at', datetime.utcnow()).isoformat(),
            'created_at': c.get('created_at', datetime.utcnow()).isoformat()
        } for c in codes]
    }

# ===== SECURITY USER ENHANCED ROUTES =====

@api_router.post("/security/update-location")
async def security_update_location(location: UpdateLocation, user: dict = Depends(get_current_user)):
    """Manually update security user's location"""
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    await db.users.update_one(
        {'_id': user['_id']},
        {'$set': {
            'current_location': {
                'type': 'Point',
                'coordinates': [location.longitude, location.latitude]
            },
            'last_location_update': datetime.utcnow()
        }}
    )
    
    return {'message': 'Location updated successfully', 'timestamp': datetime.utcnow().isoformat()}

@api_router.put("/security/status")
async def security_update_status(status_data: UpdateStatus, user: dict = Depends(get_current_user)):
    """Update security user's status"""
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    valid_statuses = ['available', 'busy', 'responding', 'offline']
    if status_data.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")
    
    await db.users.update_one(
        {'_id': user['_id']},
        {'$set': {'status': status_data.status, 'status_updated_at': datetime.utcnow()}}
    )
    
    return {'message': 'Status updated', 'status': status_data.status}

@api_router.put("/security/settings")
async def security_update_settings(settings: UpdateSecuritySettings, user: dict = Depends(get_current_user)):
    """Update security user's settings (radius, visibility)"""
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    update_data = {}
    if settings.visibility_radius_km is not None:
        update_data['visibility_radius_km'] = settings.visibility_radius_km
    if settings.status is not None:
        update_data['status'] = settings.status
    if settings.is_visible is not None:
        update_data['is_visible'] = settings.is_visible
    
    if update_data:
        await db.users.update_one({'_id': user['_id']}, {'$set': update_data})
    
    return {'message': 'Settings updated', 'updated': update_data}

@api_router.get("/security/nearby")
async def security_get_nearby(user: dict = Depends(get_current_user)):
    """Get nearby security users within the user's set radius"""
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    user_location = user.get('current_location')
    if not user_location:
        raise HTTPException(status_code=400, detail="Please update your location first")
    
    radius_km = user.get('visibility_radius_km', 25)  # Default 25km
    
    # Find nearby security users
    nearby = await db.users.find({
        'role': 'security',
        'is_active': True,
        'is_visible': {'$ne': False},  # Include if not explicitly hidden
        '_id': {'$ne': user['_id']},  # Exclude self
        'current_location': {
            '$near': {
                '$geometry': user_location,
                '$maxDistance': radius_km * 1000  # Convert to meters
            }
        }
    }).to_list(length=100)
    
    return {
        'nearby_users': [{
            'id': str(u['_id']),
            'full_name': u.get('full_name', u.get('email', 'Unknown')),
            'security_sub_role': u.get('security_sub_role', 'team_member'),
            'team_name': u.get('team_name', ''),
            'status': u.get('status', 'offline'),
            'location': u.get('current_location'),
            'last_location_update': u.get('last_location_update', datetime.utcnow()).isoformat()
        } for u in nearby],
        'your_radius_km': radius_km,
        'your_location': user_location
    }

@api_router.get("/security/profile")
async def security_get_profile(user: dict = Depends(get_current_user)):
    """Get security user's full profile"""
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    return {
        'id': str(user['_id']),
        'email': user.get('email'),
        'full_name': user.get('full_name', ''),
        'phone': user.get('phone', ''),
        'security_sub_role': user.get('security_sub_role', 'team_member'),
        'team_name': user.get('team_name', ''),
        'status': user.get('status', 'available'),
        'visibility_radius_km': user.get('visibility_radius_km', 25),
        'is_visible': user.get('is_visible', True),
        'current_location': user.get('current_location'),
        'last_location_update': user.get('last_location_update').isoformat() if user.get('last_location_update') else None
    }

# ===== CHAT & MESSAGING ROUTES =====

@api_router.get("/chat/conversations")
async def get_conversations(user: dict = Depends(get_current_user)):
    """Get all conversations for the current user"""
    user_id = str(user['_id'])
    
    conversations = await db.conversations.find({
        '$or': [
            {'participant_1': user_id},
            {'participant_2': user_id}
        ]
    }).sort('last_message_at', -1).to_list(length=50)
    
    result = []
    for conv in conversations:
        other_id = conv['participant_2'] if conv['participant_1'] == user_id else conv['participant_1']
        other_user = await db.users.find_one({'_id': ObjectId(other_id)})
        
        result.append({
            'id': str(conv['_id']),
            'other_user': {
                'id': other_id,
                'full_name': other_user.get('full_name', other_user.get('email', 'Unknown')) if other_user else 'Unknown',
                'security_sub_role': other_user.get('security_sub_role') if other_user else None,
                'status': other_user.get('status', 'offline') if other_user else 'offline'
            },
            'last_message': conv.get('last_message'),
            'last_message_at': conv.get('last_message_at', datetime.utcnow()).isoformat(),
            'unread_count': conv.get(f'unread_{user_id}', 0)
        })
    
    return {'conversations': result}

@api_router.post("/chat/start")
async def start_conversation(data: dict = Body(...), user: dict = Depends(get_current_user)):
    """Start a new conversation or get existing one"""
    user_id = str(user['_id'])
    to_user_id = data.get('other_user_id') or data.get('to_user_id')
    
    if not to_user_id:
        raise HTTPException(status_code=400, detail="other_user_id is required")
    
    # Check if conversation already exists
    existing = await db.conversations.find_one({
        '$or': [
            {'participant_1': user_id, 'participant_2': to_user_id},
            {'participant_1': to_user_id, 'participant_2': user_id}
        ]
    })
    
    if existing:
        return {'conversation_id': str(existing['_id']), 'existing': True}
    
    # Create new conversation
    conv = {
        'participant_1': user_id,
        'participant_2': to_user_id,
        'created_at': datetime.utcnow(),
        'last_message_at': datetime.utcnow(),
        f'unread_{user_id}': 0,
        f'unread_{to_user_id}': 0
    }
    result = await db.conversations.insert_one(conv)
    
    return {'conversation_id': str(result.inserted_id), 'existing': False}

@api_router.get("/chat/{conversation_id}/messages")
async def get_messages(conversation_id: str, skip: int = 0, limit: int = 50, user: dict = Depends(get_current_user)):
    """Get messages in a conversation"""
    user_id = str(user['_id'])
    
    # Verify user is part of conversation
    conv = await db.conversations.find_one({'_id': ObjectId(conversation_id)})
    if not conv or (conv['participant_1'] != user_id and conv['participant_2'] != user_id):
        raise HTTPException(status_code=403, detail="Not authorized to view this conversation")
    
    # Mark messages as read
    await db.conversations.update_one(
        {'_id': ObjectId(conversation_id)},
        {'$set': {f'unread_{user_id}': 0}}
    )
    
    messages = await db.messages.find({
        'conversation_id': conversation_id
    }).sort('created_at', -1).skip(skip).limit(limit).to_list(length=limit)
    
    return {
        'messages': [{
            'id': str(m['_id']),
            'from_user_id': m['from_user_id'],
            'content': m['content'],
            'message_type': m.get('message_type', 'text'),
            'created_at': m['created_at'].isoformat(),
            'is_mine': m['from_user_id'] == user_id
        } for m in reversed(messages)]
    }

@api_router.post("/chat/send")
async def send_message(message: SendMessage, user: dict = Depends(get_current_user)):
    """Send a message to another user"""
    user_id = str(user['_id'])
    
    # Find or create conversation
    conv = await db.conversations.find_one({
        '$or': [
            {'participant_1': user_id, 'participant_2': message.to_user_id},
            {'participant_1': message.to_user_id, 'participant_2': user_id}
        ]
    })
    
    if not conv:
        conv_result = await db.conversations.insert_one({
            'participant_1': user_id,
            'participant_2': message.to_user_id,
            'created_at': datetime.utcnow(),
            'last_message_at': datetime.utcnow()
        })
        conversation_id = str(conv_result.inserted_id)
    else:
        conversation_id = str(conv['_id'])
    
    # Create message
    msg = {
        'conversation_id': conversation_id,
        'from_user_id': user_id,
        'to_user_id': message.to_user_id,
        'content': message.content,
        'message_type': message.message_type,
        'created_at': datetime.utcnow()
    }
    result = await db.messages.insert_one(msg)
    
    # Update conversation
    await db.conversations.update_one(
        {'_id': ObjectId(conversation_id)},
        {
            '$set': {
                'last_message': message.content[:100],
                'last_message_at': datetime.utcnow()
            },
            '$inc': {f'unread_{message.to_user_id}': 1}
        }
    )
    
    # Send push notification to recipient
    await send_push_notification(
        [message.to_user_id],
        f"New message from {user.get('full_name', user.get('email', 'Security'))}",
        message.content[:100],
        {'type': 'chat', 'conversation_id': conversation_id, 'from_user_id': user_id}
    )
    
    return {
        'message_id': str(result.inserted_id),
        'conversation_id': conversation_id,
        'sent_at': datetime.utcnow().isoformat()
    }

@api_router.get("/chat/unread-count")
async def get_unread_count(user: dict = Depends(get_current_user)):
    """Get total unread message count"""
    user_id = str(user['_id'])
    
    pipeline = [
        {'$match': {
            '$or': [
                {'participant_1': user_id},
                {'participant_2': user_id}
            ]
        }},
        {'$group': {
            '_id': None,
            'total': {'$sum': f'$unread_{user_id}'}
        }}
    ]
    
    result = await db.conversations.aggregate(pipeline).to_list(length=1)
    total = result[0]['total'] if result else 0
    
    return {'unread_count': total}

# ===== DATA RESET AND SEED ENDPOINT =====
@api_router.post("/admin/reset-and-seed")
async def reset_and_seed_data():
    """Reset all data and create fresh specified accounts"""
    try:
        # Clear all old data
        await db.civil_reports.delete_many({})
        await db.panics.delete_many({})
        await db.panic_locations.delete_many({})
        await db.civil_tracks.delete_many({})
        await db.conversations.delete_many({})
        await db.messages.delete_many({})
        await db.users.delete_many({})
        
        # Create specified Civil users
        civil_users = [
            {"email": "ezedinachianthony@gmail.com", "password": "SafeGuard2025!", "full_name": "Anthony Ezedinachi", "phone": "+2349150810387"},
            {"email": "okpalaezeukwu@gmail.com", "password": "SafeGuard2025!", "full_name": "Chukwuma Okpalaezeukwu", "phone": "+234810866212"},
            {"email": "inspirohm@gmail.com", "password": "SafeGuard2025!", "full_name": "Romeo Ohanaekwu", "phone": "+2348023296883"},
        ]
        
        for user in civil_users:
            await db.users.insert_one({
                "email": user["email"],
                "password": hash_password(user["password"]),
                "full_name": user["full_name"],
                "phone": user["phone"],
                "role": "civil",
                "is_premium": False,
                "is_active": True,
                "created_at": datetime.utcnow()
            })
            logger.info(f"Created civil user: {user['email']}")
        
        # Create specified Security users
        security_users = [
            {"email": "stalexmurphy@udogachi.com", "password": "SecurePass2025!", "full_name": "Stanley Ezeh", "phone": "+2347065822677"},
            {"email": "ogabiya@udogachi.com", "password": "SecurePass2025!", "full_name": "Paul Biya", "phone": "+234803847211"},
        ]
        
        for user in security_users:
            await db.users.insert_one({
                "email": user["email"],
                "password": hash_password(user["password"]),
                "full_name": user["full_name"],
                "phone": user["phone"],
                "role": "security",
                "is_active": True,
                "created_at": datetime.utcnow()
            })
            logger.info(f"Created security user: {user['email']}")
        
        # Create specified Admin users
        admin_users = [
            {"email": "anthonyezedinachi@gmail.com", "password": "Admin123!", "full_name": "Anthony Ezedinachi", "phone": "+2347065852678"},
            {"email": "benchiobi@gmail.com", "password": "Admin123!", "full_name": "Ben Chiobi", "phone": "+2348033147184"},
        ]
        
        for user in admin_users:
            await db.users.insert_one({
                "email": user["email"],
                "password": hash_password(user["password"]),
                "full_name": user["full_name"],
                "phone": user["phone"],
                "role": "admin",
                "is_active": True,
                "created_at": datetime.utcnow()
            })
            logger.info(f"Created admin user: {user['email']}")
        
        # Recreate invite codes
        await db.invite_codes.delete_many({})
        default_codes = [
            {"code": "SECURITY2025", "max_uses": 100, "used_count": 0},
            {"code": "SAFEGUARD-TEAM", "max_uses": 50, "used_count": 0},
        ]
        for code_data in default_codes:
            await db.invite_codes.insert_one({
                **code_data,
                "created_at": datetime.utcnow(),
                "expires_at": datetime.utcnow() + timedelta(days=365),
                "is_active": True
            })
        
        return {
            "status": "success",
            "message": "Data reset and seeded successfully",
            "accounts_created": {
                "civil": 3,
                "security": 2,
                "admin": 2
            }
        }
    except Exception as e:
        logger.error(f"Reset error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ===== ADMIN SEARCH ENDPOINT =====
@api_router.get("/admin/search")
async def admin_search(
    query: str = "",
    data_type: str = "all",
    field: str = "all",
    start_date: str = None,
    end_date: str = None,
    user: dict = Depends(get_current_user)
):
    """Search all data - Admin only"""
    if user.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    results = []
    
    # Build search filter
    search_filter = {}
    if query:
        if field == 'name':
            search_filter['full_name'] = {'$regex': query, '$options': 'i'}
        elif field == 'email':
            search_filter['email'] = {'$regex': query, '$options': 'i'}
        elif field == 'phone':
            search_filter['phone'] = {'$regex': query, '$options': 'i'}
        else:
            search_filter['$or'] = [
                {'full_name': {'$regex': query, '$options': 'i'}},
                {'email': {'$regex': query, '$options': 'i'}},
                {'phone': {'$regex': query, '$options': 'i'}},
                {'caption': {'$regex': query, '$options': 'i'}}
            ]
    
    # Date filter
    date_filter = {}
    if start_date:
        try:
            date_filter['$gte'] = datetime.fromisoformat(start_date)
        except: pass
    if end_date:
        try:
            date_filter['$lte'] = datetime.fromisoformat(end_date) + timedelta(days=1)
        except: pass
    
    if date_filter:
        search_filter['created_at'] = date_filter
    
    # Search panics
    if data_type in ['all', 'panics']:
        panic_filter = {**search_filter}
        panics = await db.panics.find(panic_filter).limit(100).to_list(100)
        for p in panics:
            p['id'] = str(p['_id'])
            p['data_type'] = 'panic'
            del p['_id']
            results.append(p)
    
    # Search reports
    if data_type in ['all', 'reports']:
        report_filter = {**search_filter}
        reports = await db.civil_reports.find(report_filter).limit(100).to_list(100)
        for r in reports:
            r['id'] = str(r['_id'])
            r['data_type'] = 'report'
            del r['_id']
            results.append(r)
    
    # Search users
    if data_type in ['all', 'users']:
        user_filter = {**search_filter}
        users = await db.users.find(user_filter).limit(100).to_list(100)
        for u in users:
            u['id'] = str(u['_id'])
            u['data_type'] = 'user'
            del u['_id']
            if 'password' in u:
                del u['password']
            results.append(u)
    
    # Sort by date
    results.sort(key=lambda x: x.get('created_at', datetime.min), reverse=True)
    
    return {"results": results[:200], "total": len(results)}

# ===== ADMIN DELETE ENDPOINT =====
@api_router.delete("/admin/delete/{data_type}/{item_id}")
async def admin_delete(data_type: str, item_id: str, user: dict = Depends(get_current_user)):
    """Delete a record - Admin only"""
    if user.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    try:
        if data_type == 'panic':
            result = await db.panics.delete_one({'_id': ObjectId(item_id)})
        elif data_type == 'report':
            result = await db.civil_reports.delete_one({'_id': ObjectId(item_id)})
        elif data_type == 'user':
            result = await db.users.delete_one({'_id': ObjectId(item_id)})
        else:
            raise HTTPException(status_code=400, detail="Invalid data type")
        
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Record not found")
        
        return {"status": "deleted", "id": item_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ===== ADMIN TRACK USER ENDPOINT =====
@api_router.get("/admin/track-user/{user_id}")
async def admin_track_user(user_id: str, user: dict = Depends(get_current_user)):
    """Get user tracking data - Admin only"""
    if user.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    try:
        target_user = await db.users.find_one({'_id': ObjectId(user_id)})
        if not target_user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Get last known location from panics or security locations
        last_location = None
        
        # Check security team location
        if target_user.get('role') == 'security':
            team_loc = await db.security_locations.find_one({'user_id': user_id})
            if team_loc:
                last_location = {
                    'latitude': team_loc.get('latitude'),
                    'longitude': team_loc.get('longitude'),
                    'timestamp': team_loc.get('updated_at')
                }
        
        # Check panic locations
        panic_loc = await db.panic_locations.find_one(
            {'user_id': user_id},
            sort=[('timestamp', -1)]
        )
        if panic_loc and (not last_location or panic_loc.get('timestamp', datetime.min) > last_location.get('timestamp', datetime.min)):
            last_location = {
                'latitude': panic_loc.get('latitude'),
                'longitude': panic_loc.get('longitude'),
                'timestamp': panic_loc.get('timestamp')
            }
        
        # Count reports and panics
        total_reports = await db.civil_reports.count_documents({'user_id': user_id})
        total_panics = await db.panics.count_documents({'user_id': user_id})
        
        # Get recent activity
        recent_activity = []
        
        recent_reports = await db.civil_reports.find({'user_id': user_id}).sort('created_at', -1).limit(5).to_list(5)
        for r in recent_reports:
            recent_activity.append({
                'type': 'report',
                'description': f"{r.get('type', 'Report').title()} report submitted",
                'timestamp': r.get('created_at')
            })
        
        recent_panics = await db.panics.find({'user_id': user_id}).sort('created_at', -1).limit(5).to_list(5)
        for p in recent_panics:
            recent_activity.append({
                'type': 'panic',
                'description': f"{p.get('category', 'Emergency').replace('_', ' ').title()} panic triggered",
                'timestamp': p.get('created_at')
            })
        
        # Sort by timestamp
        recent_activity.sort(key=lambda x: x.get('timestamp', datetime.min), reverse=True)
        
        # Calculate active days
        all_dates = set()
        for r in recent_reports:
            if r.get('created_at'):
                all_dates.add(r['created_at'].date())
        for p in recent_panics:
            if p.get('created_at'):
                all_dates.add(p['created_at'].date())
        
        return {
            'user_id': user_id,
            'last_location': last_location,
            'total_reports': total_reports,
            'total_panics': total_panics,
            'active_days': len(all_dates),
            'recent_activity': recent_activity[:10]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ===== ADMIN MESSAGING ENDPOINT =====
@api_router.post("/admin/message")
async def admin_send_message(
    data: dict = Body(...),
    user: dict = Depends(get_current_user)
):
    """Send message to user - Admin only"""
    if user.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    to_user_id = data.get('to_user_id')
    content = data.get('content')
    
    if not to_user_id or not content:
        raise HTTPException(status_code=400, detail="to_user_id and content required")
    
    try:
        admin_id = str(user['_id'])
        
        # Find or create conversation
        conv = await db.conversations.find_one({
            '$or': [
                {'participant_1': admin_id, 'participant_2': to_user_id},
                {'participant_1': to_user_id, 'participant_2': admin_id}
            ]
        })
        
        if not conv:
            conv_result = await db.conversations.insert_one({
                'participant_1': admin_id,
                'participant_2': to_user_id,
                'is_admin_chat': True,
                'created_at': datetime.utcnow(),
                'last_message_at': datetime.utcnow()
            })
            conversation_id = str(conv_result.inserted_id)
        else:
            conversation_id = str(conv['_id'])
        
        # Create message
        msg = {
            'conversation_id': conversation_id,
            'from_user_id': admin_id,
            'to_user_id': to_user_id,
            'content': content,
            'message_type': 'admin_message',
            'created_at': datetime.utcnow()
        }
        result = await db.messages.insert_one(msg)
        
        # Update conversation
        await db.conversations.update_one(
            {'_id': ObjectId(conversation_id)},
            {
                '$set': {
                    'last_message': content[:100],
                    'last_message_at': datetime.utcnow()
                }
            }
        )
        
        # Send push notification
        target_user = await db.users.find_one({'_id': ObjectId(to_user_id)})
        if target_user and target_user.get('push_token'):
            await push_service.send_push_notification(
                [target_user['push_token']],
                "Message from Admin",
                content[:100],
                {'type': 'admin_message', 'conversation_id': conversation_id}
            )
        
        return {
            'message_id': str(result.inserted_id),
            'conversation_id': conversation_id,
            'sent_at': datetime.utcnow().isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Include router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@app.on_event("startup")
async def startup():
    await create_indexes()
    await create_default_admins()
    await create_default_invite_codes()
    logger.info("MongoDB indexes created and default admins initialized")

async def create_default_admins():
    """Create specified admin accounts if they don't exist"""
    default_admins = [
        {"email": "anthonyezedinachi@gmail.com", "password": "Admin123!", "full_name": "Anthony Ezedinachi", "phone": "+2347065852678"},
        {"email": "benchiobi@gmail.com", "password": "Admin123!", "full_name": "Ben Chiobi", "phone": "+2348033147184"},
    ]
    
    for admin in default_admins:
        existing = await db.users.find_one({"email": admin["email"]})
        if not existing:
            await db.users.insert_one({
                "email": admin["email"],
                "password": hash_password(admin["password"]),
                "full_name": admin["full_name"],
                "phone": admin.get("phone", ""),
                "role": "admin",
                "is_active": True,
                "created_at": datetime.utcnow()
            })
            logger.info(f"Created admin account: {admin['email']}")

async def create_default_invite_codes():
    """Create default invite codes for security registration"""
    default_codes = [
        {"code": "SECURITY2025", "max_uses": 100, "used_count": 0},
        {"code": "SAFEGUARD-TEAM", "max_uses": 50, "used_count": 0},
        {"code": "SUPERVISOR-ACCESS", "max_uses": 20, "used_count": 0},
    ]
    
    for code_data in default_codes:
        existing = await db.invite_codes.find_one({"code": code_data["code"]})
        if not existing:
            await db.invite_codes.insert_one({
                **code_data,
                "created_at": datetime.utcnow(),
                "expires_at": datetime.utcnow() + timedelta(days=365),
                "is_active": True
            })
            logger.info(f"Created invite code: {code_data['code']}")

@app.on_event("shutdown")
async def shutdown():
    client.close()
