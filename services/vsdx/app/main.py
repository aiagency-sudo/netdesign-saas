from __future__ import annotations

from fastapi import FastAPI, HTTPException, Response

from app.models import Design
from app.vsdx_builder import VsdxBuildError, build_vsdx_bytes

app = FastAPI(title="NetDesign AI — vsdx export service", version="0.1.0")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/export")
def export_design(design: Design) -> Response:
    try:
        vsdx_bytes = build_vsdx_bytes(design)
    except VsdxBuildError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    filename = _safe_filename(design.meta.name)
    return Response(
        content=vsdx_bytes,
        media_type="application/vnd.ms-visio.drawing",
        headers={"Content-Disposition": f'attachment; filename="{filename}.vsdx"'},
    )


def _safe_filename(name: str) -> str:
    safe = "".join(c if c.isalnum() or c in "-_ " else "_" for c in name).strip() or "design"
    return safe
