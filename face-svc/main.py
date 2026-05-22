"""
DigiRx face-svc — OpenCV face embedding + MobileNetV3 anti-spoofing.

Internal-only HTTP API consumed by the NestJS backend. Receives a JPEG /
PNG / WebP upload, runs YuNet to detect the face, anti-spoof-mn3 to
classify real vs spoof, and SFace to extract a 128-d embedding.
Returns the embedding (L2-normalized) plus the detector's face
confidence; rejects with 422 on spoof.

The service NEVER stores the original image — frames are processed in
memory and discarded. Only the embedding leaves the process.

License notes:
  - OpenCV:          Apache 2.0
  - YuNet:           Apache 2.0 (opencv_zoo/face_detection_yunet)
  - SFace:           Apache 2.0 (opencv_zoo/face_recognition_sface)
  - anti-spoof-mn3:  Apache 2.0 (openvinotoolkit/open_model_zoo,
                     ONNX export via PINTO_model_zoo)
  - Commercial-use safe.
"""
from __future__ import annotations

import io
import logging
import os
import time
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from PIL import Image

MODEL_NAME = "SFace"
DETECTOR_BACKEND = "YuNet"

YUNET_PATH = os.environ.get("FACE_DETECTOR_PATH", "/app/models/yunet.onnx")
SFACE_PATH = os.environ.get("FACE_EMBEDDER_PATH", "/app/models/sface.onnx")
ANTI_SPOOF_PATH = os.environ.get("FACE_ANTI_SPOOF_PATH", "/app/models/anti_spoof.onnx")

# Detection thresholds — YuNet exposes score / NMS / topK. Defaults
# tuned for clinic-grade single-face captures. Override via env without
# rebuilding the container.
YUNET_SCORE_THRESHOLD = float(os.environ.get("YUNET_SCORE_THRESHOLD", "0.6"))
YUNET_NMS_THRESHOLD = float(os.environ.get("YUNET_NMS_THRESHOLD", "0.3"))
YUNET_TOP_K = int(os.environ.get("YUNET_TOP_K", "5000"))

# anti-spoof-mn3. Set FACE_ANTI_SPOOF_ENABLED=false to bypass entirely
# (e.g. while debugging real-face rejections). The threshold is the
# minimum real-class probability — anything below this is treated as
# spoof and the request is rejected with 422.
ANTI_SPOOF_ENABLED = os.environ.get("FACE_ANTI_SPOOF_ENABLED", "true").lower() == "true"
# Stricter default than the model's reference 0.5 because a phone
# photo filling the whole frame often lands ~0.6 — at 0.5 the spoof
# slips through. 0.7 catches more spoofs at the cost of occasionally
# rejecting a real face under bad lighting. Lower it again via env if
# you see too many false rejects.
ANTI_SPOOF_THRESHOLD = float(os.environ.get("FACE_ANTI_SPOOF_THRESHOLD", "0.7"))
# Bbox-expansion scale: anti-spoof-mn3 needs surrounding context
# (phone bezel, paper edge, room background) to call the spoof. 2.5x
# is the sweet spot we found — 1.5x was leaving the model starved of
# signal when the operator held the phone close.
ANTI_SPOOF_BBOX_SCALE = float(os.environ.get("FACE_ANTI_SPOOF_BBOX_SCALE", "2.5"))
# anti-spoof-mn3 input is 128x128 RGB normalized to [0,1].
ANTI_SPOOF_INPUT_SIZE = 128

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("face-svc")

app = FastAPI(title="DigiRx face-svc", version="0.3.0")

# Models are loaded once at process start and reused across requests.
# OpenCV's DNN module is thread-safe for inference.
_detector: cv2.FaceDetectorYN | None = None
_recognizer: cv2.FaceRecognizerSF | None = None
_spoof_net: cv2.dnn.Net | None = None


@app.on_event("startup")
def _load_models() -> None:
    """Load YuNet + SFace + the anti-spoof-mn3 net once. The detector's
    input size gets reset per request to match the actual image
    dimensions."""
    global _detector, _recognizer, _spoof_net
    log.info(f"Loading {DETECTOR_BACKEND} from {YUNET_PATH}")
    _detector = cv2.FaceDetectorYN.create(
        YUNET_PATH,
        "",
        (320, 240),
        YUNET_SCORE_THRESHOLD,
        YUNET_NMS_THRESHOLD,
        YUNET_TOP_K,
    )
    log.info(f"Loading {MODEL_NAME} from {SFACE_PATH}")
    _recognizer = cv2.FaceRecognizerSF.create(SFACE_PATH, "")
    if ANTI_SPOOF_ENABLED:
        log.info(f"Loading anti-spoof-mn3 (threshold={ANTI_SPOOF_THRESHOLD})")
        _spoof_net = cv2.dnn.readNetFromONNX(ANTI_SPOOF_PATH)
    else:
        log.info("Anti-spoofing DISABLED (FACE_ANTI_SPOOF_ENABLED=false)")
    log.info("face-svc ready")


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "detector": DETECTOR_BACKEND,
        "antiSpoofing": ANTI_SPOOF_ENABLED,
    }


def _expanded_crop(img: np.ndarray, bbox: tuple[float, float, float, float], scale: float) -> np.ndarray:
    """Expand the face bbox by `scale` and crop. anti-spoof-mn3 sees a
    bit of surrounding context (phone bezel, paper edge) — that's the
    signal it uses. Clamps to image bounds so we never crop outside.
    """
    h_img, w_img = img.shape[:2]
    x, y, w, h = bbox
    new_w = w * scale
    new_h = h * scale
    cx = x + w / 2
    cy = y + h / 2
    nx = max(0, int(round(cx - new_w / 2)))
    ny = max(0, int(round(cy - new_h / 2)))
    nx_end = min(w_img, int(round(cx + new_w / 2)))
    ny_end = min(h_img, int(round(cy + new_h / 2)))
    if nx_end <= nx or ny_end <= ny:
        return img[max(0, int(y)) : int(y + h), max(0, int(x)) : int(x + w)]
    return img[ny:ny_end, nx:nx_end]


def _softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - np.max(x))
    return e / e.sum()


def _spoof_score(img_bgr: np.ndarray, bbox: tuple[float, float, float, float] | None) -> float:
    """Run anti-spoof-mn3 and return the probability of the 'real'
    class. Higher = more likely real; below threshold means the input
    is probably a printed photo, screen replay, or video.

    When `bbox` is None (pre-cropped image from browser MediaPipe), we
    feed the full image — the surrounding-context signal is lost in
    that case, but the model still produces a usable prediction.
    """
    assert _spoof_net is not None
    if bbox is not None:
        crop = _expanded_crop(img_bgr, bbox, ANTI_SPOOF_BBOX_SCALE)
    else:
        crop = img_bgr
    if crop.size == 0:
        return 0.0
    # anti-spoof-mn3 expects 128x128 RGB normalized to [0,1].
    # blobFromImage handles the resize + scale + channel swap in one
    # call. mean stays at 0.
    blob = cv2.dnn.blobFromImage(
        crop,
        scalefactor=1.0 / 255.0,
        size=(ANTI_SPOOF_INPUT_SIZE, ANTI_SPOOF_INPUT_SIZE),
        mean=(0, 0, 0),
        swapRB=True,
    )
    _spoof_net.setInput(blob)
    out = _spoof_net.forward().reshape(-1)
    probs = _softmax(out)
    # 2-class output: [0]=spoof, [1]=real.
    return float(probs[1]) if probs.shape[0] >= 2 else float(probs[0])


@app.post("/embed")
async def embed(
    image: UploadFile = File(...),
    pre_detected: str = Form(default="false"),
) -> dict[str, Any]:
    """Return the 128-d embedding for the largest face in the image.

    Anti-spoofing runs first (when enabled). If the ensemble says the
    input is likely a printed photo / phone screen / video replay, we
    short-circuit with 422 and never produce an embedding — the
    backend forwards the detail string to the FE.

    When `pre_detected=true`, the caller has already cropped to the
    face (typically via browser-side MediaPipe). We skip YuNet and run
    SFace directly. The anti-spoof check is best-effort in this mode
    (loses surrounding-context signal) — we still run it, just on the
    cropped image.
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

    # PIL → OpenCV. OpenCV expects BGR; PIL gives us RGB.
    arr = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    h, w = arr.shape[:2]

    is_pre_detected = str(pre_detected).lower() == "true"
    t0 = time.monotonic()

    assert _detector is not None and _recognizer is not None, "models not initialized"

    if is_pre_detected:
        face_bbox: tuple[float, float, float, float] | None = None
        face_chip = cv2.resize(arr, (112, 112), interpolation=cv2.INTER_LINEAR)
        face_confidence = 1.0  # browser already vetted the bbox
        facial_area = {"x": 0, "y": 0, "w": w, "h": h}
        faces_detected = 1
        face_row_for_align: np.ndarray | None = None
    else:
        _detector.setInputSize((w, h))
        result = _detector.detect(arr)
        detections = result[1]
        if detections is None or len(detections) == 0:
            raise HTTPException(status_code=422, detail="No face detected in the frame")

        def _area(row: np.ndarray) -> float:
            return float(row[2]) * float(row[3])

        detections_sorted = sorted(detections, key=lambda r: (_area(r), float(r[14])), reverse=True)
        face_row = np.array(detections_sorted[0])
        face_confidence = float(face_row[14])
        x, y, fw, fh = (float(face_row[0]), float(face_row[1]), float(face_row[2]), float(face_row[3]))
        face_bbox = (x, y, fw, fh)
        face_row_for_align = face_row
        facial_area = {
            "x": int(round(x)),
            "y": int(round(y)),
            "w": int(round(fw)),
            "h": int(round(fh)),
        }
        faces_detected = len(detections)

    # Anti-spoofing gate. Runs BEFORE the (more expensive) embedding
    # step so a fake input is rejected as cheaply as possible.
    real_score: float | None = None
    if ANTI_SPOOF_ENABLED:
        real_score = _spoof_score(arr, face_bbox)
        if real_score < ANTI_SPOOF_THRESHOLD:
            log.info(
                f"[embed] spoof verdict: real_score={real_score:.3f} < {ANTI_SPOOF_THRESHOLD}"
            )
            raise HTTPException(
                status_code=422,
                detail="Possible photo or screen detected — present a live face to the camera.",
            )

    # Embedding step. SFace needs aligned 112x112 chip — alignCrop
    # reads bbox + landmarks straight out of the YuNet row (indices
    # 0..13). For pre-detected images we skip alignCrop and feed our
    # own naive resize, since we don't have YuNet landmarks.
    if face_row_for_align is not None:
        face_chip = _recognizer.alignCrop(arr, face_row_for_align)
    embedding = _recognizer.feature(face_chip).flatten()

    # L2-normalize so the BE can compare with plain cosine == dot
    # product. SFace's raw output is already roughly unit-norm but
    # normalizing again is cheap and defensive.
    vec = np.asarray(embedding, dtype=np.float32)
    norm = float(np.linalg.norm(vec))
    if norm > 0:
        vec = vec / norm
    if vec.size == 0:
        raise HTTPException(status_code=500, detail="Empty embedding from SFace")

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    spoof_str = f" real={real_score:.2f}" if real_score is not None else ""
    log.info(
        f"[embed] detector={'skip' if is_pre_detected else DETECTOR_BACKEND} "
        f"faces={faces_detected} confidence={face_confidence:.2f}{spoof_str} "
        f"elapsed={elapsed_ms}ms preDetected={is_pre_detected}"
    )

    return {
        "model": MODEL_NAME,
        "detector": "skip" if is_pre_detected else DETECTOR_BACKEND,
        "embedding": vec.tolist(),
        "dim": int(vec.shape[0]),
        "faceConfidence": face_confidence,
        "facialArea": facial_area,
        "facesDetected": faces_detected,
        "elapsedMs": elapsed_ms,
        "realScore": real_score,
    }
