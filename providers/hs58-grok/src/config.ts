/**
 * HS58-Grok Provider Configuration
 * 
 * xAI Grok models with 50% markup on upstream prices.
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
 * Grok Model Pricing with 50% markup
 * 
 * Upstream prices (per million tokens):
 * - Grok 4: $3 input / $15 output
 * - Grok 4.1 Fast: $0.20 input / $0.50 output
 * - Grok Code Fast: $0.20 input / $1.50 output
 * 
 * DRAIN prices = upstream * 1.5
 * Stored in USDC wei per 1000 tokens (6 decimals)
 */
const GROK_PRICING: Record<string, ModelPricing> = {
  // Grok 4 (flagship model)
  'grok-4': {
    inputPer1k: BigInt(4500),   // $3/M * 1.5 = $4.50/M -> 4500 per 1K
    outputPer1k: BigInt(22500), // $15/M * 1.5 = $22.50/M -> 22500 per 1K
  },
  
  // Grok 4.1 Fast variants (budget-friendly)
  'grok-4.1-fast-reasoning': {
    inputPer1k: BigInt(300),    // $0.20/M * 1.5 = $0.30/M -> 300 per 1K
    outputPer1k: BigInt(750),   // $0.50/M * 1.5 = $0.75/M -> 750 per 1K
  },
  'grok-4.1-fast-non-reasoning': {
    inputPer1k: BigInt(300),
    outputPer1k: BigInt(750),
  },
  'grok-4-fast-reasoning': {
    inputPer1k: BigInt(300),
    outputPer1k: BigInt(750),
  },
  'grok-4-fast-non-reasoning': {
    inputPer1k: BigInt(300),
    outputPer1k: BigInt(750),
  },
  
  // Grok Code (optimized for coding)
  'grok-code-fast-1': {
    inputPer1k: BigInt(300),    // $0.20/M * 1.5 = $0.30/M -> 300 per 1K
    outputPer1k: BigInt(2250),  // $1.50/M * 1.5 = $2.25/M -> 2250 per 1K
  },
  
  // Grok 3 (legacy)
  'grok-3': {
    inputPer1k: BigInt(4500),
    outputPer1k: BigInt(22500),
  },
  'grok-3-mini': {
    inputPer1k: BigInt(450),    // $0.30/M * 1.5 = $0.45/M -> 450 per 1K
    outputPer1k: BigInt(750),   // $0.50/M * 1.5 = $0.75/M -> 750 per 1K
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
    xaiApiKey: requireEnv('XAI_API_KEY'),
    port: parseInt(optionalEnv('PORT', '3000')),
    host: optionalEnv('HOST', '0.0.0.0'),
    chainId,
    providerPrivateKey: requireEnv('PROVIDER_PRIVATE_KEY') as Hex,
    pricing: GROK_PRICING,
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
