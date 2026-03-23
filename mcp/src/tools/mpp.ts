/**
 * MPP Chat Tool
 *
 * Per-request payments via HTTP 402 protocol.
 * Calls MPP-compatible endpoints without payment channels.
 */

import type { ProviderService } from '../services/provider.js';
import type { TelemetryService } from '../services/telemetry.js';
import type { ChatMessage } from '../services/inference.js';

export async function mppChat(
  providerService: ProviderService,
  telemetryService: TelemetryService,
  args: {
    provider: string;
    messages: ChatMessage[];
    model?: string;
    maxTokens?: number;
    temperature?: number;
  }
): Promise<string> {
  if (!args.provider) {
    return 'Error: provider is required (provider ID or MPP endpoint URL).';
  }

  let endpoint: string;
  let providerId: string;

  if (args.provider.startsWith('http')) {
    endpoint = args.provider;
    providerId = args.provider;
  } else {
    const p = await providerService.getProvider(args.provider);
    if (!p) return `Error: Provider "${args.provider}" not found.`;
    endpoint = p.mppEndpoint || `${p.apiUrl}/v1/chat/completions`;
    providerId = p.id;
  }

  const body: Record<string, unknown> = {
    messages: args.messages,
  };
  if (args.model) body.model = args.model;
  if (args.maxTokens) body.max_tokens = args.maxTokens;
  if (args.temperature !== undefined) body.temperature = args.temperature;

  const start = Date.now();
  let httpStatus = 0;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    httpStatus = res.status;
    const latency = Date.now() - start;

    if (res.status === 402) {
      const wwwAuth = res.headers.get('www-authenticate') || '';
      const paymentInfo = res.headers.get('x-payment') || '';

      telemetryService.report({
        providerId,
        latencyMs: latency,
        httpStatus: 402,
        costUsdc: 0,
        protocol: 'mpp',
      });

      return [
        'Payment required (HTTP 402). This MPP provider requires per-request payment.',
        '',
        wwwAuth ? `WWW-Authenticate: ${wwwAuth}` : '',
        paymentInfo ? `X-Payment: ${paymentInfo}` : '',
        '',
        'To complete the payment, the agent needs an MPP payment handler (e.g. mppx).',
        'For providers using Tempo/Stripe, configure payment credentials in your environment.',
      ].filter(Boolean).join('\n');
    }

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({})) as Record<string, any>;
      const errorMsg = typeof errorData.error === 'string'
        ? errorData.error
        : errorData.error?.message ?? res.statusText;

      telemetryService.report({
        providerId,
        latencyMs: latency,
        httpStatus: res.status,
        costUsdc: 0,
        protocol: 'mpp',
      });

      return `Error from MPP provider: ${errorMsg} (HTTP ${res.status})`;
    }

    const data = await res.json() as Record<string, any>;
    const costHeader = res.headers.get('x-cost') || res.headers.get('x-drain-cost');
    const cost = costHeader ? parseFloat(costHeader) / 1_000_000 : 0;

    telemetryService.report({
      providerId,
      latencyMs: latency,
      httpStatus: 200,
      costUsdc: cost,
      protocol: 'mpp',
    });

    const content = data.choices?.[0]?.message?.content
      ?? data.result
      ?? JSON.stringify(data);

    const tokens = data.usage?.total_tokens ?? '';
    const costStr = cost > 0 ? ` | Cost: $${cost.toFixed(6)}` : '';
    const tokenStr = tokens ? ` | Tokens: ${tokens}` : '';

    return `${content}\n\n---\n*MPP request completed in ${latency}ms${costStr}${tokenStr}*`;
  } catch (error) {
    const latency = Date.now() - start;

    telemetryService.report({
      providerId,
      latencyMs: latency,
      httpStatus: httpStatus || 0,
      costUsdc: 0,
      protocol: 'mpp',
    });

    const msg = error instanceof Error ? error.message : String(error);
    return `MPP request failed: ${msg}`;
  }
}

export const mppTools = [
  {
    name: 'mpp_chat',
    description: `Send a per-request payment call to an MPP provider (HTTP 402 protocol).

No payment channel needed. Each request is paid individually.

Use this for providers with protocol="mpp" in drain_providers output.
For DRAIN providers, use drain_chat instead (requires an open channel).

If the provider returns HTTP 402, payment details will be shown.
Some MPP providers may respond directly without 402 if pre-authorized.`,
    inputSchema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          description: 'Provider ID (from drain_providers) or direct MPP endpoint URL',
        },
        messages: {
          type: 'array',
          description: 'Chat messages [{role, content}] or structured request',
          items: {
            type: 'object',
            properties: {
              role: {
                type: 'string',
                enum: ['system', 'user', 'assistant'],
              },
              content: {
                type: 'string',
              },
            },
            required: ['role', 'content'],
          },
        },
        model: {
          type: 'string',
          description: 'Model ID (optional, depends on provider)',
        },
        maxTokens: {
          type: 'number',
          description: 'Maximum tokens (optional)',
        },
        temperature: {
          type: 'number',
          description: 'Temperature 0-2 (optional)',
        },
      },
      required: ['provider', 'messages'],
    },
  },
];
