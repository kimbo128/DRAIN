/**
 * MPP Payment Service
 *
 * Wraps mppx to handle HTTP 402 payments automatically.
 * Uses polyfill: false so only explicit mppFetch() calls go through mppx —
 * normal fetch (marketplace API, docs fetching) stays untouched.
 */

import { Mppx, tempo } from 'mppx/client';
import { privateKeyToAccount } from 'viem/accounts';
import type { DrainConfig } from '../config.js';

export interface MppFetchResult {
  response: Response;
  costUsdc: number;
}

export class MppPaymentService {
  private mppx: ReturnType<typeof Mppx.create>;
  private account: ReturnType<typeof privateKeyToAccount>;

  constructor(config: DrainConfig) {
    this.account = privateKeyToAccount(config.privateKey);

    this.mppx = Mppx.create({
      polyfill: false,
      methods: [tempo({ account: this.account })],
    });

    process.stderr.write(
      `[drain-mcp] MPP payments ready (wallet: ${this.account.address})\n`
    );
  }

  /**
   * Fetch with automatic MPP 402 payment resolution.
   * Returns the response and the cost in USDC.
   */
  async fetch(url: string, init?: RequestInit): Promise<MppFetchResult> {
    const response = await this.mppx.fetch(url, init);

    const costUsdc = this.extractCost(response);
    return { response, costUsdc };
  }

  private extractCost(response: Response): number {
    const receipt = response.headers.get('x-receipt')
      || response.headers.get('x-payment-receipt');
    if (receipt) {
      try {
        const parsed = JSON.parse(receipt);
        if (parsed.amount) {
          return parseFloat(parsed.amount) / 1_000_000;
        }
      } catch { /* not JSON, try other formats */ }
    }

    const costHeader = response.headers.get('x-cost')
      || response.headers.get('x-drain-cost');
    if (costHeader) {
      return parseFloat(costHeader) / 1_000_000;
    }

    return 0;
  }
}
