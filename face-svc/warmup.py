"""Verify the bundled YuNet + SFace + anti-spoof ONNX models load
cleanly at image-build time. Catches a corrupt download during
`docker build` instead of waiting for the first user scan.
"""
import sys
import cv2

try:
    det = cv2.FaceDetectorYN.create("/app/models/yunet.onnx", "", (320, 240))
    print(f"warmup: YuNet loaded ({det.getInputSize()})")
except Exception as e:
    print(f"warmup: YuNet load FAILED: {e}", file=sys.stderr)
    sys.exit(1)

try:
    rec = cv2.FaceRecognizerSF.create("/app/models/sface.onnx", "")
    print("warmup: SFace loaded")
    _ = rec
except Exception as e:
    print(f"warmup: SFace load FAILED: {e}", file=sys.stderr)
    sys.exit(1)

try:
    net = cv2.dnn.readNetFromONNX("/app/models/anti_spoof.onnx")
    print(f"warmup: anti-spoof-mn3 loaded ({len(net.getLayerNames())} layers)")
except Exception as e:
    print(f"warmup: anti-spoof load FAILED: {e}", file=sys.stderr)
    sys.exit(1)
