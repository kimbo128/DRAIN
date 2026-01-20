/**
 * DRAIN Reference Provider Types
 */

import type { Hash, Hex } from 'viem';

/**
 * Supported models and their pricing
 */
export interface ModelPricing {
  /** Price per 1000 input tokens (USDC wei, 6 decimals) */
  inputPer1k: bigint;
  /** Price per 1000 output tokens (USDC wei, 6 decimals) */
  outputPer1k: bigint;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  /** OpenAI API Key */
  openaiApiKey: string;
  /** Server port */
  port: number;
  /** Server host */
  host: string;
  /** Chain ID (137 for mainnet, 80002 for testnet) */
  chainId: 137 | 80002;
  /** Provider private key for claiming */
  providerPrivateKey: Hex;
  /** Model pricing configuration */
  pricing: Record<string, ModelPricing>;
  /** Claiming threshold in USDC wei */
  claimThreshold: bigint;
  /** Path to voucher storage file */
  storagePath: string;
}

/**
 * Voucher from X-DRAIN-Voucher header
 */
export interface VoucherHeader {
  channelId: Hash;
  amount: string;  // String because JSON
  nonce: string;   // String because JSON
  signature: Hex;
}

/**
 * Stored voucher with metadata
 */
export interface StoredVoucher {
  channelId: Hash;
  amount: bigint;
  nonce: bigint;
  signature: Hex;
  consumer: string;
  receivedAt: number;
  claimed: boolean;
  claimedAt?: number;
  claimTxHash?: Hash;
}

/**
 * Channel state tracked by provider
 */
export interface ChannelState {
  channelId: Hash;
  consumer: string;
  deposit: bigint;
  totalCharged: bigint;
  lastVoucher?: StoredVoucher;
  createdAt: number;
  lastActivityAt: number;
}

/**
 * Cost calculation result
 */
export interface CostResult {
  /** Cost of this request in USDC wei */
  cost: bigint;
  /** Input tokens used */
  inputTokens: number;
  /** Output tokens used */
  outputTokens: number;
  /** Total tokens */
  totalTokens: number;
}

/**
 * DRAIN response headers
 */
export interface DrainResponseHeaders {
  'X-DRAIN-Cost': string;
  'X-DRAIN-Total': string;
  'X-DRAIN-Remaining': string;
  'X-DRAIN-Channel': string;
}

/**
 * DRAIN error response headers
 */
export interface DrainErrorHeaders {
  'X-DRAIN-Error': string;
  'X-DRAIN-Required'?: string;
  'X-DRAIN-Provided'?: string;
}
