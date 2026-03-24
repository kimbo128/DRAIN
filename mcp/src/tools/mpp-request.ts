/**
 * MPP Request Tool
 *
 * Generic HTTP requests to MPP endpoints with raw JSON payloads.
 * For REST-style MPP services (Tavily, Wolfram, etc.) that don't use chat format.
 * Payment is handled automatically via mppx (Tempo).
 */

import type { TelemetryService } from '../services/telemetry.js';
import type { MppPaymentService } from '../services/mpp-payment.js';

export async function mppRequest(
  telemetryService: TelemetryService,
  mppPayment: MppPaymentService,
  args: {
    url: string;
    body?: Record<string, unknown>;
    method?: string;
  }
): Promise<string> {
  if (!args.url) {
    return 'Error: url is required (full MPP endpoint URL including path, e.g. https://tavily.mpp.paywithlocus.com/tavily/search).';
  }

  const method = (args.method || 'POST').toUpperCase();
  const start = Date.now();

  try {
    const fetchOpts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (args.body && method !== 'GET') {
      fetchOpts.body = JSON.stringify(args.body);
    }

    const { response: res, costUsdc } = await mppPayment.fetch(args.url, fetchOpts);
    const latency = Date.now() - start;

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);

      telemetryService.report({
        providerId: args.url,
        latencyMs: latency,
        httpStatus: res.status,
        costUsdc,
        protocol: 'mpp',
      });

      return `Error from MPP endpoint: ${errText.slice(0, 500)} (HTTP ${res.status})`;
    }

    const contentType = res.headers.get('content-type') || '';

    telemetryService.report({
      providerId: args.url,
      latencyMs: latency,
      httpStatus: 200,
      costUsdc,
      protocol: 'mpp',
    });

    let content: string;
    if (contentType.includes('json')) {
      const data = await res.json();
      content = JSON.stringify(data, null, 2);
    } else {
      content = await res.text();
    }

    const costStr = costUsdc > 0 ? ` | Cost: $${costUsdc.toFixed(6)}` : '';
    return `${content}\n\n---\n*MPP ${method} completed in ${latency}ms${costStr}*`;
  } catch (error) {
    const latency = Date.now() - start;

    telemetryService.report({
      providerId: args.url,
      latencyMs: latency,
      httpStatus: 0,
      costUsdc: 0,
      protocol: 'mpp',
    });

    const msg = error instanceof Error ? error.message : String(error);
    return `MPP request failed: ${msg}`;
  }
}

export const mppRequestTools = [
  {
    name: 'mpp_request',
    description: `Send a request to an MPP REST API service. Payment is automatic via Tempo.

For non-LLM MPP services like Tavily (search), Brave (search), Wolfram (data), etc.
These expect raw JSON payloads, not chat messages.

For LLM-style MPP providers, use mpp_chat instead.
Use drain_provider_info to read the provider's docs for endpoint paths and request format.

Example: mpp_request(url: "https://tavily.mpp.paywithlocus.com/tavily/search", body: {"query": "AI agents", "max_results": 5})`,
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Full MPP endpoint URL including path (e.g. https://tavily.mpp.paywithlocus.com/tavily/search)',
        },
        body: {
          type: 'object',
          description: 'JSON request body to send (raw, not wrapped in messages)',
        },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'DELETE'],
          description: 'HTTP method (default: POST)',
        },
      },
      required: ['url'],
    },
  },
];
