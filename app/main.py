from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from starlette.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from app.viewer import ViewerSettings, router as viewer_router, same_origin
from app.accounts import initialize_accounts, hash_password
from app.integration import ZlinkClient, router as integration_router

from app.callbacks import (
    MAX_BODY_BYTES,
    Settings,
    decrypt,
    initialize_database,
    receive_event,
    verify_request,
)


def create_app(settings: Settings | None = None, viewer_settings: ViewerSettings | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        application.state.settings = settings or Settings.from_env()
        application.state.viewer_settings = viewer_settings or ViewerSettings.from_env()
        await run_in_threadpool(initialize_database, application.state.settings)
        await run_in_threadpool(initialize_accounts, application)
        application.state.zlink_client = ZlinkClient()
        application.state.dummy_password_hash = await run_in_threadpool(hash_password, "nonexistent-account-placeholder")
        try:
            yield
        finally:
            application.state.accounts_engine.dispose()
            application.state.zlink_client.close()

    application = FastAPI(title="ZLINK API", version="0.3.0", lifespan=lifespan)
    application.include_router(viewer_router)
    application.include_router(integration_router, prefix="/api", dependencies=[Depends(same_origin)])

    @application.middleware("http")
    async def private_responses(request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/") or request.url.path in ("/", "/events", "/dashboard", "/users", "/profiles"):
            response.headers["Cache-Control"] = "no-store"
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["X-Frame-Options"] = "DENY"
        return response

    @application.get("/")
    def root():
        return RedirectResponse("/dashboard", status_code=302)

    frontend = Path(__file__).resolve().parent.parent / "frontend" / "dist"
    if frontend.is_dir():
        application.mount("/assets", StaticFiles(directory=frontend / "assets"), name="assets")

    @application.get("/dashboard", include_in_schema=False)
    @application.get("/integration", include_in_schema=False)
    @application.get("/users", include_in_schema=False)
    @application.get("/profiles", include_in_schema=False)
    @application.get("/events", include_in_schema=False)
    def events_page():
        if not (frontend / "index.html").is_file():
            raise HTTPException(503, "La interfaz todavía no está compilada")
        return FileResponse(frontend / "index.html")

    @application.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @application.get("/webhooks/zlink")
    def verify_callback(
        request: Request,
        sign: str = Query(max_length=32),
        timestamp: str = Query(max_length=20),
        nonce: str = Query(max_length=128),
        echo: str = Query(max_length=8192),
    ) -> dict[str, str]:
        config = request.app.state.settings
        verify_request(config, sign, timestamp, nonce)
        return {
            "code": "ZCOP0000",
            "message": "Operation successful",
            "data": decrypt(config, echo),
        }

    @application.post("/webhooks/zlink")
    async def event_callback(
        request: Request,
        sign: str = Query(max_length=32),
        timestamp: str = Query(max_length=20),
        nonce: str = Query(max_length=128),
    ) -> dict[str, str]:
        config = request.app.state.settings
        verify_request(config, sign, timestamp, nonce)
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > MAX_BODY_BYTES:
                raise HTTPException(413, "Callback body too large")
        await run_in_threadpool(receive_event, config, bytes(body))
        return {"code": "ZCOP0000", "message": "Operation successful"}

    return application


app = create_app()
