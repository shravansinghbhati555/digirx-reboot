import { Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService {
  private client(): S3Client {
    const region = process.env.S3_REGION ?? 'us-east-1';
    const endpoint = process.env.S3_ENDPOINT;
    const forcePathStyle =
      (process.env.S3_FORCE_PATH_STYLE ?? 'true').toLowerCase() === 'true';

    return new S3Client({
      region,
      endpoint,
      forcePathStyle,
      credentials:
        process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.S3_ACCESS_KEY_ID,
              secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
  }

  private bucket(): string {
    return process.env.S3_BUCKET ?? 'digirx';
  }

  async presignPut(input: {
    key: string;
    contentType: string;
    expiresInSeconds?: number;
  }) {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket(),
      Key: input.key,
      // Note: We don't sign the ContentType here because browser mime-type 
      // detection can sometimes differ slightly from what the backend expects, 
      // which would break the signature.
    });
    return await getSignedUrl(this.client(), cmd, {
      expiresIn: input.expiresInSeconds ?? 300,
    });
  }

  async presignGet(input: { key: string; expiresInSeconds?: number }) {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket(),
      Key: input.key,
    });
    return await getSignedUrl(this.client(), cmd, {
      expiresIn: input.expiresInSeconds ?? 300,
    });
  }

  async putObject(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
  }) {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket(),
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    });
    await this.client().send(cmd);
  }

  async deleteObject(input: { key: string }) {
    const cmd = new DeleteObjectCommand({
      Bucket: this.bucket(),
      Key: input.key,
    });
    await this.client().send(cmd);
  }

  /**
   * Read a small object's full bytes into memory. Use sparingly — the
   * presign* methods are the right tool for large files. Throws when
   * the object doesn't exist.
   */
  async getObject(input: { key: string }): Promise<{ bytes: Uint8Array; contentType: string | undefined }> {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket(),
      Key: input.key,
    });
    const res = await this.client().send(cmd);
    const body = res.Body;
    if (!body || typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray !== 'function') {
      throw new Error('S3 returned an empty body');
    }
    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return { bytes, contentType: res.ContentType };
  }
}
