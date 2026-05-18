import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { FxService } from './fx.service';

/**
 * Exchange-rate read endpoints. Tenant context required (so the
 * existing rate-limiter applies per-clinic) but no specific permission
 * — FX data is non-sensitive cross-rates from a public source.
 */
@Controller('fx')
export class FxController {
  constructor(private readonly fx: FxService) {}

  @Get('rates')
  @RequirePermissions()
  async getRates(@Query('base') base?: string) {
    const code = (base ?? 'USD').toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      throw new BadRequestException('base must be an ISO 4217 code');
    }
    const blob = await this.fx.getRates(code);
    return {
      base: blob.base,
      rates: blob.rates,
      date: blob.date,
      fetchedAt: new Date(blob.fetchedAt).toISOString(),
    };
  }

  @Get('convert')
  @RequirePermissions()
  async convert(
    @Query('amount') amountRaw?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const amount = Number(amountRaw);
    if (!from || !to || !Number.isFinite(amount)) {
      throw new BadRequestException('amount, from, to are all required');
    }
    const converted = await this.fx.convert(amount, from, to);
    return { amount, from: from.toUpperCase(), to: to.toUpperCase(), converted };
  }
}
