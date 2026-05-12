import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RetentionService } from '../../common/retention/retention.service';
import { AccessLog } from './schemas/access-log.schema';

@Injectable()
export class AccessLogsService {
  constructor(
    @InjectModel(AccessLog.name) private readonly model: Model<AccessLog>,
    private readonly retention: RetentionService,
  ) {}

  async write(entry: Omit<AccessLog, 'createdAt' | 'updatedAt' | 'expiresAt'>) {
    // expiresAt is stamped here from the per-clinic retention setting so the
    // hot path (every HTTP request) doesn't have to know about TTL config.
    const expiresAt = await this.retention.expiresAt(entry.clinicId);
    await this.model.create({ ...entry, expiresAt });
  }

  async list(
    clinicId: Types.ObjectId,
    query: {
      limit?: number;
      before?: string;
      path?: string;
      method?: string;
      statusCode?: number;
      /** When true, only return mutating verbs (POST/PATCH/PUT/DELETE).
       *  Useful for the Dashboard "Recent activity" feed which would
       *  otherwise be filled with /reports/* GETs from its own polling
       *  and never surface an actual create/update event. */
      writesOnly?: boolean;
    },
  ) {
    const limit = Math.max(1, Math.min(200, query.limit ?? 50));
    const filter: any = { clinicId };
    if (query.path) filter.path = query.path;
    if (query.method) filter.method = query.method.toUpperCase();
    else if (query.writesOnly) filter.method = { $in: ['POST', 'PATCH', 'PUT', 'DELETE'] };
    if (query.statusCode) filter.statusCode = query.statusCode;
    if (query.before) {
      const d = new Date(query.before);
      if (!isNaN(d.getTime())) filter.createdAt = { $lt: d };
    }

    const rows = await this.model
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit);
    const last = rows.length ? (rows[rows.length - 1] as any) : undefined;
    const nextBefore =
      last?.createdAt instanceof Date
        ? last.createdAt.toISOString()
        : undefined;
    return { rows, nextBefore };
  }
}
