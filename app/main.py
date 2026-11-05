from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from starlette.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from app.viewer import ViewerSettings, router as viewer_router

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
        yield

    application = FastAPI(title="ZLINK API", version="0.3.0", lifespan=lifespan)
    application.include_router(viewer_router)

    @application.middleware("http")
    async def private_responses(request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/") or request.url.path in ("/", "/events"):
            response.headers["Cache-Control"] = "no-store"
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["X-Frame-Options"] = "DENY"
        return response

    @application.get("/")
    def root():
        return RedirectResponse("/events", status_code=302)

    frontend = Path(__file__).resolve().parent.parent / "frontend" / "dist"
    if frontend.is_dir():
        application.mount("/assets", StaticFiles(directory=frontend / "assets"), name="assets")

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
