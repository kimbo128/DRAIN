/**
 * DRAIN Directory Database
 * 
 * Simple JSON-file based storage for provider directory.
 * Easy to migrate to PostgreSQL/MongoDB later.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// Types
export interface ProviderModel {
  id: string;
  name: string;
  inputCostPer1k: string;
  outputCostPer1k: string;
}

export interface Provider {
  id: string;
  name: string;
  apiUrl: string;
  providerAddress: string;
  description: string;
  logoUrl?: string;
  contactEmail: string;
  website?: string;
  
  // Status
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: number;
  approvedAt?: number;
  rejectedAt?: number;
  rejectedReason?: string;
  
  // Premium listing
  isPremium: boolean;
  premiumUntil?: number; // Unix timestamp, optional expiry
  wantsPremium?: boolean; // Requested premium during registration
  
  // Live stats (updated by health check)
  isOnline: boolean;
  lastCheckedAt?: number;
  avgResponseTime?: number;
  
  // Cached pricing from /v1/pricing
  models: ProviderModel[];
  chainId?: number;
}

export interface ConnectionTestResult {
  success: boolean;
  checks: {
    reachable: boolean;
    validFormat: boolean;
    addressMatch: boolean;
    responseTime: number;
    hasModels: boolean;
  };
  error?: string;
  pricing?: {
    provider: string;
    chainId: number;
    models: Record<string, { inputPer1kTokens: string; outputPer1kTokens: string }>;
  };
}

interface Database {
  providers: Provider[];
  adminPassword: string; // Simple auth for MVP
}

const DB_PATH = join(process.cwd(), 'data', 'directory.json');

// Initialize database
function initDb(): Database {
  return {
    providers: [],
    adminPassword: process.env.ADMIN_PASSWORD || 'drain-admin-2026',
  };
}

// Load database
export function loadDb(): Database {
  try {
    if (!existsSync(DB_PATH)) {
      const db = initDb();
      saveDb(db);
      return db;
    }
    const data = readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return initDb();
  }
}

// Save database
export function saveDb(db: Database): void {
  const dir = join(process.cwd(), 'data');
  if (!existsSync(dir)) {
    const { mkdirSync } = require('fs');
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// Provider operations
export function getAllProviders(): Provider[] {
  return loadDb().providers;
}

export function getApprovedProviders(): Provider[] {
  const providers = loadDb().providers.filter(p => p.status === 'approved');
  // Sort: Premium first, then by approval date
  return providers.sort((a, b) => {
    if (a.isPremium && !b.isPremium) return -1;
    if (!a.isPremium && b.isPremium) return 1;
    return (b.approvedAt || 0) - (a.approvedAt || 0);
  });
}

export function getPendingProviders(): Provider[] {
  return loadDb().providers.filter(p => p.status === 'pending');
}

export function getProviderById(id: string): Provider | undefined {
  return loadDb().providers.find(p => p.id === id);
}

export function getProviderByAddress(address: string): Provider | undefined {
  return loadDb().providers.find(
    p => p.providerAddress.toLowerCase() === address.toLowerCase()
  );
}

export function addProvider(provider: Omit<Provider, 'id' | 'submittedAt' | 'status' | 'isOnline' | 'isPremium' | 'models'>): Provider {
  const db = loadDb();
  
  const newProvider: Provider = {
    ...provider,
    id: `prov_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    status: 'pending',
    submittedAt: Date.now(),
    isOnline: false,
    isPremium: false,
    models: [],
  };
  
  db.providers.push(newProvider);
  saveDb(db);
  
  return newProvider;
}

export function updateProvider(id: string, updates: Partial<Provider>): Provider | null {
  const db = loadDb();
  const index = db.providers.findIndex(p => p.id === id);
  
  if (index === -1) return null;
  
  db.providers[index] = { ...db.providers[index], ...updates };
  saveDb(db);
  
  return db.providers[index];
}

export function approveProvider(id: string): Provider | null {
  return updateProvider(id, {
    status: 'approved',
    approvedAt: Date.now(),
  });
}

export function rejectProvider(id: string, reason: string): Provider | null {
  return updateProvider(id, {
    status: 'rejected',
    rejectedAt: Date.now(),
    rejectedReason: reason,
  });
}

export function deleteProvider(id: string): boolean {
  const db = loadDb();
  const index = db.providers.findIndex(p => p.id === id);
  
  if (index === -1) return false;
  
  db.providers.splice(index, 1);
  saveDb(db);
  
  return true;
}

// Connection test
export async function testProviderConnection(apiUrl: string, expectedAddress: string): Promise<ConnectionTestResult> {
  const result: ConnectionTestResult = {
    success: false,
    checks: {
      reachable: false,
      validFormat: false,
      addressMatch: false,
      responseTime: 0,
      hasModels: false,
    },
  };
  
  try {
    const startTime = Date.now();
    
    // 1. Fetch /v1/pricing
    const response = await fetch(`${apiUrl}/v1/pricing`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000), // 10s timeout
    });
    
    result.checks.responseTime = Date.now() - startTime;
    
    if (!response.ok) {
      result.error = `HTTP ${response.status}: ${response.statusText}`;
      return result;
    }
    
    result.checks.reachable = true;
    
    // 2. Parse response
    const data = await response.json();
    result.pricing = data;
    
    // 3. Validate format
    if (!data.provider || !data.models || typeof data.models !== 'object') {
      result.error = 'Invalid pricing format: missing provider or models';
      return result;
    }
    
    result.checks.validFormat = true;
    
    // 4. Check address match
    if (data.provider.toLowerCase() !== expectedAddress.toLowerCase()) {
      result.error = `Address mismatch: expected ${expectedAddress}, got ${data.provider}`;
      return result;
    }
    
    result.checks.addressMatch = true;
    
    // 5. Check has models
    const modelCount = Object.keys(data.models).length;
    if (modelCount === 0) {
      result.error = 'No models available';
      return result;
    }
    
    result.checks.hasModels = true;
    
    // All checks passed!
    result.success = true;
    
  } catch (error: any) {
    if (error.name === 'TimeoutError') {
      result.error = 'Connection timeout (>10s)';
    } else {
      result.error = error.message || 'Unknown error';
    }
  }
  
  return result;
}

// Health check for all approved providers
export async function runHealthChecks(): Promise<void> {
  const db = loadDb();
  const approved = db.providers.filter(p => p.status === 'approved');
  
  for (const provider of approved) {
    try {
      const startTime = Date.now();
      const response = await fetch(`${provider.apiUrl}/v1/pricing`, {
        signal: AbortSignal.timeout(5000),
      });
      
      const responseTime = Date.now() - startTime;
      const isOnline = response.ok;
      
      // Update provider
      const index = db.providers.findIndex(p => p.id === provider.id);
      if (index !== -1) {
        db.providers[index].isOnline = isOnline;
        db.providers[index].lastCheckedAt = Date.now();
        db.providers[index].avgResponseTime = responseTime;
        
        // Update cached pricing if online
        if (isOnline) {
          try {
            const data = await response.json();
            db.providers[index].models = Object.entries(data.models || {}).map(([id, pricing]: [string, any]) => ({
              id,
              name: id,
              inputCostPer1k: pricing.inputPer1kTokens,
              outputCostPer1k: pricing.outputPer1kTokens,
            }));
            db.providers[index].chainId = data.chainId;
          } catch {}
        }
      }
    } catch {
      const index = db.providers.findIndex(p => p.id === provider.id);
      if (index !== -1) {
        db.providers[index].isOnline = false;
        db.providers[index].lastCheckedAt = Date.now();
      }
    }
  }
  
  saveDb(db);
}

// Admin auth
export function verifyAdminPassword(password: string): boolean {
  const db = loadDb();
  return password === db.adminPassword;
}
