"""Authenticated, read-only event browser API."""

import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

from app.callbacks import connect_database
from app.accounts import (authenticate, hash_password, password_matches, public_user,
    require_user, require_permission, router as accounts_router)

COOKIE = "zlink_viewer"
SESSION_SECONDS = 8 * 60 * 60


@dataclass(frozen=True)
class ViewerSettings:
    username: str = "trok"
    password_hash: str = field(default="", repr=False)
    session_secret: str = field(default="", repr=False)

    @classmethod
    def from_env(cls):
        return cls(os.getenv("ZLINK_VIEWER_USER", "trok"),
                   os.getenv("ZLINK_VIEWER_PASSWORD_HASH", ""),
                   os.getenv("ZLINK_VIEWER_SESSION_SECRET", ""))


def config(request: Request) -> ViewerSettings:
    result = request.app.state.viewer_settings
    if not result.password_hash or len(result.session_secret) < 32:
        raise HTTPException(503, "El acceso al visor todavía no está configurado")
    return result


def same_origin(request: Request):
    # Browser mutations must originate from this site. Non-browser clients may
    # omit Origin; session cookies additionally use SameSite=Strict.
    origin = request.headers.get("origin")
    if origin and origin != f"{request.url.scheme}://{request.url.netloc}":
        raise HTTPException(403, "Origen no permitido")


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


router = APIRouter(prefix="/api", dependencies=[Depends(same_origin)])
_attempts: dict[str, tuple[int, float]] = {}
_lock = threading.Lock()


@router.post("/login")
def login(data: Login, request: Request, response: Response):
    settings = config(request)
    address = request.client.host if request.client else "unknown"
    with _lock:
        now = time.monotonic()
        for key in list(_attempts):
            if now - _attempts[key][1] > 300:
                del _attempts[key]
        count, started = _attempts.get(address, (0, now))
        if count >= 5:
            raise HTTPException(429, "Demasiados intentos. Espera cinco minutos.")
        if len(_attempts) >= 4096 and address not in _attempts:
            raise HTTPException(429, "Espera unos minutos antes de volver a intentar")
        _attempts[address] = (count + 1, started)
    user, token = authenticate(request, data.username.lower(), data.password)
    with _lock:
        _attempts.pop(address, None)
    response.set_cookie(COOKIE, token, max_age=SESSION_SECONDS,
                        secure=True, httponly=True, samesite="strict", path="/api")
    return user


@router.get("/session")
def session(user = Depends(require_user)):
    return public_user(user)


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE, path="/api", secure=True, httponly=True, samesite="strict")
    return {"ok": True}


def date_value(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        raise HTTPException(422, "La fecha debe incluir una zona horaria")
    return value.astimezone(timezone.utc).isoformat()


@router.get("/events", dependencies=[Depends(require_permission("events.read"))])
def list_events(
    request: Request,
    q: str = Query(default="", max_length=200),
    event_code: str = Query(default="", max_length=256),
    since: datetime | None = None,
    until: datetime | None = None,
    page: int = Query(default=1, ge=1, le=1_000_000),
    page_size: int = Query(default=25, ge=1, le=100),
    order: Literal["asc", "desc"] = "desc",
):
    conditions, values = [], []
    if q:
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        conditions.append("(request_id LIKE ? ESCAPE '\\' OR event_code LIKE ? ESCAPE '\\' OR payload_json LIKE ? ESCAPE '\\')")
        values.extend([f"%{escaped}%"] * 3)
    if event_code:
        conditions.append("event_code = ?")
        values.append(event_code)
    start, end = date_value(since), date_value(until)
    if start and end and start > end:
        raise HTTPException(422, "El inicio debe ser anterior al final")
    for operator, value in ((">=", start), ("<=", end)):
        if value:
            conditions.append(f"received_at {operator} ?")
            values.append(value)
    where = " WHERE " + " AND ".join(conditions) if conditions else ""
    with connect_database(request.app.state.settings) as db:
        # One read snapshot keeps count and page consistent during ingestion.
        db.execute("BEGIN")
        total = db.execute("SELECT COUNT(*) FROM events" + where, values).fetchone()[0]
        rows = db.execute(
            "SELECT request_id,event_code,received_at,substr(payload_json,1,240),length(CAST(payload_json AS BLOB)) FROM events"
            + where + f" ORDER BY received_at {order}, request_id {order} LIMIT ? OFFSET ?",
            [*values, page_size, (page - 1) * page_size],
        ).fetchall()
    return {"total": total, "page": page, "page_size": page_size, "items": [
        dict(request_id=r[0], event_code=r[1], received_at=r[2], preview=r[3], size_bytes=r[4])
        for r in rows
    ]}


@router.get("/events-summary", dependencies=[Depends(require_permission("events.read"))])
def event_summary(request: Request):
    lima = timezone(timedelta(hours=-5))
    midnight = datetime.now(lima).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()
    with connect_database(request.app.state.settings) as db:
        db.execute("BEGIN")
        total, today, last = db.execute(
            "SELECT COUNT(*),COALESCE(SUM(received_at >= ?),0),MAX(received_at) FROM events", (midnight,)
        ).fetchone()
        codes = db.execute("SELECT event_code,COUNT(*) FROM events GROUP BY event_code ORDER BY COUNT(*) DESC,event_code").fetchall()
    return {"total": total, "today": today, "last_received_at": last,
            "event_codes": [{"code": code, "count": count} for code, count in codes]}


@router.get("/events/{request_id}", dependencies=[Depends(require_permission("events.read"))])
def event_detail(request_id: str, request: Request):
    with connect_database(request.app.state.settings) as db:
        row = db.execute(
            "SELECT request_id,event_code,received_at,payload_json FROM events WHERE request_id=?", (request_id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Evento no encontrado")
    return dict(request_id=row[0], event_code=row[1], received_at=row[2], payload=json.loads(row[3]))


router.include_router(accounts_router)
