# DigiRx face-svc — DeepFace embedding sidecar.
#
# Two-stage build:
#  1) base image installs Python deps + warms the model cache at build
#     time so the running container is fully self-contained (no model
#     download on first request).
#  2) runtime image runs uvicorn on port 8000.
#
# The container is INTERNAL ONLY — never expose port 8000 publicly.
# It assumes the calling NestJS backend lives on the same docker network.

FROM python:3.11-slim

# System deps OpenCV / TensorFlow need at runtime. Headless OpenCV
# avoids pulling in X11 / GTK libraries we'd never use in a server.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        libgomp1 \
        libgl1 \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first so the docker layer cache survives code-only
# changes. TensorFlow + DeepFace pull ~1.2 GB total — be patient on the
# first build.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download Facenet512 + RetinaFace weights so the running container
# doesn't reach out to the internet on first request and so the JIT
# compilation cost is paid at build time.
RUN python -c "from deepface import DeepFace; \
    import numpy as np; \
    DeepFace.represent( \
        img_path=np.zeros((112,112,3), dtype=np.uint8)+128, \
        model_name='Facenet512', \
        detector_backend='retinaface', \
        enforce_detection=False)"

COPY main.py .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
