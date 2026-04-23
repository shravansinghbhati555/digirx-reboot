import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

export const THROTTLE_AUTH = 'auth' as const;
export const THROTTLE_SHARE = 'share' as const;

@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 120 },
      { name: THROTTLE_AUTH, ttl: 60_000, limit: 10 },
      { name: THROTTLE_SHARE, ttl: 60_000, limit: 10 },
    ]),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppThrottlerModule {}
