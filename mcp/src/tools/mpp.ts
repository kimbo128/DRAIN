/**
 * MPP Chat Tool
 *
 * Per-request payments via HTTP 402 protocol.
 * Payment is handled automatically via mppx (Tempo).
 */

import type { ProviderService } from '../services/provider.js';
import type { TelemetryService } from '../services/telemetry.js';
import type { MppPaymentService } from '../services/mpp-payment.js';
import type { ChatMessage } from '../services/inference.js';

export async function mppChat(
  providerService: ProviderService,
  telemetryService: TelemetryService,
  mppPayment: MppPaymentService,
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

  try {
    const { response: res, costUsdc } = await mppPayment.fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const latency = Date.now() - start;

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({})) as Record<string, any>;
      const errorMsg = typeof errorData.error === 'string'
        ? errorData.error
        : errorData.error?.message ?? res.statusText;

      telemetryService.report({
        providerId,
        latencyMs: latency,
        httpStatus: res.status,
        costUsdc,
        protocol: 'mpp',
      });

      return `Error from MPP provider: ${errorMsg} (HTTP ${res.status})`;
    }

    const data = await res.json() as Record<string, any>;

    telemetryService.report({
      providerId,
      latencyMs: latency,
      httpStatus: 200,
      costUsdc,
      protocol: 'mpp',
    });

    const content = data.choices?.[0]?.message?.content
      ?? data.result
      ?? JSON.stringify(data);

    const tokens = data.usage?.total_tokens ?? '';
    const costStr = costUsdc > 0 ? ` | Cost: $${costUsdc.toFixed(6)}` : '';
    const tokenStr = tokens ? ` | Tokens: ${tokens}` : '';

    return `${content}\n\n---\n*MPP request completed in ${latency}ms${costStr}${tokenStr}*`;
  } catch (error) {
    const latency = Date.now() - start;

    telemetryService.report({
      providerId,
      latencyMs: latency,
      httpStatus: 0,
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
    description: `Send a chat request to an MPP LLM provider. Payment is automatic via Tempo.

For LLM-style MPP providers (OpenAI, Anthropic, Groq, Perplexity via MPP).
No payment channel needed — each request is paid individually on send.

For REST API MPP services (Tavily, Brave, Wolfram), use mpp_request instead.
For DRAIN providers, use drain_chat instead (requires an open channel).`,
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
