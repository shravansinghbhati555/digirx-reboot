import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AccessLog } from './schemas/access-log.schema';

@Injectable()
export class AccessLogsService {
  constructor(@InjectModel(AccessLog.name) private readonly model: Model<AccessLog>) {}

  async write(entry: Omit<AccessLog, 'createdAt' | 'updatedAt'>) {
    await this.model.create(entry);
  }

  async list(clinicId: Types.ObjectId, query: { limit?: number; before?: string; path?: string; method?: string; statusCode?: number }) {
    const limit = Math.max(1, Math.min(200, query.limit ?? 50));
    const filter: any = { clinicId };
    if (query.path) filter.path = query.path;
    if (query.method) filter.method = query.method.toUpperCase();
    if (query.statusCode) filter.statusCode = query.statusCode;
    if (query.before) {
      const d = new Date(query.before);
      if (!isNaN(d.getTime())) filter.createdAt = { $lt: d };
    }

    const rows = await this.model.find(filter).sort({ createdAt: -1 }).limit(limit);
    const last = rows.length ? (rows[rows.length - 1] as any) : undefined;
    const nextBefore = last?.createdAt instanceof Date ? last.createdAt.toISOString() : undefined;
    return { rows, nextBefore };
  }
}

