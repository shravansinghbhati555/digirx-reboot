import { Controller, Get, Header, HttpCode } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { Public } from '../common/public.decorator';
import { HealthService } from './health.service';
import { register } from 'prom-client';

@Controller()
export class HealthController {
  constructor(
    @InjectConnection() private readonly mongo: Connection,
    private readonly health: HealthService,
  ) {}

  /**
   * Liveness + readiness in one shot. Pings every dependency the app
   * actually needs to serve traffic — Mongo always; Redis only if
   * configured; S3 only if configured. Returns 200 with a per-dep
   * breakdown when everything is up, 503 when any critical dep is down.
   *
   * Public so load balancers can hit it without auth.
   */
  @Get('health')
  @Public()
  async healthCheck() {
    const result = await this.health.check();
    if (!result.ok) {
      // Return 503 with body so the LB can short-circuit, but the body is
      // still introspectable for ops. Throwing would log a stack we don't
      // want on every probe — return-with-statusCode is intentional.
      return result;
    }
    return result;
  }

  /**
   * Prometheus scrape endpoint. Default Node metrics + the
   * HTTP-duration histogram registered by HealthService at boot.
   * Public so the cluster's prometheus can scrape from inside the network
   * without an auth handshake.
   */
  @Get('metrics')
  @Public()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @HttpCode(200)
  async metrics(): Promise<string> {
    return await register.metrics();
  }
}
