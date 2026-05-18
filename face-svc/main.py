"""
DigiRx face-svc — DeepFace-based embedding service.

Internal-only HTTP API consumed by the NestJS backend. Receives a JPEG/PNG
upload, runs DeepFace.represent() with Facenet512, and returns the
512-dim L2-normalized embedding plus the detector's face confidence.

The service NEVER stores the original image — frames are processed in
memory and discarded. Only the embedding leaves the process.
"""
from __future__ import annotations

import io
import logging
import os
import time
from typing import Any

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from PIL import Image

# DeepFace pulls TensorFlow lazily on first call. Importing it at module
# load time so the first request doesn't pay the warm-up cost.
from deepface import DeepFace

# Production-tested combo for clinic-grade recognition. Swap via env if
# you want to A/B a different model without changing code.
#
# Detector choices, fast → slow:
#   `opencv`     ~30ms, mediocre accuracy — fine only on perfectly framed shots
#   `ssd`        ~80ms, decent
#   `mtcnn`      ~300ms, good balance
#   `retinaface` ~1500ms, highest accuracy — DEFAULT for clinic-grade matching
# Detection runs on every /embed call so the choice dominates latency.
MODEL_NAME = os.environ.get("DEEPFACE_MODEL", "Facenet512")
DETECTOR_BACKEND = os.environ.get("DEEPFACE_DETECTOR", "retinaface")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("face-svc")

app = FastAPI(title="DigiRx face-svc", version="0.1.0")


@app.on_event("startup")
def _warmup() -> None:
    """Force the model + detector to load now, not on first user request.

    DeepFace caches both globally after the first call. We pass a tiny
    1x1 grey image and tolerate the "no face detected" error — the goal
    is to populate the model cache, not to embed anything.
    """
    log.info(f"Warming up DeepFace model={MODEL_NAME} detector={DETECTOR_BACKEND}")
    tiny = np.zeros((112, 112, 3), dtype=np.uint8) + 128
    try:
        DeepFace.represent(
            img_path=tiny,
            model_name=MODEL_NAME,
            detector_backend=DETECTOR_BACKEND,
            enforce_detection=False,
        )
    except Exception as e:
        # enforce_detection=False shouldn't raise, but if it does, log
        # and continue — first real request will load the model.
        log.warning(f"Warmup hit exception (non-fatal): {e}")
    log.info("face-svc ready")


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "detector": DETECTOR_BACKEND,
    }


@app.post("/embed")
async def embed(
    image: UploadFile = File(...),
    pre_detected: str = Form(default="false"),
) -> dict[str, Any]:
    """Return the 512-d embedding for the largest face in the image.

    Refuses requests where no face is detected — the backend should
    surface this as "couldn't see a face, try again" rather than store
    a junk embedding.

    When `pre_detected=true`, the caller has already cropped to the
    face (typically via browser-side MediaPipe) so we set DeepFace's
    `detector_backend='skip'` and `align=False`. This skips the slow
    RetinaFace step — embedding-only latency is ~200ms instead of
    ~1500ms.
    """
    if image.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported content type: {image.content_type}",
        )

    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty image body")

    try:
        pil = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not decode image: {e}")

    arr = np.array(pil)

    is_pre_detected = str(pre_detected).lower() == "true"
    active_detector = "skip" if is_pre_detected else DETECTOR_BACKEND
    align = not is_pre_detected

    t0 = time.monotonic()
    try:
        # DeepFace.represent returns a list of dicts (one per detected
        # face). With enforce_detection=True it raises if zero faces are
        # found, which is the behavior we want at enrollment / scan time.
        # With detector_backend='skip' the input IS the face — no
        # detection runs, the image is fed straight to Facenet512.
        results = DeepFace.represent(
            img_path=arr,
            model_name=MODEL_NAME,
            detector_backend=active_detector,
            enforce_detection=not is_pre_detected,
            align=align,
        )
    except ValueError as e:
        # DeepFace raises ValueError when no face is found.
        raise HTTPException(status_code=422, detail=f"No face detected: {e}")
    except Exception as e:
        log.exception("represent() failed")
        raise HTTPException(status_code=500, detail=f"Embedding failed: {e}")

    if not results:
        raise HTTPException(status_code=422, detail="No face detected")

    # When multiple faces are in frame, pick the one with the largest
    # bbox area — usually the patient at the counter, not someone in the
    # background. Tiebreaker: highest face_confidence.
    def _area(r: dict[str, Any]) -> int:
        fa = r.get("facial_area") or {}
        return int(fa.get("w", 0)) * int(fa.get("h", 0))

    results.sort(key=lambda r: (_area(r), r.get("face_confidence", 0.0)), reverse=True)
    chosen = results[0]

    embedding = chosen.get("embedding")
    if not isinstance(embedding, list) or not embedding:
        raise HTTPException(status_code=500, detail="Malformed embedding from DeepFace")

    # L2-normalize so the backend can compare with plain cosine == dot
    # product. DeepFace already returns normalized vectors for most
    # models but normalizing again is cheap and defensive.
    vec = np.array(embedding, dtype=np.float32)
    norm = float(np.linalg.norm(vec))
    if norm > 0:
        vec = vec / norm

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    log.info(
        f"[embed] detector={active_detector} faces={len(results)} "
        f"confidence={float(chosen.get('face_confidence', 0.0)):.2f} "
        f"elapsed={elapsed_ms}ms preDetected={is_pre_detected}"
    )

    return {
        "model": MODEL_NAME,
        "detector": active_detector,
        "embedding": vec.tolist(),
        "dim": int(vec.shape[0]),
        "faceConfidence": float(chosen.get("face_confidence", 0.0)),
        "facialArea": chosen.get("facial_area"),
        "facesDetected": len(results),
        "elapsedMs": elapsed_ms,
    }
