"""Allowlisted Zlink API gateway. Credentials and tenant tokens stay on Debian."""
import json
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from jsonschema import Draft7Validator, FormatChecker
from pydantic import BaseModel, Field
from sqlalchemy import Integer, String, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.accounts import Base, User, effective_permissions, require_user

CATALOG = json.loads(Path(__file__).with_name("api_catalog.json").read_text(encoding="utf-8"))
OPERATIONS = {operation["id"]: operation for operation in CATALOG["operations"]}
ORIGIN = "https://zlink-open.minervaiot.com"
TOKEN_PATH = "/open-apis/authen/v1/tenantToken/internal"
MAX_RESPONSE = 4 * 1024 * 1024


class ApiAudit(Base):
    __tablename__ = "viewer_api_audit"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer)
    operation_id: Mapped[str] = mapped_column(String(64))
    http_status: Mapped[int] = mapped_column(Integer)
    response_code: Mapped[str] = mapped_column(String(100))
    duration_ms: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[str] = mapped_column(String(40))


class ZlinkClient:
    def __init__(self):
        self.app_key = os.getenv("ZLINK_APP_KEY", "")
        self.app_secret = os.getenv("ZLINK_APP_SECRET", "")
        self._token = ""
        self._expires = 0
        self._lock = threading.Lock()
        self.http = httpx.Client(timeout=httpx.Timeout(25, connect=8), trust_env=False, follow_redirects=False,
                                 headers={"Content-Type":"application/json", "Accept-Language":"en-US"})

    def close(self):
        self.http.close()

    def token(self):
        if not self.app_key or not self.app_secret:
            raise HTTPException(503, "API_CREDENTIALS_MISSING")
        with self._lock:
            if self._token and time.monotonic() < self._expires:
                return self._token
            try:
                response = self.http.post(ORIGIN + TOKEN_PATH,
                                          json={"appKey":self.app_key,"appSecret":self.app_secret})
                body = response.json()
            except (httpx.HTTPError, ValueError):
                raise HTTPException(502, "API_AUTH_UNAVAILABLE") from None
            if response.status_code != 200 or body.get("code") != "ZCOP0000":
                code = str(body.get("code", "unknown"))[:50]
                raise HTTPException(502, "API_AUTH_FAILED:" + code)
            data = body.get("data", {})
            token = data.get("tenantToken")
            if not isinstance(token, str) or not token.startswith("t-"):
                raise HTTPException(502, "API_AUTH_UNAVAILABLE")
            self._token = token
            self._expires = time.monotonic() + max(0, min(float(data.get("expiresIn", 3600)),3600) - 600)
            return token

    def execute(self, operation: dict, inputs: dict):
        if operation["kind"] == "connection":
            self.token()
            return 200, {"code":"ZCOP0000","message":"Connected","data":{"authenticated":True}}
        path = operation["path"]
        for name, value in inputs.get("path", {}).items():
            path = path.replace("{" + name + "}", quote(str(value),safe=""))
        # The URL is never accepted from the caller; only documented catalog paths.
        token = self.token()
        try:
            with self.http.stream(operation["method"], ORIGIN + path,
                                  params=inputs.get("query"), json=inputs.get("body"),
                                  headers={"Authorization":"Bearer " + token}) as response:
                content = bytearray()
                for chunk in response.iter_bytes():
                    content.extend(chunk)
                    if len(content) > MAX_RESPONSE:
                        raise HTTPException(502, "API_RESPONSE_TOO_LARGE")
                try:
                    body = json.loads(content)
                except ValueError:
                    raise HTTPException(502, "API_NON_JSON_RESPONSE") from None
                # Token expiration is not retried automatically: a timed-out write
                # could already have taken effect upstream.
                if response.status_code == 401:
                    self._expires = 0
                return response.status_code, body
        except httpx.HTTPError:
            raise HTTPException(502, "API_REQUEST_FAILED") from None


def require_api_user(user: User = Depends(require_user)):
    if not set(effective_permissions(user)) & {"api.read", "api.write"}:
        raise HTTPException(403,"AUTH_FORBIDDEN")
    return user


router = APIRouter(prefix="/integration", dependencies=[Depends(require_api_user)])


@router.get("/catalog")
def catalog():
    # App credentials are managed on the server, not entered in a public form.
    result = json.loads(json.dumps(CATALOG))
    for operation in result["operations"]:
        if operation["kind"] == "connection":
            operation["schema"] = {"type":"object","properties":{},"additionalProperties":False}
            operation["example"] = None
            operation["parameters"] = {}
    return result


@router.get("/status")
def status(request: Request):
    client = request.app.state.zlink_client
    return {"configured":bool(client.app_key and client.app_secret), "origin":ORIGIN,
            "operations":len(OPERATIONS),"articles":CATALOG["articles"]}


class Execution(BaseModel):
    inputs: dict = Field(default_factory=dict)
    confirmed: bool = False


@router.post("/execute/{operation_id}")
async def execute(operation_id: str, request: Request, user: User = Depends(require_api_user)):
    from starlette.concurrency import run_in_threadpool
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 1024 * 1024:
            raise HTTPException(413,"API_REQUEST_TOO_LARGE")
    try:
        payload = Execution.model_validate_json(raw)
    except ValueError:
        raise HTTPException(422,"API_INVALID_INPUT") from None
    operation = OPERATIONS.get(operation_id)
    if not operation:
        raise HTTPException(404,"API_OPERATION_NOT_FOUND")
    required = "api.write" if operation["kind"] == "mutation" else "api.read"
    if required not in effective_permissions(user):
        raise HTTPException(403,"AUTH_FORBIDDEN")
    if operation["kind"] == "mutation" and not payload.confirmed:
        raise HTTPException(409,"API_CONFIRM_REQUIRED")
    if operation["kind"] != "connection":
        validator = Draft7Validator(operation["schema"], format_checker=FormatChecker())
        if not validator.is_valid(payload.inputs):
            raise HTTPException(422,"API_INVALID_INPUT")
    started = time.monotonic()
    status_code, body = await run_in_threadpool(request.app.state.zlink_client.execute, operation, payload.inputs)
    duration = round((time.monotonic()-started)*1000)
    response_code = str(body.get("code", ""))[:100] if isinstance(body,dict) else ""
    def audit():
        with Session(request.app.state.accounts_engine) as db, db.begin():
            db.add(ApiAudit(user_id=user.id,operation_id=operation_id,http_status=status_code,
                            response_code=response_code,duration_ms=duration,
                            created_at=datetime.now(timezone.utc).isoformat()))
    await run_in_threadpool(audit)
    return {"http_status":status_code,"duration_ms":duration,"body":body}


@router.get("/history")
def history(request: Request, user: User = Depends(require_api_user)):
    with Session(request.app.state.accounts_engine) as db:
        statement = select(ApiAudit)
        if "users.manage" not in effective_permissions(user):
            statement = statement.where(ApiAudit.user_id == user.id)
        rows = db.scalars(statement.order_by(ApiAudit.id.desc()).limit(50)).all()
        return {"items":[dict(id=r.id,operation_id=r.operation_id,user_id=r.user_id,
                               http_status=r.http_status,response_code=r.response_code,
                               duration_ms=r.duration_ms,created_at=r.created_at) for r in rows]}
