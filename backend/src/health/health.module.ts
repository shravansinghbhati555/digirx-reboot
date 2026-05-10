import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * Liveness/readiness + Prometheus metrics. Lives outside the `modules/`
 * tree so app.module can mount it as a sibling of the feature modules.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
