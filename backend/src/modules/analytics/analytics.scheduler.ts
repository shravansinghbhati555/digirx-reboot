import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { AnalyticsService } from './analytics.service';

/**
 * Nightly aggregation. Runs at 00:30 UTC every day; the implementation
 * computes `yesterday` in UTC. For clinics in non-UTC timezones (most of
 * them) this means yesterday's row is computed shortly after their local
 * day rolls — a couple of hours' lag on the dashboard, which is fine for
 * a daily-rollup tile.
 *
 * For finer-grained / per-clinic-tz scheduling, swap this for a per-tenant
 * job that fires at clinic-local 00:30. Out of scope for v1.
 *
 * The cron is suppressed in tests via `ANALYTICS_CRON_DISABLED=true`
 * (set by the test harness) so an aggregation run doesn't fire mid-test.
 */
@Injectable()
export class AnalyticsScheduler {
  private readonly logger = new Logger(AnalyticsScheduler.name);

  constructor(private readonly analytics: AnalyticsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    name: 'analytics-daily-aggregation',
  })
  async runNightly() {
    if ((process.env.ANALYTICS_CRON_DISABLED ?? '').toLowerCase() === 'true') {
      return;
    }
    const yesterday = DateTime.utc().minus({ days: 1 }).toISODate();
    if (!yesterday) return;
    this.logger.log(`Aggregating daily stats for ${yesterday}`);
    const out = await this.analytics.aggregateForDate(yesterday);
    this.logger.log(
      `Daily aggregation complete: ${out.ok} branches ok, ${out.failed} failed`,
    );
  }
}
