/**
 * Provider Configuration
 */

import { config } from 'dotenv';
import type { ProviderConfig, ModelPricing } from './types.js';
import type { Hex } from 'viem';

// Load .env file
config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

/**
 * Default pricing (can be overridden via env)
 * Prices are in USDC wei per 1000 tokens
 * 
 * Example: 7500 = $0.0075 per 1K tokens (7500 / 1_000_000 * 1000)
 */
const DEFAULT_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': {
    inputPer1k: BigInt(optionalEnv('PRICE_GPT4O_INPUT', '7500')),
    outputPer1k: BigInt(optionalEnv('PRICE_GPT4O_OUTPUT', '22500')),
  },
  'gpt-4o-mini': {
    inputPer1k: BigInt(optionalEnv('PRICE_GPT4O_MINI_INPUT', '225')),
    outputPer1k: BigInt(optionalEnv('PRICE_GPT4O_MINI_OUTPUT', '900')),
  },
  'gpt-4-turbo': {
    inputPer1k: BigInt(optionalEnv('PRICE_GPT4_TURBO_INPUT', '10000')),
    outputPer1k: BigInt(optionalEnv('PRICE_GPT4_TURBO_OUTPUT', '30000')),
  },
  'gpt-3.5-turbo': {
    inputPer1k: BigInt(optionalEnv('PRICE_GPT35_TURBO_INPUT', '500')),
    outputPer1k: BigInt(optionalEnv('PRICE_GPT35_TURBO_OUTPUT', '1500')),
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
    openaiApiKey: requireEnv('OPENAI_API_KEY'),
    port: parseInt(optionalEnv('PORT', '3000')),
    host: optionalEnv('HOST', '0.0.0.0'),
    chainId,
    providerPrivateKey: requireEnv('PROVIDER_PRIVATE_KEY') as Hex,
    pricing: DEFAULT_PRICING,
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
