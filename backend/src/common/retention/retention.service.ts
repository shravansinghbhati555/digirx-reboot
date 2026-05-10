import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Clinic } from '../../modules/tenancy/schemas/clinic.schema';
import {
  DEFAULT_CLINIC_SETTINGS,
  mergeClinicSettings,
} from '../../modules/tenancy/clinic-settings.types';

const CACHE_TTL_MS = 5 * 60_000;

type CacheEntry = { retentionDays: number; until: number };

/**
 * Resolves `logs.retentionDays` per clinic and stamps an `expiresAt` for
 * Mongo's TTL monitor. Cached for 5 minutes so the access-log hot path
 * (one write per HTTP request) doesn't hammer the clinic collection.
 *
 * Stale cache after a settings change is acceptable: TTL retention is a
 * compliance window, not a real-time toggle. New rows pick up the new
 * value on the next cache refresh.
 */
@Injectable()
export class RetentionService {
  private cache = new Map<string, CacheEntry>();

  constructor(
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
  ) {}

  async expiresAt(clinicId: Types.ObjectId): Promise<Date> {
    const days = await this.retentionDays(clinicId);
    return new Date(Date.now() + days * 86_400_000);
  }

  async retentionDays(clinicId: Types.ObjectId): Promise<number> {
    const key = clinicId.toHexString();
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.until > now) return hit.retentionDays;

    let resolved: number;
    try {
      const clinic = await this.clinicModel.findById(clinicId).lean();
      const settings = mergeClinicSettings(clinic?.settings);
      resolved = settings.logs.retentionDays;
    } catch {
      // Clinic lookup failures (DB blip, racing tenancy delete) shouldn't
      // block log writes. Fall back to the global default.
      resolved = DEFAULT_CLINIC_SETTINGS.logs.retentionDays;
    }

    this.cache.set(key, { retentionDays: resolved, until: now + CACHE_TTL_MS });
    return resolved;
  }

  /** Test/admin hook: drop a single clinic's cache so a settings flip is observed immediately. */
  invalidate(clinicId: Types.ObjectId) {
    this.cache.delete(clinicId.toHexString());
  }
}
