import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';

/**
 * Thin HTTP wrapper around the Python face-svc sidecar. Owns the
 * network call so the rest of the backend doesn't have to know
 * face-svc exists. If we ever swap insightface/DeepFace for a hosted
 * API or onnxruntime-node, only this file changes.
 */
@Injectable()
export class FaceClient {
  private readonly logger = new Logger(FaceClient.name);

  private get baseUrl(): string {
    return process.env.FACE_SVC_URL ?? 'http://face-svc:8000';
  }

  async embed(input: {
    buffer: Buffer;
    mimeType: string;
    filename: string;
    preDetected?: boolean;
  }): Promise<{
    embedding: number[];
    model: string;
    detector: string;
    faceConfidence: number;
    facesDetected: number;
    facialArea?: Record<string, unknown>;
  }> {
    const form = new FormData();
    // Node 18+'s File / Blob types both work; Blob keeps the dep
    // surface minimal.
    const blob = new Blob([new Uint8Array(input.buffer)], { type: input.mimeType });
    form.append('image', blob, input.filename);
    if (input.preDetected) form.append('pre_detected', 'true');

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/embed`, { method: 'POST', body: form });
    } catch (e) {
      // Network-level failure — face-svc not running, DNS, etc. Surface
      // as 500 so the FE can show a generic "face service unavailable."
      this.logger.error(`face-svc unreachable: ${e instanceof Error ? e.message : e}`);
      throw new InternalServerErrorException('Face service unavailable');
    }

    // Helper to extract a human-readable `detail` from face-svc's
    // FastAPI error body so the FE can show the actual reason instead
    // of a generic message. Falls back to plain text / status code.
    const readDetail = async (): Promise<string> => {
      try {
        const ct = res.headers.get('content-type') ?? '';
        if (ct.includes('application/json')) {
          const body = (await res.json()) as { detail?: unknown };
          if (typeof body.detail === 'string') return body.detail;
        }
        const text = await res.text();
        return text || `HTTP ${res.status}`;
      } catch {
        return `HTTP ${res.status}`;
      }
    };

    if (res.status === 422) {
      // face-svc's "no face detected" / spoof-detected path. Propagate
      // the actual detail so the operator sees what happened rather
      // than a fixed string.
      const detail = await readDetail();
      throw new BadRequestException(detail || 'No face detected in the image');
    }
    if (!res.ok) {
      const detail = await readDetail();
      this.logger.error(`face-svc /embed ${res.status}: ${detail}`);
      throw new InternalServerErrorException(
        `Face embedding failed (${res.status}): ${detail}`,
      );
    }

    const body = (await res.json()) as {
      embedding?: number[];
      model?: string;
      detector?: string;
      faceConfidence?: number;
      facesDetected?: number;
      facialArea?: Record<string, unknown>;
    };
    if (!body.embedding || !Array.isArray(body.embedding) || body.embedding.length === 0) {
      throw new InternalServerErrorException('Face service returned a malformed embedding');
    }
    return {
      embedding: body.embedding,
      model: body.model ?? 'unknown',
      detector: body.detector ?? 'unknown',
      faceConfidence: body.faceConfidence ?? 0,
      facesDetected: body.facesDetected ?? 1,
      facialArea: body.facialArea,
    };
  }

  async health(): Promise<{ ok: boolean; model?: string; detector?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      if (!res.ok) return { ok: false };
      const body = (await res.json()) as { model?: string; detector?: string };
      return { ok: true, model: body.model, detector: body.detector };
    } catch {
      return { ok: false };
    }
  }
}
