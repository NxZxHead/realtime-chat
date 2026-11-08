from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime
from uuid import uuid4


class UserCreate(BaseModel):
    email: EmailStr
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    tokens_left: int
    user_id: str
    username: str


class Message(BaseModel):
    id: str
    room_id: str
    sender_id: str
    sender_username: str
    content: str
    timestamp: datetime
    type: str = "text"  # text, screen_start, screen_stop, user_joined, user_left


class Room(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    created_at: datetime
    members: List[str] = []


class Ping(BaseModel):
    type: str = "ping"
    timestamp: int


class Pong(BaseModel):
    type: str = "pong"
    timestamp: int


class ScreenShareInit(BaseModel):
    offer: dict
    user_id: str
    room_id: str


class ScreenShareCandidate(BaseModel):
    user_id: str
    room_id: str
    candidate: dict


class ScreenShareAnswer(BaseModel):
    answer: dict
    user_id: str
    room_id: str
