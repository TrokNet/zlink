"""Persistent accounts, Argon2 password hashes and server-side authorization."""
import hashlib
import hmac
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from itsdangerous import BadSignature, URLSafeTimedSerializer
from pydantic import BaseModel, Field, field_validator
from pwdlib import PasswordHash
from sqlalchemy import Boolean, Integer, String, Text, create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

PASSWORDS = PasswordHash.recommended()
PERMISSIONS = ("events.read", "users.manage", "api.read", "api.write")
COOKIE = "zlink_viewer"
SESSION_SECONDS = 8 * 60 * 60


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "viewer_users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    display_name: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(64), default="reader")
    permissions: Mapped[str] = mapped_column(Text, default="events.read")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    session_version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[str] = mapped_column(String(40))


class AccessProfile(Base):
    __tablename__ = "viewer_profiles"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    permissions: Mapped[str] = mapped_column(Text, default="")
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[str] = mapped_column(String(40))


SYSTEM_PROFILES = {
    "admin": ("Administrador", PERMISSIONS),
    "reader": ("Lector de eventos", ("events.read",)),
    "custom": ("Personalizado", ()),
}


def effective_permissions(user: User) -> list[str]:
    return list(PERMISSIONS) if user.role == "admin" else sorted(filter(None, user.permissions.split(",")))


def public_user(user: User) -> dict:
    return dict(id=user.id, username=user.username, display_name=user.display_name,
                role=user.role, permissions=effective_permissions(user),
                active=user.active, created_at=user.created_at)


def initialize_accounts(application):
    database = application.state.settings.database_path.resolve()
    engine = create_engine("sqlite:///" + str(database), connect_args={"timeout": 5})
    Base.metadata.create_all(engine)
    application.state.accounts_engine = engine
    seed = application.state.viewer_settings
    with Session(engine) as db, db.begin():
        for profile_id, (name, permissions) in SYSTEM_PROFILES.items():
            if db.get(AccessProfile, profile_id) is None:
                db.add(AccessProfile(
                    id=profile_id, name=name, permissions=",".join(permissions),
                    is_system=True, created_at=datetime.now(timezone.utc).isoformat(),
                ))
        if db.scalar(select(User.id).limit(1)) is None and seed.password_hash:
            db.add(User(username=seed.username, display_name=seed.username,
                        password_hash=seed.password_hash, role="admin",
                        permissions=",".join(PERMISSIONS), active=True,
                        created_at=datetime.now(timezone.utc).isoformat()))


def hash_password(password: str) -> str:
    return PASSWORDS.hash(password)


def password_matches(password: str, encoded: str) -> bool:
    try:
        if encoded.startswith("$argon2"):
            return PASSWORDS.verify(password, encoded)
        # One-time compatibility for the original environment-seeded account.
        iterations, salt, digest = encoded.split("$")
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations))
        return hmac.compare_digest(actual.hex(), digest)
    except (ValueError, TypeError):
        return False


def signer(request: Request):
    secret = request.app.state.viewer_settings.session_secret
    if len(secret) < 32:
        raise HTTPException(503, "El acceso al visor todavía no está configurado")
    return URLSafeTimedSerializer(secret, salt="zlink-accounts-v1")


def require_user(request: Request) -> User:
    try:
        token = signer(request).loads(request.cookies.get(COOKIE, ""), max_age=SESSION_SECONDS)
        with Session(request.app.state.accounts_engine) as db:
            user = db.get(User, int(token["id"]))
            if not user or not user.active or user.session_version != token["version"]:
                raise ValueError()
            return user
    except (BadSignature, ValueError, KeyError, TypeError):
        raise HTTPException(401, "Inicia sesión para consultar los eventos") from None


def require_permission(permission: str):
    def authorize(user: User = Depends(require_user)):
        if permission not in effective_permissions(user):
            raise HTTPException(403, "AUTH_FORBIDDEN")
        return user
    return authorize


def authenticate(request: Request, username: str, password: str) -> tuple[dict, str]:
    with Session(request.app.state.accounts_engine) as db, db.begin():
        user = db.scalar(select(User).where(User.username == username))
        if not user:
            # Equal-cost verification avoids the cheap nonexistent-user path.
            password_matches(password, request.app.state.dummy_password_hash)
            raise HTTPException(401, "Usuario o contraseña incorrectos")
        if not password_matches(password, user.password_hash) or not user.active:
            raise HTTPException(401, "Usuario o contraseña incorrectos")
        if not user.password_hash.startswith("$argon2"):
            user.password_hash = hash_password(password)
        token = signer(request).dumps({"id": user.id, "version": user.session_version,
                                      "nonce": secrets.token_hex(16)})
        return public_user(user), token


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_.-]+$")
    display_name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=256)
    role: str = Field(default="reader", min_length=1, max_length=64,
                      pattern=r"^(admin|reader|custom|profile_[a-f0-9]{16})$")
    permissions: list[str] = Field(default_factory=lambda: ["events.read"], max_length=4)

    @field_validator("display_name")
    @classmethod
    def valid_name(cls, value):
        if not value.strip():
            raise ValueError("Name is required")
        return value.strip()

    @field_validator("permissions")
    @classmethod
    def valid_permissions(cls, value):
        if set(value) - set(PERMISSIONS):
            raise ValueError("Invalid permission")
        return sorted(set(value))


class UserUpdate(BaseModel):
    display_name: str = Field(min_length=1, max_length=100)
    role: str = Field(min_length=1, max_length=64,
                      pattern=r"^(admin|reader|custom|profile_[a-f0-9]{16})$")
    permissions: list[str] = Field(max_length=4)
    active: bool
    password: str | None = Field(default=None, min_length=8, max_length=256)
    _validate = field_validator("permissions")(UserCreate.valid_permissions.__func__)
    _validate_name = field_validator("display_name")(UserCreate.valid_name.__func__)


router = APIRouter(prefix="/users")


class ProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    permissions: list[str] = Field(default_factory=list, max_length=4)

    @field_validator("name")
    @classmethod
    def valid_profile_name(cls, value):
        if not value.strip():
            raise ValueError("Profile name is required")
        return value.strip()

    @field_validator("permissions")
    @classmethod
    def valid_profile_permissions(cls, value):
        if set(value) - set(PERMISSIONS):
            raise ValueError("Invalid permission")
        return sorted(set(value))


ProfileUpdate = ProfileCreate


def public_profile(profile: AccessProfile, user_count: int = 0) -> dict:
    return dict(id=profile.id, name=profile.name,
                permissions=sorted(filter(None, profile.permissions.split(","))),
                is_system=profile.is_system, users_count=user_count,
                created_at=profile.created_at)


def profile_user_count(db: Session, profile_id: str) -> int:
    from sqlalchemy import func
    return db.scalar(select(func.count()).select_from(User).where(User.role == profile_id)) or 0


def selected_permissions(db: Session, role_id: str, submitted: list[str]) -> list[str]:
    profile = db.get(AccessProfile, role_id)
    if not profile:
        raise HTTPException(422, "AUTH_PROFILE_NOT_FOUND")
    if role_id == "custom":
        return submitted
    return sorted(filter(None, profile.permissions.split(",")))


@router.get("/profiles")
def list_profiles(request: Request, actor=Depends(require_permission("users.manage"))):
    with Session(request.app.state.accounts_engine) as db:
        profiles = db.scalars(select(AccessProfile)).all()
        system_order = {key: index for index, key in enumerate(SYSTEM_PROFILES)}
        profiles.sort(key=lambda item: (not item.is_system,
                                        system_order.get(item.id, 99), item.name.casefold()))
        return {"items": [public_profile(profile, profile_user_count(db, profile.id))
                           for profile in profiles]}


@router.post("/profiles", status_code=201)
def create_profile(data: ProfileCreate, request: Request,
                   actor=Depends(require_permission("users.manage"))):
    profile = AccessProfile(
        id="profile_" + secrets.token_hex(8), name=data.name,
        permissions=",".join(data.permissions), is_system=False,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    try:
        with Session(request.app.state.accounts_engine) as db, db.begin():
            if any(item.name.casefold() == data.name.casefold()
                   for item in db.scalars(select(AccessProfile)).all()):
                raise HTTPException(409, "AUTH_PROFILE_EXISTS")
            db.add(profile)
            db.flush()
            return public_profile(profile)
    except IntegrityError:
        raise HTTPException(409, "AUTH_PROFILE_EXISTS") from None


@router.put("/profiles/{profile_id}")
def update_profile(profile_id: str, data: ProfileUpdate, request: Request,
                   actor=Depends(require_permission("users.manage"))):
    with Session(request.app.state.accounts_engine) as db:
        db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        profile = db.get(AccessProfile, profile_id)
        if not profile:
            raise HTTPException(404, "AUTH_PROFILE_NOT_FOUND")
        if profile.is_system:
            raise HTTPException(409, "AUTH_SYSTEM_PROFILE")
        if any(item.id != profile_id and item.name.casefold() == data.name.casefold()
               for item in db.scalars(select(AccessProfile)).all()):
            raise HTTPException(409, "AUTH_PROFILE_EXISTS")
        permissions = ",".join(data.permissions)
        if profile_id == actor.role and "users.manage" not in data.permissions:
            raise HTTPException(409, "AUTH_SELF_LOCKOUT")
        permissions_changed = profile.permissions != permissions
        profile.name = data.name
        profile.permissions = permissions
        users = db.scalars(select(User).where(User.role == profile_id)).all()
        for user in users:
            if permissions_changed:
                user.permissions = permissions
                user.session_version += 1
        result = public_profile(profile, len(users))
        db.commit()
        return result


@router.delete("/profiles/{profile_id}")
def delete_profile(profile_id: str, request: Request,
                   actor=Depends(require_permission("users.manage"))):
    with Session(request.app.state.accounts_engine) as db:
        db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        profile = db.get(AccessProfile, profile_id)
        if not profile:
            raise HTTPException(404, "AUTH_PROFILE_NOT_FOUND")
        if profile.is_system:
            raise HTTPException(409, "AUTH_SYSTEM_PROFILE")
        if profile_user_count(db, profile_id):
            raise HTTPException(409, "AUTH_PROFILE_IN_USE")
        db.delete(profile)
        db.commit()
    return {"ok": True}


@router.get("")
def list_users(request: Request, actor=Depends(require_permission("users.manage")),
               page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)):
    from sqlalchemy import func
    with Session(request.app.state.accounts_engine) as db:
        total = db.scalar(select(func.count()).select_from(User))
        users = db.scalars(select(User).order_by(User.username).limit(page_size).offset((page-1)*page_size)).all()
        return {"total": total, "items": [public_user(user) for user in users]}


@router.post("", status_code=201)
def create_user(data: UserCreate, request: Request, actor=Depends(require_permission("users.manage"))):
    try:
        with Session(request.app.state.accounts_engine) as db, db.begin():
            permissions = selected_permissions(db, data.role, data.permissions)
            user = User(username=data.username.lower(), display_name=data.display_name.strip(),
                        password_hash=hash_password(data.password), role=data.role,
                        permissions=",".join(permissions), active=True,
                        created_at=datetime.now(timezone.utc).isoformat())
            db.add(user)
            db.flush()
            result = public_user(user)
        return result
    except IntegrityError:
        raise HTTPException(409, "AUTH_USERNAME_EXISTS") from None


@router.patch("/{user_id}")
def update_user(user_id: int, data: UserUpdate, request: Request,
                actor=Depends(require_permission("users.manage"))):
    new_hash = hash_password(data.password) if data.password else None
    with Session(request.app.state.accounts_engine) as db:
        # Serialize account changes so concurrent demotions cannot remove all admins.
        db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        user = db.get(User, user_id)
        if not user:
            raise HTTPException(404, "AUTH_USER_NOT_FOUND")
        permissions = selected_permissions(db, data.role, data.permissions)
        if user.id == actor.id and (not data.active or data.role != actor.role or
                                   "users.manage" not in (list(PERMISSIONS) if data.role == "admin" else permissions)):
            raise HTTPException(409, "AUTH_SELF_LOCKOUT")
        if user.role == "admin" and user.active and (data.role != "admin" or not data.active):
            admins = db.scalars(select(User.id).where(User.role == "admin", User.active.is_(True))).all()
            if len(admins) <= 1:
                raise HTTPException(409, "AUTH_LAST_ADMIN")
        user.display_name = data.display_name.strip()
        user.role = data.role
        user.permissions = ",".join(permissions)
        user.active = data.active
        if new_hash:
            user.password_hash = new_hash
        user.session_version += 1
        result = public_user(user)
        db.commit()
        return result
