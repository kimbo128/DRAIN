'use client';

import { useState, useEffect } from 'react';

// Types
interface ProviderModel {
  id: string;
  name: string;
  inputCostPer1k: string;
  outputCostPer1k: string;
}

interface Provider {
  id: string;
  name: string;
  apiUrl: string;
  providerAddress: string;
  description: string;
  logoUrl?: string;
  website?: string;
  contactEmail?: string;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: number;
  approvedAt?: number;
  rejectedReason?: string;
  isPremium: boolean;
  isOnline: boolean;
  lastCheckedAt?: number;
  avgResponseTime?: number;
  models: ProviderModel[];
  chainId?: number;
}

interface ConnectionTestResult {
  success: boolean;
  checks: {
    reachable: boolean;
    validFormat: boolean;
    addressMatch: boolean;
    responseTime: number;
    hasModels: boolean;
  };
  error?: string;
}

// ============================================================================
// MARKETPLACE VIEW
// ============================================================================

function MarketplaceView() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProviders();
  }, []);

  async function fetchProviders() {
    try {
      setLoading(true);
      const res = await fetch('/api/directory/providers');
      const data = await res.json();
      if (data.success) {
        setProviders(data.providers);
      } else {
        setError(data.error);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12 font-mono text-[#707080]">
        <div className="animate-pulse">⏳ loading_providers...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 font-mono text-[#ff4444]">
        ERROR: {error}
      </div>
    );
  }

  if (providers.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="font-mono text-[#707080] mb-4">// no providers found</div>
        <p className="text-sm text-[#a0a0b0]">Be the first to register your DRAIN provider!</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {providers.map((provider) => (
        <div 
          key={provider.id} 
          className={`terminal-card relative ${provider.isPremium ? 'border-[#ffff00]/40 bg-gradient-to-br from-[#111118] to-[#1a1a0a]' : ''}`}
        >
          {provider.isPremium && (
            <div className="absolute -top-2 -right-2 px-2 py-0.5 bg-[#ffff00] text-black text-[10px] font-mono font-bold rounded shadow-lg">
              ⭐ FEATURED
            </div>
          )}
          <div className="terminal-header">
            <div className="flex items-center gap-3">
              <div className="terminal-dots">
                <div className="terminal-dot red"></div>
                <div className="terminal-dot yellow"></div>
                <div className="terminal-dot green"></div>
              </div>
              <span className="font-mono text-xs text-[#707080]">{provider.id}</span>
            </div>
            <span className={`status-dot ${provider.isOnline ? 'online' : 'offline'}`}></span>
          </div>
          
          <div className="p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className={`font-bold text-lg ${provider.isPremium ? 'text-[#ffff00]' : 'text-[#f0f0f5]'}`}>{provider.name}</h3>
                <p className="text-xs text-[#707080] font-mono mt-1">
                  {provider.providerAddress.slice(0, 10)}...{provider.providerAddress.slice(-8)}
                </p>
              </div>
              {provider.isOnline && (
                <span className="px-2 py-0.5 bg-[#00ff9f]/10 text-[#00ff9f] border border-[#00ff9f]/30 rounded text-[10px] font-mono">
                  ONLINE
                </span>
              )}
            </div>
            
            <p className="text-sm text-[#a0a0b0] mb-4 line-clamp-2">{provider.description}</p>
            
            {/* Models */}
            <div className="mb-4">
              <div className="text-[10px] text-[#707080] mb-2 font-mono uppercase tracking-wider">// models</div>
              <div className="flex flex-wrap gap-2">
                {provider.models.map((model) => (
                  <span 
                    key={model.id}
                    className="px-2 py-1 bg-[#111118] border border-[#2a2a3e] rounded text-xs font-mono text-[#00ccff]"
                  >
                    {model.name}
                  </span>
                ))}
              </div>
            </div>
            
            {/* Stats */}
            <div className="grid grid-cols-2 gap-2 text-xs font-mono mb-4">
              <div className="data-row">
                <span className="data-label">latency</span>
                <span className="data-value">{provider.avgResponseTime || '—'}ms</span>
              </div>
              <div className="data-row">
                <span className="data-label">chain</span>
                <span className="data-value">{provider.chainId === 137 ? 'polygon' : 'testnet'}</span>
              </div>
            </div>
            
            {/* Actions */}
            <div className="flex gap-2">
              <a
                href={`/?provider=${encodeURIComponent(provider.apiUrl)}&address=${provider.providerAddress}`}
                className="flex-1 btn-primary text-center text-xs py-2"
              >
                TRY_NOW
              </a>
              {provider.website && (
                <a
                  href={provider.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary text-xs py-2 px-3"
                >
                  DOCS
                </a>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// SUBMIT FORM
// ============================================================================

function SubmitForm() {
  const [formData, setFormData] = useState({
    name: '',
    apiUrl: '',
    providerAddress: '',
    description: '',
    contactEmail: '',
    website: '',
    logoUrl: '',
    wantsPremium: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; testResult?: ConnectionTestResult } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);

    try {
      const res = await fetch('/api/directory/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      
      const data = await res.json();
      
      if (data.success) {
        setResult({
          success: true,
          message: formData.wantsPremium 
            ? 'Provider submitted! We\'ll contact you about featured placement.' 
            : 'Provider submitted for review! We\'ll notify you once approved.',
          testResult: data.testResult,
        });
        setFormData({
          name: '',
          apiUrl: '',
          providerAddress: '',
          description: '',
          contactEmail: '',
          website: '',
          logoUrl: '',
          wantsPremium: false,
        });
      } else {
        setResult({
          success: false,
          message: data.error || 'Submission failed',
          testResult: data.testResult,
        });
      }
    } catch (err: any) {
      setResult({
        success: false,
        message: err.message,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="terminal-card max-w-2xl mx-auto">
      <div className="terminal-header">
        <div className="terminal-dots">
          <div className="terminal-dot red"></div>
          <div className="terminal-dot yellow"></div>
          <div className="terminal-dot green"></div>
        </div>
        <span className="font-mono text-xs text-[#707080]">provider.register()</span>
      </div>
      
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div className="font-mono text-xs text-[#707080] mb-4">
          // submit your DRAIN provider for review
        </div>
        
        {result && (
          <div className={`p-4 rounded font-mono text-sm ${
            result.success 
              ? 'bg-[#00ff9f]/10 border border-[#00ff9f]/30 text-[#00ff9f]'
              : 'bg-[#ff4444]/10 border border-[#ff4444]/30 text-[#ff4444]'
          }`}>
            <div className="mb-2">{result.success ? '✓' : '✗'} {result.message}</div>
            {result.testResult && (
              <div className="text-xs opacity-80 space-y-1">
                <div>reachable: {result.testResult.checks.reachable ? '✓' : '✗'}</div>
                <div>valid_format: {result.testResult.checks.validFormat ? '✓' : '✗'}</div>
                <div>address_match: {result.testResult.checks.addressMatch ? '✓' : '✗'}</div>
                <div>has_models: {result.testResult.checks.hasModels ? '✓' : '✗'}</div>
                <div>response_time: {result.testResult.checks.responseTime}ms</div>
              </div>
            )}
          </div>
        )}
        
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="name" className="block text-[10px] text-[#707080] mb-1 font-mono uppercase tracking-wider">
              Provider Name *
            </label>
            <input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              placeholder="My AI Provider"
              className="w-full"
            />
          </div>
          
          <div>
            <label htmlFor="apiUrl" className="block text-[10px] text-[#707080] mb-1 font-mono uppercase tracking-wider">
              API URL *
            </label>
            <input
              id="apiUrl"
              type="url"
              value={formData.apiUrl}
              onChange={(e) => setFormData({ ...formData, apiUrl: e.target.value })}
              required
              placeholder="https://api.myprovider.com"
              className="w-full"
            />
          </div>
        </div>
        
        <div>
          <label htmlFor="providerAddress" className="block text-[10px] text-[#707080] mb-1 font-mono uppercase tracking-wider">
            Provider Wallet Address *
          </label>
          <input
            id="providerAddress"
            type="text"
            value={formData.providerAddress}
            onChange={(e) => setFormData({ ...formData, providerAddress: e.target.value })}
            required
            placeholder="0x..."
            pattern="^0x[a-fA-F0-9]{40}$"
            className="w-full font-mono"
          />
        </div>
        
        <div>
          <label htmlFor="description" className="block text-[10px] text-[#707080] mb-1 font-mono uppercase tracking-wider">
            Description *
          </label>
          <textarea
            id="description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            required
            placeholder="Describe your provider, supported models, features..."
            rows={3}
            className="w-full bg-[#0c0c12] border border-[#2a2a3e] rounded px-3 py-2 font-mono text-sm text-[#f0f0f5] placeholder:text-[#707080] focus:border-[#00ff9f] focus:outline-none"
          />
        </div>
        
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="contactEmail" className="block text-[10px] text-[#707080] mb-1 font-mono uppercase tracking-wider">
              Contact Email *
            </label>
            <input
              id="contactEmail"
              type="email"
              value={formData.contactEmail}
              onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
              required
              placeholder="contact@provider.com"
              className="w-full"
            />
          </div>
          
          <div>
            <label htmlFor="website" className="block text-[10px] text-[#707080] mb-1 font-mono uppercase tracking-wider">
              Website (optional)
            </label>
            <input
              id="website"
              type="url"
              value={formData.website}
              onChange={(e) => setFormData({ ...formData, website: e.target.value })}
              placeholder="https://myprovider.com"
              className="w-full"
            />
          </div>
        </div>
        
        {/* Premium Placement Option */}
        <div className="p-4 bg-gradient-to-r from-[#ffff00]/5 to-[#ff9900]/5 border border-[#ffff00]/20 rounded">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.wantsPremium}
              onChange={(e) => setFormData({ ...formData, wantsPremium: e.target.checked })}
              className="mt-1 w-4 h-4 accent-[#ffff00]"
            />
            <div>
              <div className="font-mono text-sm text-[#ffff00]">⭐ Featured Placement</div>
              <div className="text-xs text-[#a0a0b0] mt-1">
                Get priority positioning and highlighted listing in the marketplace. 
                We&apos;ll contact you to discuss terms after approval.
              </div>
            </div>
          </label>
        </div>
        
        <button
          type="submit"
          disabled={submitting}
          className="w-full btn-primary py-3 font-mono text-sm"
        >
          {submitting ? 'TESTING_CONNECTION...' : 'SUBMIT_FOR_REVIEW'}
        </button>
        
        <p className="text-[10px] text-[#707080] font-mono text-center">
          // your provider will be tested automatically before submission
        </p>
      </form>
    </div>
  );
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function DirectoryPage() {
  const [activeTab, setActiveTab] = useState<'marketplace' | 'submit'>('marketplace');

  return (
    <div className="min-h-screen bg-[#0c0c12] text-[#f0f0f5] bg-grid noise">
      {/* Header */}
      <header className="border-b border-[#2a2a3e] sticky top-0 bg-[#0c0c12]/95 backdrop-blur-sm z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="terminal-dots hidden sm:flex">
              <div className="terminal-dot red"></div>
              <div className="terminal-dot yellow"></div>
              <div className="terminal-dot green"></div>
            </div>
            <a href="/" className="flex items-center gap-2">
              <span className="text-xl font-bold font-mono gradient-text tracking-wider">
                DRAIN
              </span>
              <span className="text-[10px] text-[#707080] hidden sm:inline font-mono uppercase tracking-widest">
                // marketplace
              </span>
            </a>
          </div>
          
          <a href="/" className="btn-secondary font-mono text-xs">
            TRY_NOW
          </a>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Hero */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold font-mono gradient-text mb-2">
            AI_PROVIDERS
          </h1>
          <p className="text-[#707080] font-mono text-sm">
            // discover DRAIN-compatible AI providers with micropayments
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-8 justify-center">
          {[
            { id: 'marketplace', label: 'BROWSE', icon: '🔍' },
            { id: 'submit', label: 'LIST_YOUR_API', icon: '➕' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as 'marketplace' | 'submit')}
              className={`px-4 py-2 rounded font-mono text-xs transition ${
                activeTab === tab.id
                  ? 'bg-[#00ff9f]/10 text-[#00ff9f] border border-[#00ff9f]/30'
                  : 'bg-[#111118] text-[#a0a0b0] border border-[#2a2a3e] hover:border-[#00ff9f]/30'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {activeTab === 'marketplace' && <MarketplaceView />}
        {activeTab === 'submit' && <SubmitForm />}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#2a2a3e] py-4 mt-auto bg-[#0c0c12]">
        <div className="max-w-6xl mx-auto px-4 text-center font-mono text-xs text-[#707080]">
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <a href="/" className="hover:text-[#00ff9f] transition">try_drain</a>
            <span className="text-[#2a2a3e]">|</span>
            <a href="/api/directory/providers" className="hover:text-[#00ff9f] transition">api</a>
            <span className="text-[#2a2a3e]">|</span>
            <a href="https://github.com/kimbo128/DRAIN" className="hover:text-[#00ff9f] transition">github</a>
          </div>
          <div className="mt-2 text-[10px]">DRAIN © 2026</div>
        </div>
      </footer>
    </div>
  );
}
