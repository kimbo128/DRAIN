/**
 * Inference Service
 * 
 * Makes AI API calls with DRAIN payment vouchers.
 */

import type { Hash } from 'viem';
import type { Voucher, ChannelService } from './channel.js';
import type { Provider } from './provider.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
}

export interface ChatResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  // DRAIN-specific
  drain?: {
    cost: string;
    totalSpent: string;
    channelId: string;
  };
}

export class InferenceService {
  constructor(private channelService: ChannelService) {}

  /**
   * Make a chat completion request with DRAIN payment
   */
  async chat(
    provider: Provider,
    channelId: Hash,
    request: ChatRequest
  ): Promise<ChatResponse> {
    // Estimate cost based on message length and model pricing
    // Rough estimate: count characters as ~4 chars per token
    const inputTokens = Math.ceil(
      request.messages.reduce((sum, m) => sum + m.content.length, 0) / 4
    );
    const expectedOutputTokens = request.max_tokens ?? 100; // Default estimate
    
    const estimatedCost = this.estimateCost(
      provider,
      request.model,
      inputTokens,
      expectedOutputTokens
    );
    
    // Check if channel has enough balance
    const hasBalance = await this.channelService.hasBalance(channelId, estimatedCost);
    if (!hasBalance) {
      throw new Error(
        `Insufficient channel balance. Need ~$${estimatedCost} but channel has less. ` +
        `Use drain_channel_status() to check balance.`
      );
    }
    
    // Sign voucher for payment
    const voucher = await this.channelService.signVoucher(channelId, estimatedCost);
    
    // Make the API call
    const response = await this.callProviderApi(provider, request, voucher);
    
    return response;
  }

  /**
   * Call the provider's API with voucher authentication
   */
  private async callProviderApi(
    provider: Provider,
    request: ChatRequest,
    voucher: Voucher
  ): Promise<ChatResponse> {
    const voucherHeader = JSON.stringify({
      channelId: voucher.channelId,
      amount: voucher.amount.toString(),
      nonce: voucher.nonce.toString(),
      signature: voucher.signature,
    });
    
    const response = await fetch(`${provider.apiUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-DRAIN-Voucher': voucherHeader,
      },
      body: JSON.stringify(request),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText })) as { error?: { message?: string } | string };
      const errorMsg = typeof errorData.error === 'string' 
        ? errorData.error 
        : errorData.error?.message ?? response.statusText;
      throw new Error(`Provider API error: ${errorMsg}`);
    }
    
    const result = await response.json() as ChatResponse;
    
    // Extract DRAIN cost info from headers
    const cost = response.headers.get('X-DRAIN-Cost');
    const totalSpent = response.headers.get('X-DRAIN-Total');
    
    if (cost || totalSpent) {
      result.drain = {
        cost: cost ?? '0',
        totalSpent: totalSpent ?? '0',
        channelId: voucher.channelId,
      };
    }
    
    return result;
  }

  /**
   * Estimate cost for a request (rough estimate based on token count)
   */
  estimateCost(
    provider: Provider,
    modelId: string,
    inputTokens: number,
    expectedOutputTokens: number
  ): string {
    const model = provider.models.find(m => m.id === modelId);
    if (!model) {
      return '0.01';
    }

    const inputPrice = parseFloat(model.pricing.inputPer1kTokens);
    const outputPrice = parseFloat(model.pricing.outputPer1kTokens);

    // Flat-rate provider (e.g. Apify): outputPer1k is 0, inputPer1k is the full run price
    if (outputPrice === 0 && inputPrice > 0) {
      return (inputPrice * 1.2).toFixed(6);
    }
    
    // Token-based provider (LLMs)
    const inputCost = (inputTokens / 1000) * inputPrice;
    const outputCost = (expectedOutputTokens / 1000) * outputPrice;
    const totalWithBuffer = (inputCost + outputCost) * 1.2;
    
    return totalWithBuffer.toFixed(6);
  }
}
