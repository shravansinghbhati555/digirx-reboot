import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Spinner } from './primitives';

/**
 * Webcam capture modal with browser-side face detection.
 *
 * - MediaPipe FaceDetector runs on the live preview (lazy-loaded; ~5 MB
 *   WASM + model fetched from CDN on first open). When it finds a face,
 *   a green bbox overlays the preview and the capture button highlights.
 * - On capture, the frame is cropped to the detected bbox plus a 30%
 *   margin and uploaded as a JPEG. The caller is told the upload is
 *   pre-detected via `opts.preDetected = true`, so the server can skip
 *   its own (much slower) face detector and go straight to embedding.
 * - When MediaPipe isn't available (older browsers, WebGL disabled, CDN
 *   blocked) the modal silently falls back to the previous behavior:
 *   send the full frame, let the server detect.
 *
 * getUserMedia requires HTTPS in production; localhost is exempt.
 */
export function FaceScanModal({
  title,
  hint,
  captureLabel = 'Capture',
  onCancel,
  onCapture,
  onPhoneVerify,
}: {
  title: string;
  hint?: string;
  captureLabel?: string;
  onCancel: () => void;
  onCapture: (blob: Blob, opts?: { preDetected?: boolean }) => Promise<void> | void;
  onPhoneVerify?: (phone: string) => Promise<void> | void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // The detector and its latest result live in refs so the
  // requestAnimationFrame loop doesn't re-create itself on every state
  // update.
  const detectorRef = useRef<MediaPipeDetector | null>(null);
  const lastDetectionRef = useRef<DetectedFace | null>(null);
  const rafRef = useRef<number | null>(null);

  const [permission, setPermission] = useState<'pending' | 'ok' | 'denied' | 'unsupported'>('pending');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  // bbox state drives the SVG overlay; it's updated by the detection
  // loop. The "score" feeds an optional confidence chip in the corner.
  const [bbox, setBbox] = useState<DetectedFace | null>(null);
  // Status of the in-browser face detector. While it's 'loading' or
  // 'ready' the capture button is gated on an actual face being in frame
  // (you can't scan an empty frame). If it ends up 'unavailable' (CDN
  // blocked / no WebGL / old browser) the gate is dropped and we fall back
  // to server-side detection on the full frame.
  const [detectorStatus, setDetectorStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [videoDims, setVideoDims] = useState<{ w: number; h: number }>({ w: 640, h: 480 });
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verifyingPhone, setVerifyingPhone] = useState(false);
  // Network status — face recognition has to reach the server, so we
  // surface an offline banner and disable the capture button when the
  // connection drops, instead of letting the scan fail with a cryptic
  // network error after the user already posed for the camera.
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  // --- Network status ------------------------------------------------
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // --- Camera setup --------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPermission('unsupported');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
          const v = videoRef.current;
          // Once the video resolves its real size, store it for the bbox
          // overlay's SVG viewBox so pixel coords from MediaPipe line up.
          const updateDims = () => {
            if (v.videoWidth && v.videoHeight) {
              setVideoDims({ w: v.videoWidth, h: v.videoHeight });
            }
          };
          v.addEventListener('loadedmetadata', updateDims);
          updateDims();
        }
        setPermission('ok');
      } catch (e) {
        const name = e instanceof Error ? e.name : '';
        setPermission(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unsupported');
      }
    }

    void start();

    return () => {
      cancelled = true;
      const s = streamRef.current;
      if (s) {
        s.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // --- MediaPipe lazy load ------------------------------------------
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const mod = await import('@mediapipe/tasks-vision');
        const vision = await mod.FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm',
        );
        const detector = await mod.FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
            // GPU first; MediaPipe falls back to CPU automatically when
            // WebGL is unavailable, so this is best-effort.
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          minDetectionConfidence: 0.5,
        });
        if (cancelled) {
          detector.close();
          return;
        }
        detectorRef.current = detector as unknown as MediaPipeDetector;
        setDetectorStatus('ready');
      } catch (e) {
        // Any failure (CDN blocked, no WebGL, old browser) just disables
        // pre-detection — the server-side fallback handles it, and the
        // capture button's face gate is dropped so it stays usable.
        if (!cancelled) setDetectorStatus('unavailable');
        // eslint-disable-next-line no-console
        console.warn('[FaceScanModal] MediaPipe detector unavailable, falling back to server-side detection:', e);
      }
    }
    void load();
    return () => {
      cancelled = true;
      const d = detectorRef.current;
      if (d) {
        try { d.close(); } catch { /* ignore */ }
        detectorRef.current = null;
      }
    };
  }, []);

  // --- Detection loop ----------------------------------------------
  useEffect(() => {
    if (permission !== 'ok') return;
    const video = videoRef.current;
    if (!video) return;

    // ~6 fps detection — enough for a smooth bbox without burning CPU.
    const FRAME_INTERVAL_MS = 160;
    let lastRun = 0;

    function tick(now: number) {
      rafRef.current = requestAnimationFrame(tick);
      if (now - lastRun < FRAME_INTERVAL_MS) return;
      lastRun = now;

      const d = detectorRef.current;
      if (!d || !video || video.readyState < 2) return;
      try {
        const result = d.detectForVideo(video, now);
        const detections = result?.detections ?? [];
        if (detections.length === 0) {
          if (lastDetectionRef.current !== null) {
            lastDetectionRef.current = null;
            setBbox(null);
          }
          return;
        }
        // Pick the largest face — assumed to be the patient at the
        // counter, not a colleague walking behind them.
        let best: DetectedFace | null = null;
        for (const det of detections) {
          const bb = det.boundingBox;
          if (!bb) continue;
          const area = bb.width * bb.height;
          const score = det.categories?.[0]?.score ?? 0;
          if (!best || area > best.w * best.h) {
            best = { x: bb.originX, y: bb.originY, w: bb.width, h: bb.height, score };
          }
        }
        if (best) {
          lastDetectionRef.current = best;
          setBbox(best);
        }
      } catch {
        // per-frame failures are noisy — swallow silently
      }
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [permission]);

  async function triggerCapture() {
    if (busy) return;
    if (permission !== 'ok') return;
    // Face gate: when the in-browser detector is working, refuse to scan
    // an empty frame — a face must be present. Dropped when the detector
    // is unavailable (server-side detection handles the full frame).
    if (detectorStatus !== 'unavailable' && !lastDetectionRef.current) return;
    setError(null);
    // Short countdown so the patient has time to face the camera.
    // Trimmed from the older 1.8s flow — at 600ms total it stays useful
    // without dragging out every scan.
    for (let i = 2; i > 0; i--) {
      setCountdown(i);
      await new Promise((r) => setTimeout(r, 300));
    }
    setCountdown(null);

    const last = lastDetectionRef.current;
    const result = await grabFrame(videoRef.current, canvasRef.current, last);
    if (!result.blob) {
      setError('Could not capture frame — try again.');
      return;
    }
    setBusy(true);
    try {
      await onCapture(result.blob, { preDetected: result.preDetected });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
            {hint && <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>{hint}</div>}
          </div>
          <button onClick={onCancel} disabled={busy}
            style={{ background: 'none', border: 'none', cursor: busy ? 'wait' : 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 6 }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'stretch' }}>
          <div style={previewWrapStyle}>
            {permission === 'pending' && (
              <div style={overlayLabel}>Requesting camera…</div>
            )}
            {permission === 'denied' && (
              <div style={overlayLabel}>
                <Icon name="alertTriangle" size={18} />
                <div style={{ marginTop: 6 }}>Camera permission denied. Allow camera access for this site in your browser settings, then reopen this dialog.</div>
              </div>
            )}
            {permission === 'unsupported' && (
              <div style={overlayLabel}>
                <Icon name="alertTriangle" size={18} />
                <div style={{ marginTop: 6 }}>This browser doesn't support webcam capture, or the page isn't on HTTPS.</div>
              </div>
            )}
            <video
              ref={videoRef}
              playsInline
              muted
              style={{
                width: '100%',
                aspectRatio: '4 / 3',
                background: '#000',
                borderRadius: 12,
                objectFit: 'cover',
                transform: 'scaleX(-1)', // mirror so it feels like a selfie cam
                display: permission === 'ok' ? 'block' : 'none',
              }}
            />
            {/* Bounding-box overlay. The SVG is also mirrored so the
                rect appears on the same side of the user's face as the
                video shows. Coordinates stay in unmirrored video space
                so the crop on capture (which uses the raw frame) is
                accurate. */}
            {permission === 'ok' && bbox && (
              <svg
                viewBox={`0 0 ${videoDims.w} ${videoDims.h}`}
                preserveAspectRatio="none"
                style={{
                  position: 'absolute', inset: 0, width: '100%', height: '100%',
                  pointerEvents: 'none', transform: 'scaleX(-1)',
                }}
              >
                <rect
                  x={bbox.x} y={bbox.y} width={bbox.w} height={bbox.h}
                  rx="6"
                  fill="none"
                  stroke="rgb(34,197,94)"
                  strokeWidth={Math.max(3, videoDims.w / 200)}
                  strokeDasharray="0"
                />
              </svg>
            )}
            {permission === 'ok' && bbox && (
              <div style={faceChipStyle}>
                <Icon name="checkCircle" size={12} /> Face detected
              </div>
            )}
            {countdown !== null && (
              <div style={countdownStyle}>{countdown}</div>
            )}
            {busy && (
              <div style={busyOverlayStyle}>
                <Spinner />
                <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 600 }}>Processing…</span>
              </div>
            )}
          </div>

          <canvas ref={canvasRef} style={{ display: 'none' }} />

          {onPhoneVerify && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '4px 0 8px 0' }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Or Verify by Mobile Number
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="Enter patient mobile number..."
                  style={{
                    flex: 1, height: 38, padding: '0 12px',
                    background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 8,
                    fontSize: 13, color: 'var(--text)', outline: 'none'
                  }}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && phoneNumber.trim()) {
                      e.preventDefault();
                      setVerifyingPhone(true);
                      setError(null);
                      try {
                        await onPhoneVerify(phoneNumber.trim());
                      } catch (err) {
                        setError(err instanceof Error ? err.message : String(err));
                      } finally {
                        setVerifyingPhone(false);
                      }
                    }
                  }}
                />
                <button
                  onClick={async () => {
                    if (!phoneNumber.trim()) return;
                    setVerifyingPhone(true);
                    setError(null);
                    try {
                      await onPhoneVerify(phoneNumber.trim());
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setVerifyingPhone(false);
                    }
                  }}
                  disabled={verifyingPhone || !phoneNumber.trim()}
                  style={{
                    height: 38, padding: '0 14px', background: 'var(--brand-500)',
                    color: 'var(--brand-text)', border: 'none', borderRadius: 8,
                    fontSize: 12, fontWeight: 600, cursor: verifyingPhone ? 'wait' : 'pointer',
                    opacity: !phoneNumber.trim() ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 4
                  }}
                >
                  {verifyingPhone ? <Spinner size={12} /> : 'Verify'}
                </button>
              </div>
            </div>
          )}

          {/* Offline warning — shown the moment the connection drops so
              the operator knows why the scan won't work (and isn't left
              wondering after posing for the camera). */}
          {!online && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--warning-text)' }}>
              <Icon name="alertTriangle" size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>No internet connection. Reconnect to continue — face recognition needs to reach the server.</span>
            </div>
          )}

          {error && (
            <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--danger-500)' }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 20px 18px', display: 'flex', gap: 10, borderTop: '1px solid var(--border)' }}>
          {permission === 'pending' ? (
            // Camera still starting up — show a loading row instead of
            // the action buttons so the operator doesn't try to capture
            // before the camera is live.
            <div style={{ flex: 1, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-subtle)', fontSize: 13, fontWeight: 500 }}>
              <Spinner size={16} /> Starting camera…
            </div>
          ) : (
            <>
              <button onClick={onCancel} disabled={busy}
                style={{ flex: 1, height: 42, background: 'none', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', cursor: busy ? 'wait' : 'pointer' }}>
                Cancel
              </button>
              {/* Capture / match only appears once the camera is live
                  (permission === 'ok'). Disabled while busy, mid-
                  countdown, offline, or — when the detector is working —
                  until a face is actually in frame. */}
              {permission === 'ok' && (() => {
                // Gate on a detected face whenever the detector isn't
                // 'unavailable'. While it's still 'loading' there's no bbox
                // yet, so the button stays disabled until detection starts.
                const noFace = detectorStatus !== 'unavailable' && !bbox;
                const captureDisabled = busy || countdown !== null || !online || noFace;
                const title = !online
                  ? 'No internet connection'
                  : noFace
                    ? (detectorStatus === 'loading'
                        ? 'Starting face detection…'
                        : 'Position your face in the frame to continue')
                    : undefined;
                return (
                  <button onClick={triggerCapture}
                    disabled={captureDisabled}
                    title={title}
                    style={{
                      flex: 2, height: 42, border: 'none', borderRadius: 10,
                      background: captureDisabled ? 'rgba(99,102,241,0.4)' : (bbox ? 'rgb(34,197,94)' : 'var(--brand-500)'),
                      color: 'var(--brand-text)', fontSize: 13, fontWeight: 600,
                      cursor: captureDisabled ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      transition: 'background 200ms',
                      opacity: captureDisabled ? 0.7 : 1,
                    }}>
                    <Icon name="camera" size={14} strokeWidth={2.5} />
                    {detectorStatus === 'ready' && !bbox ? 'No face detected' : captureLabel}
                  </button>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type DetectedFace = { x: number; y: number; w: number; h: number; score?: number };

// Minimal subset of the MediaPipe FaceDetector shape we touch. Avoids
// hard-coupling the file to the lib's full types since it's lazy-loaded.
type MediaPipeDetector = {
  detectForVideo(
    video: HTMLVideoElement,
    timestamp: number,
  ): { detections: Array<{ boundingBox?: { originX: number; originY: number; width: number; height: number }; categories?: Array<{ score: number }> }> };
  close(): void;
};

async function grabFrame(
  video: HTMLVideoElement | null,
  canvas: HTMLCanvasElement | null,
  detection: DetectedFace | null,
): Promise<{ blob: Blob | null; preDetected: boolean }> {
  if (!video || !canvas) return { blob: null, preDetected: false };
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { blob: null, preDetected: false };

  if (detection) {
    // 30% margin around the bbox so the face has room to breathe — Facenet's
    // alignment expects a bit of forehead/chin context. Clamp to frame edges.
    const MARGIN = 0.3;
    const mx = detection.w * MARGIN;
    const my = detection.h * MARGIN;
    const x0 = Math.max(0, Math.floor(detection.x - mx));
    const y0 = Math.max(0, Math.floor(detection.y - my));
    const x1 = Math.min(vw, Math.ceil(detection.x + detection.w + mx));
    const y1 = Math.min(vh, Math.ceil(detection.y + detection.h + my));
    const w = Math.max(1, x1 - x0);
    const h = Math.max(1, y1 - y0);
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, x0, y0, w, h, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92),
    );
    return { blob, preDetected: true };
  }

  // No browser-side detection → full frame, let the server detect.
  canvas.width = vw;
  canvas.height = vh;
  ctx.drawImage(video, 0, 0, vw, vh);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92),
  );
  return { blob, preDetected: false };
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 200,
  background: 'rgba(15,23,42,0.45)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const modalStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 480,
  background: 'var(--surface)',
  borderRadius: 18,
  border: '1px solid var(--border)',
  boxShadow: '0 20px 60px rgba(15,23,42,0.2)',
  animation: 'slideUp 200ms ease-out',
  display: 'flex',
  flexDirection: 'column',
  maxHeight: '92vh',
};

const previewWrapStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
};

const overlayLabel: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  textAlign: 'center',
  fontSize: 13,
  color: 'var(--text-subtle)',
  background: 'var(--surface-muted)',
  borderRadius: 12,
};

const countdownStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: "'Manrope',sans-serif",
  fontSize: 80,
  fontWeight: 800,
  color: 'rgba(255,255,255,0.9)',
  textShadow: '0 4px 24px rgba(0,0,0,0.5)',
  pointerEvents: 'none',
};

const busyOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(15,23,42,0.4)',
  borderRadius: 12,
  color: 'white',
};

const faceChipStyle: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  right: 10,
  padding: '4px 9px',
  background: 'rgba(34,197,94,0.92)',
  color: 'white',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  letterSpacing: '0.02em',
};
