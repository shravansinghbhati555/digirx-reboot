import { Module, type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

// Names used by @Throttle decorators on specific routes (auth/share).
// Note: named buckets are NOT registered globally in `forRoot` — that would
// cause every request to consume from every bucket. They only act as
// per-route overrides via the decorator.
export const THROTTLE_AUTH = 'auth' as const;
export const THROTTLE_SHARE = 'share' as const;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Roadmap 0.1: 120 req/min global default. Devs running the local UI with
// many parallel reads can lift this with `THROTTLE_DEFAULT_LIMIT=…` or shut
// the throttler off entirely with `THROTTLE_DISABLED=true` in `.env`.
const THROTTLE_DEFAULT_LIMIT = envInt('THROTTLE_DEFAULT_LIMIT', 120);
const THROTTLE_DEFAULT_TTL_MS = envInt('THROTTLE_DEFAULT_TTL_MS', 60_000);

const THROTTLE_DISABLED = (process.env.THROTTLE_DISABLED ?? '').toLowerCase() === 'true';

/**
 * No-op guard used when THROTTLE_DISABLED=true. Useful for local dev when
 * the UI fans out many parallel reads (per-patient lookups, week view, etc.).
 */
@Injectable()
class NoopGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    return true;
  }
}

@Module({
  imports: [
    // Only the default bucket is registered globally. Per-route @Throttle
    // decorators (auth/share) attach their own buckets to the routes that
    // need stricter caps; they don't affect other routes.
    ThrottlerModule.forRoot([
      { name: 'default', ttl: THROTTLE_DEFAULT_TTL_MS, limit: THROTTLE_DEFAULT_LIMIT },
    ]),
  ],
  providers: [
    { provide: APP_GUARD, useClass: THROTTLE_DISABLED ? NoopGuard : ThrottlerGuard },
  ],
})
export class AppThrottlerModule {}
