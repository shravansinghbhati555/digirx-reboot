import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService {
  private client(): S3Client {
    const region = process.env.S3_REGION ?? 'us-east-1';
    const endpoint = process.env.S3_ENDPOINT;
    const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? 'true').toLowerCase() === 'true';

    return new S3Client({
      region,
      endpoint,
      forcePathStyle,
      credentials: process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
        : undefined,
    });
  }

  private bucket(): string {
    return process.env.S3_BUCKET ?? 'digirx';
  }

  async presignPut(input: { key: string; contentType: string; expiresInSeconds?: number }) {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket(),
      Key: input.key,
      ContentType: input.contentType,
    });
    return await getSignedUrl(this.client(), cmd, { expiresIn: input.expiresInSeconds ?? 300 });
  }

  async presignGet(input: { key: string; expiresInSeconds?: number }) {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket(),
      Key: input.key,
    });
    return await getSignedUrl(this.client(), cmd, { expiresIn: input.expiresInSeconds ?? 300 });
  }

  async putObject(input: { key: string; body: Uint8Array; contentType: string }) {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket(),
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    });
    await this.client().send(cmd);
  }
}

