from fastapi import FastAPI

app = FastAPI(title="ZLINK API", version="0.1.0")


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "ZLINK API", "docs": "/docs"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
