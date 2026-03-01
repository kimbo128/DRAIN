/**
 * HS58-Claude Provider Configuration
 * 
 * Anthropic Claude models with 50% markup on upstream prices.
 */

import { config } from 'dotenv';
import type { ProviderConfig, ModelPricing } from './types.js';
import type { Hex } from 'viem';

// Load .env file
config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`⚠️ Missing required environment variable: ${name}`);
    console.error(`Please set ${name} in Railway Variables`);
    return `MISSING_${name}`;
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

/**
 * Claude Model Pricing with 50% markup
 * 
 * Upstream prices (per million tokens):
 * - Claude 3.5 Sonnet: $3 input / $15 output
 * - Claude 3.5 Haiku: $1 input / $5 output
 * - Claude 3 Opus: $15 input / $75 output
 * 
 * DRAIN prices = upstream * 1.5
 * Stored in USDC wei per 1000 tokens (6 decimals)
 * 
 * Formula: (price_per_million / 1000) * 1_000_000 * 1.5
 * Example: $3/M input = (3/1000) * 1_000_000 * 1.5 = 4500 per 1K
 */
const CLAUDE_PRICING: Record<string, ModelPricing> = {
  // Claude 3.5 Sonnet (most popular)
  'claude-sonnet-4-20250514': {
    inputPer1k: BigInt(4500),   // $3/M * 1.5 = $4.50/M -> 4500 per 1K
    outputPer1k: BigInt(22500), // $15/M * 1.5 = $22.50/M -> 22500 per 1K
  },
  'claude-3-5-sonnet-20241022': {
    inputPer1k: BigInt(4500),
    outputPer1k: BigInt(22500),
  },
  'claude-3-5-sonnet-latest': {
    inputPer1k: BigInt(4500),
    outputPer1k: BigInt(22500),
  },
  
  // Claude 3.5 Haiku (fast & cheap)
  'claude-3-5-haiku-20241022': {
    inputPer1k: BigInt(1500),   // $1/M * 1.5 = $1.50/M -> 1500 per 1K
    outputPer1k: BigInt(7500),  // $5/M * 1.5 = $7.50/M -> 7500 per 1K
  },
  'claude-3-5-haiku-latest': {
    inputPer1k: BigInt(1500),
    outputPer1k: BigInt(7500),
  },
  
  // Claude 3 Opus (most capable)
  'claude-3-opus-20240229': {
    inputPer1k: BigInt(22500),  // $15/M * 1.5 = $22.50/M -> 22500 per 1K
    outputPer1k: BigInt(112500), // $75/M * 1.5 = $112.50/M -> 112500 per 1K
  },
  'claude-3-opus-latest': {
    inputPer1k: BigInt(22500),
    outputPer1k: BigInt(112500),
  },
};

/**
 * Load and validate configuration
 */
export function loadConfig(): ProviderConfig {
  const chainIdStr = optionalEnv('CHAIN_ID', '137');
  const chainId = parseInt(chainIdStr) as 137 | 80002;
  
  if (chainId !== 137 && chainId !== 80002) {
    throw new Error(`Invalid CHAIN_ID: ${chainId}. Must be 137 (mainnet) or 80002 (testnet).`);
  }

  return {
    anthropicApiKey: requireEnv('ANTHROPIC_API_KEY'),
    port: parseInt(optionalEnv('PORT', '3000')),
    host: optionalEnv('HOST', '0.0.0.0'),
    chainId,
    providerPrivateKey: requireEnv('PROVIDER_PRIVATE_KEY') as Hex,
    pricing: CLAUDE_PRICING,
    claimThreshold: BigInt(optionalEnv('CLAIM_THRESHOLD', '10000000')), // $10 default
    storagePath: optionalEnv('STORAGE_PATH', './data/vouchers.json'),
  };
}

/**
 * Calculate cost for a request
 */
export function calculateCost(
  pricing: ModelPricing,
  inputTokens: number,
  outputTokens: number
): bigint {
  // Cost = (inputTokens * inputPer1k / 1000) + (outputTokens * outputPer1k / 1000)
  const inputCost = (BigInt(inputTokens) * pricing.inputPer1k) / 1000n;
  const outputCost = (BigInt(outputTokens) * pricing.outputPer1k) / 1000n;
  return inputCost + outputCost;
}

/**
 * Get pricing for a model
 */
export function getModelPricing(
  config: ProviderConfig,
  model: string
): ModelPricing | null {
  return config.pricing[model] ?? null;
}

/**
 * Check if a model is supported
 */
export function isModelSupported(config: ProviderConfig, model: string): boolean {
  return model in config.pricing;
}

/**
 * Get all supported models
 */
export function getSupportedModels(config: ProviderConfig): string[] {
  return Object.keys(config.pricing);
}
