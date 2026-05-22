# DigiRx face-svc — OpenCV-based face embedding sidecar.
#
# Stack:
#   - YuNet  (face detection)   — Apache 2.0, ~340 KB ONNX
#   - SFace  (face embedding)   — Apache 2.0, ~37 MB ONNX
# Both ship in OpenCV's `opencv_zoo` repo and load via cv2.FaceDetectorYN /
# cv2.FaceRecognizerSF. No TensorFlow / PyTorch / DeepFace required — the
# whole pipeline runs through opencv-python-headless's DNN module.
#
# Model files are downloaded at build time so the running container is
# fully self-contained (no internet on first request).
#
# The container is INTERNAL ONLY — never expose port 8000 publicly. It
# assumes the calling NestJS backend lives on the same docker network.

FROM python:3.11-slim

# OpenCV headless still needs libgl + libglib for some image-loading
# code paths even in headless mode.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        libgomp1 \
        libgl1 \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps first so the layer cache survives code-only changes.
# This layer is now ~150 MB instead of the ~1.5 GB DeepFace + TF
# install — first build drops from ~10 min to ~1 min.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bundled model bin. We pin to specific upstream paths so the weights
# don't drift under us. All three files are tiny — adds <50 MB to the
# image total.
#
# Anti-spoofing: OpenVINO Open Model Zoo's `anti-spoof-mn3` (a
# MobileNetV3-based face-anti-spoof classifier, Apache 2.0).
# Distributed via PINTO_model_zoo as a tarball — we extract just the
# .onnx file and discard the rest (SavedModel / TFLite variants we
# don't need).
RUN mkdir -p /app/models && \
    curl -fsSL -o /app/models/yunet.onnx \
        https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx && \
    curl -fsSL -o /app/models/sface.onnx \
        https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx && \
    cd /tmp && \
    curl -fsSL -o spoof.tar.gz \
        https://s3.ap-northeast-2.wasabisys.com/pinto-model-zoo/191_anti-spoof-mn3/resources.tar.gz && \
    tar -xzf spoof.tar.gz && \
    ONNX_PATH=$(find . -maxdepth 4 -type f -name "*.onnx" | head -n 1) && \
    if [ -z "$ONNX_PATH" ]; then echo "No .onnx found in resources.tar.gz" && ls -lR . && exit 1; fi && \
    cp "$ONNX_PATH" /app/models/anti_spoof.onnx && \
    rm -rf /tmp/spoof.tar.gz /tmp/saved_model* /tmp/resources*

COPY warmup.py .
RUN python warmup.py

COPY main.py .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
