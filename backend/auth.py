"""
auth.py — JWT authentication for Formula AI Global

Self-contained module: register, login, /me, refresh, role/tier guards.
Bug fixes vs spec:
  • Added missing imports (BaseModel, Optional, Dict)
  • UserInDB has all stripe-related optional fields
  • bcrypt cost set explicitly (rounds=12)
  • Tier guard returns FastAPI dependency correctly
  • Used `timezone.utc` instead of naive datetimes
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field

# ──────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change-me-in-production-please")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 1 day

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)
security = HTTPBearer(auto_error=True)

router = APIRouter(prefix="/auth", tags=["Authentication"])

# ──────────────────────────────────────────────────────────────────
# Models
# ──────────────────────────────────────────────────────────────────
class UserInDB(BaseModel):
    id: str
    email: EmailStr
    full_name: Optional[str] = None
    role: str = Field(default="user", description="user · chemist · admin")
    subscription_tier: str = Field(default="free", description="free · starter · pro · business · enterprise")
    formulas_used_this_month: int = 0
    api_calls_today: int = 0
    is_active: bool = True
    stripe_customer_id: Optional[str] = None
    stripe_subscription_id: Optional[str] = None
    subscription_status: Optional[str] = None
    subscription_end: Optional[datetime] = None


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: Dict[str, Any]


class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: Optional[str] = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


# ──────────────────────────────────────────────────────────────────
# Password helpers
# ──────────────────────────────────────────────────────────────────
def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode["exp"] = expire
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


# ──────────────────────────────────────────────────────────────────
# Dependencies
# ──────────────────────────────────────────────────────────────────
def make_get_current_user(supabase_client):
    """
    Factory that returns a `get_current_user` dependency bound to a Supabase client.
    Pass your initialized Supabase client; the returned function is FastAPI-ready.
    """
    async def get_current_user(
        credentials: HTTPAuthorizationCredentials = Depends(security),
    ) -> UserInDB:
        token = credentials.credentials
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            user_id = payload.get("sub")
            if not user_id:
                raise _credentials_exception()
        except JWTError:
            raise _credentials_exception()

        response = supabase_client.table("users").select("*").eq("id", user_id).single().execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="User not found")
        return UserInDB(**response.data)

    return get_current_user


def make_get_current_active_user(get_current_user):
    async def get_current_active_user(
        current_user: UserInDB = Depends(get_current_user),
    ) -> UserInDB:
        if not current_user.is_active:
            raise HTTPException(status_code=400, detail="Inactive user")
        return current_user

    return get_current_active_user


def require_tier(min_tier: str, tier_order=None):
    """
    Dependency factory: enforce a minimum subscription tier.

    Usage:
        @app.get("/api-only", dependencies=[Depends(require_tier("pro", get_active_user))])
    """
    if tier_order is None:
        tier_order = ["free", "starter", "pro", "business", "enterprise"]

    def builder(get_current_active_user_dep):
        async def dependency(
            current_user: UserInDB = Depends(get_current_active_user_dep),
        ) -> UserInDB:
            try:
                user_idx = tier_order.index(current_user.subscription_tier)
                req_idx = tier_order.index(min_tier)
            except ValueError:
                raise HTTPException(status_code=403, detail="Unknown subscription tier")
            if user_idx < req_idx:
                raise HTTPException(
                    status_code=403,
                    detail=f"This feature requires {min_tier}+ subscription. Upgrade at /pricing",
                )
            return current_user

        return dependency

    return builder


# ──────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────
def _credentials_exception() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid authentication credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


def build_token_response(user_row: Dict[str, Any]) -> Token:
    access = create_access_token(
        data={
            "sub": user_row["id"],
            "email": user_row["email"],
            "role": user_row.get("role", "user"),
        },
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return Token(
        access_token=access,
        token_type="bearer",
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user={
            "id": user_row["id"],
            "email": user_row["email"],
            "full_name": user_row.get("full_name"),
            "role": user_row.get("role", "user"),
            "subscription_tier": user_row.get("subscription_tier", "free"),
        },
    )


# ──────────────────────────────────────────────────────────────────
# Routes — call `register_auth_routes(app, supabase)` from main.py
# ──────────────────────────────────────────────────────────────────
def register_auth_routes(app, supabase_client):
    """Wire authentication routes into the given FastAPI app."""
    get_user = make_get_current_user(supabase_client)
    get_active = make_get_current_active_user(get_user)

    @router.post("/register", response_model=Token)
    async def register(data: UserRegister) -> Token:
        existing = (
            supabase_client.table("users")
            .select("id")
            .eq("email", data.email)
            .execute()
        )
        if existing.data:
            raise HTTPException(status_code=400, detail="Email already registered")

        hashed = hash_password(data.password)
        new_user = {
            "email": data.email,
            "password_hash": hashed,
            "full_name": data.full_name,
            "role": "user",
            "subscription_tier": "free",
            "is_active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        result = supabase_client.table("users").insert(new_user).execute()
        return build_token_response(result.data[0])

    @router.post("/login", response_model=Token)
    async def login(data: UserLogin) -> Token:
        result = (
            supabase_client.table("users")
            .select("*")
            .eq("email", data.email)
            .single()
            .execute()
        )
        user = result.data
        if not user or not verify_password(data.password, user.get("password_hash", "")):
            raise HTTPException(status_code=401, detail="Invalid email or password")
        if not user.get("is_active", True):
            raise HTTPException(status_code=403, detail="Account disabled")
        return build_token_response(user)

    @router.get("/me")
    async def get_me(current_user: UserInDB = Depends(get_active)) -> Dict[str, Any]:
        return current_user.model_dump()

    @router.post("/refresh", response_model=Token)
    async def refresh(current_user: UserInDB = Depends(get_active)) -> Token:
        return build_token_response(current_user.model_dump())

    @router.post("/logout")
    async def logout() -> Dict[str, str]:
        # Stateless JWT — client should drop the token. Optionally maintain a denylist.
        return {"status": "logged_out"}

    app.include_router(router)
    return {"get_current_user": get_user, "get_current_active_user": get_active}
