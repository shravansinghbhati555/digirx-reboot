import { Injectable, Logger } from '@nestjs/common';

type RateBlob = {
  base: string;
  rates: Record<string, number>;
  fetchedAt: number;
  date?: string;
};

// 12-hour cache TTL. Source data updates daily, so once a day is plenty
// — caching this aggressively means a clinic doesn't hit the upstream
// API on every reports refresh.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
// Upstream call deadline. If the API stalls we'd rather return stale
// or no rates than hang every reports request behind a slow CDN.
const FETCH_TIMEOUT_MS = 5000;

/**
 * Foreign-exchange rates for bill-amount conversion.
 *
 * Source: https://github.com/fawazahmed0/currency-api (free, no API
 * key, hosted on jsDelivr's CDN; updates once a day). Returns plain
 * cross-rates against a base currency.
 *
 * IMPORTANT behavior — historical correctness:
 *   This service should be used to RE-EXPRESS amounts in a different
 *   currency for display only (e.g. the Dashboard's roll-ups). It is
 *   NOT a substitute for the bill's stored currency. The PDF, ledger,
 *   and individual bill rows still show the original currency. We
 *   round results to 2 decimals and never persist them.
 *
 * On any failure the service falls back to a 1:1 rate. Better to show
 * the wrong number with a stale-rate notice than to break the entire
 * Dashboard when the upstream blips.
 */
@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);
  private cache = new Map<string, RateBlob>();

  /**
   * Fetch (or return cached) rates with the given currency as base.
   * Result shape: `rates[targetCurrency] = how many target per 1 base`.
   */
  async getRates(base: string): Promise<RateBlob> {
    const code = normalize(base);
    const cached = this.cache.get(code);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

    const fresh = await this.fetchRates(code);
    if (fresh) {
      this.cache.set(code, fresh);
      return fresh;
    }
    // Upstream failed — return whatever we have (possibly stale) or
    // an empty blob so callers degrade to 1:1 instead of throwing.
    if (cached) {
      this.logger.warn(`Returning stale rates for ${code} (upstream fetch failed)`);
      return cached;
    }
    return { base: code, rates: {}, fetchedAt: Date.now() };
  }

  /**
   * Convert `amount` from `from` currency to `to` currency. Returns
   * `null` if either currency is missing/unknown so the caller can
   * decide to show "—" or fall back to the original amount with a hint.
   */
  async convert(amount: number, from: string, to: string): Promise<number | null> {
    if (!Number.isFinite(amount)) return null;
    const a = normalize(from);
    const b = normalize(to);
    if (a === b) return amount;
    const blob = await this.getRates(a);
    const rate = blob.rates[b];
    if (!Number.isFinite(rate) || rate <= 0) return null;
    return Math.round(amount * rate * 100) / 100;
  }

  /**
   * Batch-convert a set of per-currency totals to a single target.
   * Returns the summed result plus a per-source-currency breakdown
   * that the caller can surface in the UI ("totals include …").
   * Missing rates are recorded in `unconverted` and skipped from the
   * total — never silently 1:1-included.
   */
  async sumInto(
    buckets: Array<{ currency: string; amount: number }>,
    target: string,
  ): Promise<{
    target: string;
    total: number;
    breakdown: Array<{ currency: string; amount: number; converted: number | null }>;
    unconverted: string[];
  }> {
    const dst = normalize(target);
    let total = 0;
    const unconverted: string[] = [];
    const breakdown: Array<{ currency: string; amount: number; converted: number | null }> = [];
    for (const b of buckets) {
      const src = normalize(b.currency);
      if (src === dst) {
        total += b.amount;
        breakdown.push({ currency: src, amount: b.amount, converted: b.amount });
        continue;
      }
      const c = await this.convert(b.amount, src, dst);
      if (c === null) {
        unconverted.push(src);
        breakdown.push({ currency: src, amount: b.amount, converted: null });
        continue;
      }
      total += c;
      breakdown.push({ currency: src, amount: b.amount, converted: c });
    }
    return { target: dst, total: Math.round(total * 100) / 100, breakdown, unconverted };
  }

  private async fetchRates(base: string): Promise<RateBlob | null> {
    const lower = base.toLowerCase();
    // Primary + fallback CDNs for the same dataset. jsDelivr is the
    // canonical mirror; cloudflare is the documented fallback.
    const urls = [
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${lower}.json`,
      `https://${lower}.currency-api.pages.dev/v1/currencies/${lower}.json`,
    ];
    for (const url of urls) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) continue;
        const body = (await res.json()) as Record<string, unknown>;
        const ratesRaw = body[lower];
        if (!ratesRaw || typeof ratesRaw !== 'object') continue;
        const rates: Record<string, number> = {};
        for (const [k, v] of Object.entries(ratesRaw as Record<string, unknown>)) {
          if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
            rates[k.toUpperCase()] = v;
          }
        }
        return {
          base,
          rates,
          fetchedAt: Date.now(),
          date: typeof body.date === 'string' ? body.date : undefined,
        };
      } catch (e) {
        this.logger.warn(`FX fetch from ${url} failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        clearTimeout(t);
      }
    }
    return null;
  }
}

function normalize(code: string | null | undefined): string {
  return (code ?? '').trim().toUpperCase();
}
