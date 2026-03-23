/**
 * Request Tool
 * 
 * Send paid requests to any provider through a payment channel.
 */

import type { Hash } from 'viem';
import type { ChannelService } from '../services/channel.js';
import type { ProviderService } from '../services/provider.js';
import type { InferenceService, ChatMessage } from '../services/inference.js';
import type { TelemetryService } from '../services/telemetry.js';

/**
 * Make a chat completion request
 */
export async function chat(
  channelService: ChannelService,
  providerService: ProviderService,
  inferenceService: InferenceService,
  telemetryService: TelemetryService,
  args: {
    channelId: string;
    model: string;
    messages: ChatMessage[];
    maxTokens?: number;
    temperature?: number;
  }
): Promise<string> {
  const channelId = args.channelId as Hash;
  const start = Date.now();
  
  const channel = await channelService.getChannel(channelId);
  
  if (channel.isExpired) {
    throw new Error('Channel has expired. Open a new channel to continue.');
  }
  
  const providers = await providerService.getProviders();
  const storedProviderId = channelService.getProviderId(channelId);
  const provider = storedProviderId
    ? providers.find(p => p.id === storedProviderId)
    : providers.find(p => p.providerAddress.toLowerCase() === channel.provider.toLowerCase());
  
  if (!provider) {
    throw new Error(`Provider ${channel.provider} not found in directory. The channel may be for an unlisted provider.`);
  }
  
  const modelInfo = provider.models.find(m => m.id === args.model);
  if (!modelInfo) {
    const availableModels = provider.models.map(m => m.id).join(', ');
    throw new Error(`Model "${args.model}" not available from this provider. Available: ${availableModels}`);
  }
  
  try {
    const response = await inferenceService.chat(provider, channelId, {
      model: args.model,
      messages: args.messages,
      max_tokens: args.maxTokens,
      temperature: args.temperature,
    });

    const latency = Date.now() - start;
    const cost = response.drain?.cost ?? '0';
    const costUsdc = parseFloat(cost) / 1_000_000;

    telemetryService.report({
      providerId: provider.id,
      latencyMs: latency,
      httpStatus: 200,
      costUsdc: isNaN(costUsdc) ? 0 : costUsdc,
      protocol: 'drain',
    });

    const assistantMessage = response.choices[0]?.message?.content ?? '';
    const totalSpent = response.drain?.totalSpent ?? 'unknown';
    
    return `${assistantMessage}\n\n---\n*Cost: $${formatCost(cost)} USDC | Total spent: $${formatCost(totalSpent)} USDC | Tokens: ${response.usage.total_tokens}*`;
  } catch (error) {
    const latency = Date.now() - start;
    telemetryService.report({
      providerId: provider.id,
      latencyMs: latency,
      httpStatus: 0,
      costUsdc: 0,
      protocol: 'drain',
    });
    throw error;
  }
}

/**
 * Format cost for display
 */
function formatCost(cost: string): string {
  const num = parseFloat(cost) / 1_000_000; // Convert from wei to USDC
  if (isNaN(num)) return cost;
  if (num < 0.0001) return num.toFixed(6);
  if (num < 0.01) return num.toFixed(4);
  return num.toFixed(4);
}

export const chatTools = [
  {
    name: 'drain_chat',
    description: `Send a paid request to a provider through an open payment channel.

Works for ALL provider types — not just LLM chat:
- LLM providers (category "llm"): Standard chat messages [{role, content}]
- Non-LLM providers (scraping, image, VPN, etc.): Put structured JSON in the user message content. The expected format is in the provider's docs — call drain_provider_info first.

Payment is automatic: signs a voucher, deducts from channel balance, returns the response.

Requires an open, non-expired channel with sufficient balance.

If "Channel expired" -> open a new channel.
If "Insufficient balance" -> open a new channel with more funds.
If "Provider offline" -> use drain_providers to find an alternative.`,
    inputSchema: {
      type: 'object',
      properties: {
        channelId: {
          type: 'string',
          description: 'The payment channel ID to use (0x...)',
        },
        model: {
          type: 'string',
          description: 'Model or service ID from the provider\'s model list (see drain_provider_info)',
        },
        messages: {
          type: 'array',
          description: 'Request payload. For LLM: chat messages [{role, content}]. For other providers: one user message with JSON content (see provider docs for format).',
          items: {
            type: 'object',
            properties: {
              role: {
                type: 'string',
                enum: ['system', 'user', 'assistant'],
                description: 'Message role',
              },
              content: {
                type: 'string',
                description: 'Message content (text for LLM, JSON string for non-LLM providers)',
              },
            },
            required: ['role', 'content'],
          },
        },
        maxTokens: {
          type: 'number',
          description: 'Maximum tokens to generate (LLM providers only, optional)',
        },
        temperature: {
          type: 'number',
          description: 'Sampling temperature 0-2 (LLM providers only, optional)',
        },
      },
      required: ['channelId', 'model', 'messages'],
    },
  },
];
