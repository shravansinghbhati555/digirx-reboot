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

    if (res.status === 422) {
      // face-svc's "no face detected" path. Propagate as 400 so the FE
      // can show "couldn't see a face, try again" without leaking
      // implementation details.
      throw new BadRequestException('No face detected in the image');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`face-svc /embed ${res.status}: ${text}`);
      throw new InternalServerErrorException('Face embedding failed');
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
