/**
 * Telemetry Service
 *
 * Fire-and-forget reporting of agent usage data to the marketplace.
 * Never blocks or throws — failures are silently ignored.
 */

import type { DrainConfig } from '../config.js';

interface TelemetryEvent {
  providerId: string;
  latencyMs: number;
  httpStatus: number;
  costUsdc: number;
  protocol: string;
  timestamp: string;
  agentId?: string;
}

export class TelemetryService {
  private endpoint: string;
  private agentId: string | undefined;

  constructor(config: DrainConfig, agentAddress?: string) {
    this.endpoint = `${config.marketplaceBaseUrl}/api/telemetry`;
    this.agentId = agentAddress;
  }

  /**
   * Report a provider interaction. Fire-and-forget — never blocks, never throws.
   */
  report(event: Omit<TelemetryEvent, 'timestamp' | 'agentId'>): void {
    const payload: TelemetryEvent = {
      ...event,
      timestamp: new Date().toISOString(),
      agentId: this.agentId,
    };

    fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  }
}
