import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { collectDefaultMetrics, register } from 'prom-client';

export type DepStatus = 'up' | 'down' | 'skipped';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@InjectConnection() private readonly mongo: Connection) {
    // Default Node metrics: process_cpu_seconds_total, nodejs_eventloop_lag,
    // process_resident_memory_bytes, etc. Safe to call multiple times — the
    // global `register` is idempotent.
    if (!register.getSingleMetric('process_cpu_user_seconds_total')) {
      collectDefaultMetrics();
    }
  }

  async check(): Promise<{
    ok: boolean;
    timestamp: string;
    deps: { mongo: DepStatus; redis: DepStatus; s3: DepStatus };
  }> {
    const [mongo, redis, s3] = await Promise.all([
      this.pingMongo(),
      this.pingRedis(),
      this.pingS3(),
    ]);
    // Mongo is the only dep marked critical for "ok". Redis being down
    // means BullMQ jobs back up, but the app continues serving HTTP.
    // S3 down means new uploads fail but reads of cached presigned URLs
    // still work for the next 5 min.
    const ok = mongo === 'up';
    return {
      ok,
      timestamp: new Date().toISOString(),
      deps: { mongo, redis, s3 },
    };
  }

  private async pingMongo(): Promise<DepStatus> {
    try {
      const db = this.mongo.db;
      if (!db) return 'down';
      await db.admin().ping();
      return 'up';
    } catch (err) {
      this.logger.warn(`Mongo ping failed: ${(err as Error).message}`);
      return 'down';
    }
  }

  private async pingRedis(): Promise<DepStatus> {
    const url = process.env.REDIS_URL;
    if (!url) return 'skipped';
    // Avoid a real ioredis client (it'd auto-reconnect and spam logs).
    // Cheap TCP attempt: try a one-shot connection.
    try {
      // Lazy require so tests that don't set REDIS_URL don't pull ioredis.
      const { Redis } = await import('ioredis');
      const client = new Redis(url, {
        connectTimeout: 1500,
        maxRetriesPerRequest: 1,
        lazyConnect: true,
      });
      try {
        await client.connect();
        await client.ping();
        return 'up';
      } finally {
        client.disconnect();
      }
    } catch (err) {
      this.logger.warn(`Redis ping failed: ${(err as Error).message}`);
      return 'down';
    }
  }

  private async pingS3(): Promise<DepStatus> {
    const endpoint = process.env.S3_ENDPOINT;
    const bucket = process.env.S3_BUCKET;
    if (!endpoint || !bucket) return 'skipped';
    try {
      const client = new S3Client({
        region: process.env.S3_REGION ?? 'us-east-1',
        endpoint,
        forcePathStyle:
          (process.env.S3_FORCE_PATH_STYLE ?? 'true').toLowerCase() === 'true',
        credentials:
          process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
            ? {
                accessKeyId: process.env.S3_ACCESS_KEY_ID,
                secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
              }
            : undefined,
      });
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      return 'up';
    } catch (err) {
      this.logger.warn(`S3 ping failed: ${(err as Error).message}`);
      return 'down';
    }
  }
}
