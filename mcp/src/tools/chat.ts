/**
 * Chat Tool
 * 
 * The main tool: Make AI chat requests with DRAIN payment.
 */

import type { Hash } from 'viem';
import type { ChannelService } from '../services/channel.js';
import type { ProviderService } from '../services/provider.js';
import type { InferenceService, ChatMessage } from '../services/inference.js';

/**
 * Make a chat completion request
 */
export async function chat(
  channelService: ChannelService,
  providerService: ProviderService,
  inferenceService: InferenceService,
  args: {
    channelId: string;
    model: string;
    messages: ChatMessage[];
    maxTokens?: number;
    temperature?: number;
  }
): Promise<string> {
  const channelId = args.channelId as Hash;
  
  // Get channel to find provider
  const channel = await channelService.getChannel(channelId);
  
  if (channel.isExpired) {
    throw new Error('Channel has expired. Open a new channel to continue.');
  }
  
  // Find provider by address
  const providers = await providerService.getProviders();
  const provider = providers.find(p => 
    p.providerAddress.toLowerCase() === channel.provider.toLowerCase()
  );
  
  if (!provider) {
    throw new Error(`Provider ${channel.provider} not found in directory. The channel may be for an unlisted provider.`);
  }
  
  // Check model is available
  const modelInfo = provider.models.find(m => m.id === args.model);
  if (!modelInfo) {
    const availableModels = provider.models.map(m => m.id).join(', ');
    throw new Error(`Model "${args.model}" not available from this provider. Available: ${availableModels}`);
  }
  
  // Make the request
  const response = await inferenceService.chat(provider, channelId, {
    model: args.model,
    messages: args.messages,
    max_tokens: args.maxTokens,
    temperature: args.temperature,
  });
  
  // Format response
  const assistantMessage = response.choices[0]?.message?.content ?? '';
  const cost = response.drain?.cost ?? 'unknown';
  const totalSpent = response.drain?.totalSpent ?? 'unknown';
  
  return `${assistantMessage}

---
*Cost: $${formatCost(cost)} USDC | Total spent: $${formatCost(totalSpent)} USDC | Tokens: ${response.usage.total_tokens}*`;
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

// Tool definition for MCP
export const chatTools = [
  {
    name: 'drain_chat',
    description: `Send a chat completion request to an AI provider through DRAIN.

This is the main tool for AI inference. It:
1. Uses your open payment channel
2. Automatically signs a payment voucher
3. Sends the request to the provider
4. Returns the AI response

PREREQUISITES:
- You must have an open channel (use drain_open_channel first)
- The channel must have sufficient balance
- The channel must not be expired

The cost is automatically deducted from your channel balance.`,
    inputSchema: {
      type: 'object',
      properties: {
        channelId: {
          type: 'string',
          description: 'The payment channel ID to use (0x...)',
        },
        model: {
          type: 'string',
          description: 'Model ID to use (e.g., "gpt-4o", "gpt-4o-mini")',
        },
        messages: {
          type: 'array',
          description: 'Chat messages in OpenAI format',
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
                description: 'Message content',
              },
            },
            required: ['role', 'content'],
          },
        },
        maxTokens: {
          type: 'number',
          description: 'Maximum tokens to generate (optional)',
        },
        temperature: {
          type: 'number',
          description: 'Sampling temperature 0-2 (optional)',
        },
      },
      required: ['channelId', 'model', 'messages'],
    },
  },
];
