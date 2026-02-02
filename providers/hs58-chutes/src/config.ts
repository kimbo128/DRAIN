/**
 * HS58-Chutes Provider Configuration
 * 
 * Auto-discovers models and pricing from Chutes API.
 * Applies 50% markup on all upstream prices.
 */

import { config } from 'dotenv';
import type { ProviderConfig, ModelPricing, ChutesModel } from './types.js';
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

// Global pricing cache
let pricingCache: Map<string, ModelPricing> = new Map();
let modelListCache: ChutesModel[] = [];
let lastPricingUpdate = 0;

/**
 * Fetch models and pricing from Chutes API
 */
export async function fetchChutesModels(apiKey: string): Promise<ChutesModel[]> {
  try {
    // Try the pricing endpoint first
    const response = await fetch('https://api.chutes.ai/pricing', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      // Fallback: try /v1/models endpoint
      const modelsResponse = await fetch('https://api.chutes.ai/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });
      
      if (!modelsResponse.ok) {
        throw new Error(`Chutes API error: ${modelsResponse.status}`);
      }
      
      const data = await modelsResponse.json() as { data?: any[] };
      // Map model format if different
      return (data.data || []).map((m: any) => ({
        id: m.id,
        name: m.name || m.id,
        input_price: m.pricing?.prompt ? parseFloat(m.pricing.prompt) * 1_000_000 : 1.0,
        output_price: m.pricing?.completion ? parseFloat(m.pricing.completion) * 1_000_000 : 2.0,
        context_length: m.context_length,
      }));
    }

    const data = await response.json() as { models?: ChutesModel[] };
    return data.models || [];
  } catch (error) {
    console.error('Failed to fetch Chutes models:', error);
    // Return fallback models
    return getDefaultModels();
  }
}

/**
 * Default models as fallback if API doesn't return pricing
 */
function getDefaultModels(): ChutesModel[] {
  return [
    {
      id: 'unsloth/Llama-3.3-70B-Instruct',
      name: 'Llama 3.3 70B Instruct',
      input_price: 0.50,  // $0.50/M
      output_price: 1.00,
    },
    {
      id: 'deepseek-ai/DeepSeek-R1',
      name: 'DeepSeek R1',
      input_price: 0.55,
      output_price: 2.19,
    },
    {
      id: 'deepseek-ai/DeepSeek-V3',
      name: 'DeepSeek V3',
      input_price: 0.27,
      output_price: 1.10,
    },
    {
      id: 'Qwen/QwQ-32B-Preview',
      name: 'Qwen QwQ 32B Preview',
      input_price: 0.15,
      output_price: 0.60,
    },
    {
      id: 'mistralai/Mistral-Small-24B-Instruct-2501',
      name: 'Mistral Small 24B',
      input_price: 0.10,
      output_price: 0.30,
    },
  ];
}

/**
 * Convert Chutes pricing to DRAIN pricing (with markup)
 * 
 * Chutes pricing is per million tokens
 * DRAIN pricing is per 1000 tokens in USDC wei (6 decimals)
 * 
 * Formula: (price_per_million / 1000) * 1_000_000 * markup
 */
function convertPricing(model: ChutesModel, markup: number): ModelPricing {
  const inputPer1k = BigInt(Math.ceil((model.input_price / 1000) * 1_000_000 * markup));
  const outputPer1k = BigInt(Math.ceil((model.output_price / 1000) * 1_000_000 * markup));
  
  return { inputPer1k, outputPer1k };
}

/**
 * Update pricing cache from Chutes API
 */
export async function updatePricingCache(apiKey: string, markup: number): Promise<void> {
  console.log('🔄 Updating pricing from Chutes API...');
  
  const models = await fetchChutesModels(apiKey);
  
  if (models.length === 0) {
    console.warn('⚠️ No models returned from Chutes API, using defaults');
  }

  const newPricing = new Map<string, ModelPricing>();
  
  for (const model of models) {
    newPricing.set(model.id, convertPricing(model, markup));
  }

  pricingCache = newPricing;
  modelListCache = models;
  lastPricingUpdate = Date.now();
  
  console.log(`✅ Loaded pricing for ${newPricing.size} models (${markup * 100 - 100}% markup)`);
}

/**
 * Get pricing for a model
 */
export function getModelPricing(model: string): ModelPricing | null {
  return pricingCache.get(model) ?? null;
}

/**
 * Check if a model is supported
 */
export function isModelSupported(model: string): boolean {
  return pricingCache.has(model);
}

/**
 * Get all supported models
 */
export function getSupportedModels(): string[] {
  return Array.from(pricingCache.keys());
}

/**
 * Get full model list with details
 */
export function getModelList(): ChutesModel[] {
  return modelListCache;
}

/**
 * Get pricing cache age in seconds
 */
export function getPricingAge(): number {
  return Math.floor((Date.now() - lastPricingUpdate) / 1000);
}

/**
 * Load and validate configuration
 */
export function loadConfig(): ProviderConfig {
  const chainIdStr = optionalEnv('CHAIN_ID', '137');
  const chainId = parseInt(chainIdStr) as 137 | 80002;
  
  if (chainId !== 137 && chainId !== 80002) {
    throw new Error(`Invalid CHAIN_ID: ${chainId}. Must be 137 (mainnet) or 80002 (testnet).`);
  }

  const markupPercent = parseInt(optionalEnv('MARKUP_PERCENT', '50'));
  const markup = 1 + (markupPercent / 100);

  return {
    chutesApiKey: requireEnv('CHUTES_API_KEY'),
    port: parseInt(optionalEnv('PORT', '3000')),
    host: optionalEnv('HOST', '0.0.0.0'),
    chainId,
    providerPrivateKey: requireEnv('PROVIDER_PRIVATE_KEY') as Hex,
    pricing: pricingCache,
    claimThreshold: BigInt(optionalEnv('CLAIM_THRESHOLD', '10000000')),
    storagePath: optionalEnv('STORAGE_PATH', './data/vouchers.json'),
    pricingRefreshInterval: parseInt(optionalEnv('PRICING_REFRESH_INTERVAL', '3600')) * 1000,
    markup,
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
