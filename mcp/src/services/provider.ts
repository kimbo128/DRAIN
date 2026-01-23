/**
 * Provider Discovery Service
 * 
 * Discovers and fetches AI providers from the DRAIN directory.
 */

import type { DrainConfig } from '../config.js';

export interface ProviderModel {
  id: string;
  name: string;
  pricing: {
    inputPer1kTokens: string;
    outputPer1kTokens: string;
    currency: string;
    decimals: number;
  };
}

export interface Provider {
  id: string;
  name: string;
  description: string;
  apiUrl: string;
  providerAddress: string;
  chainId: number;
  status: {
    online: boolean;
    lastChecked: number | null;
    latencyMs: number | null;
  };
  models: ProviderModel[];
}

export interface DirectoryResponse {
  version: string;
  providers: Provider[];
  count: number;
  timestamp: string;
  _meta: {
    protocol: string;
    network: string;
    contract: string;
    directoryUrl: string;
  };
}

export class ProviderService {
  private cache: Provider[] = [];
  private lastFetch: number = 0;
  private cacheTtl: number = 60000; // 1 minute

  constructor(private config: DrainConfig) {}

  /**
   * Fetch all providers from directory
   */
  async getProviders(forceRefresh = false): Promise<Provider[]> {
    const now = Date.now();
    
    // Return cached if still valid
    if (!forceRefresh && this.cache.length > 0 && (now - this.lastFetch) < this.cacheTtl) {
      return this.cache;
    }
    
    try {
      // Include offline providers - the MCP server should show all options
      const url = new URL(this.config.directoryUrl);
      url.searchParams.set('online', 'false');
      const response = await fetch(url.toString());
      
      if (!response.ok) {
        throw new Error(`Failed to fetch providers: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json() as DirectoryResponse;
      
      this.cache = data.providers;
      this.lastFetch = now;
      
      return this.cache;
    } catch (error) {
      // If we have cache, return it even if stale
      if (this.cache.length > 0) {
        console.error('Failed to refresh providers, using cache:', error);
        return this.cache;
      }
      throw error;
    }
  }

  /**
   * Get a specific provider by ID
   */
  async getProvider(providerId: string): Promise<Provider | null> {
    const providers = await this.getProviders();
    return providers.find(p => p.id === providerId) ?? null;
  }

  /**
   * Find providers that support a specific model
   */
  async findByModel(modelId: string): Promise<Provider[]> {
    const providers = await this.getProviders();
    return providers.filter(p => 
      p.models.some(m => m.id === modelId || m.name.toLowerCase().includes(modelId.toLowerCase()))
    );
  }

  /**
   * Get only online providers
   */
  async getOnlineProviders(): Promise<Provider[]> {
    const providers = await this.getProviders();
    return providers.filter(p => p.status.online);
  }

  /**
   * Find the best provider for a model (online, lowest latency)
   */
  async findBestProvider(modelId: string): Promise<Provider | null> {
    const providers = await this.findByModel(modelId);
    const online = providers.filter(p => p.status.online);
    
    if (online.length === 0) {
      return providers[0] ?? null; // Return any if none online
    }
    
    // Sort by latency (lowest first)
    online.sort((a, b) => {
      const latA = a.status.latencyMs ?? Infinity;
      const latB = b.status.latencyMs ?? Infinity;
      return latA - latB;
    });
    
    return online[0];
  }
}
