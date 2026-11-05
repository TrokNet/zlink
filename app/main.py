from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request
from starlette.concurrency import run_in_threadpool

from app.callbacks import (
    MAX_BODY_BYTES,
    Settings,
    decrypt,
    initialize_database,
    receive_event,
    verify_request,
)


def create_app(settings: Settings | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        application.state.settings = settings or Settings.from_env()
        await run_in_threadpool(initialize_database, application.state.settings)
        yield

    application = FastAPI(title="ZLINK API", version="0.2.0", lifespan=lifespan)

    @application.get("/")
    def root() -> dict[str, str]:
        return {"message": "ZLINK API", "docs": "/docs"}

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
