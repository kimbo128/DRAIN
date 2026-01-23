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
      <div className="text-center py-12 font-mono text-[#555566]">
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
        <div className="font-mono text-[#555566] mb-4">// no providers found</div>
        <p className="text-sm text-[#888899]">Be the first to register your DRAIN provider!</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {providers.map((provider) => (
        <div key={provider.id} className="terminal-card">
          <div className="terminal-header">
            <div className="flex items-center gap-3">
              <div className="terminal-dots">
                <div className="terminal-dot red"></div>
                <div className="terminal-dot yellow"></div>
                <div className="terminal-dot green"></div>
              </div>
              <span className="font-mono text-xs text-[#555566]">{provider.id}</span>
            </div>
            <span className={`status-dot ${provider.isOnline ? 'online' : 'offline'}`}></span>
          </div>
          
          <div className="p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-bold text-[#e0e0e0] text-lg">{provider.name}</h3>
                <p className="text-xs text-[#555566] font-mono mt-1">
                  {provider.providerAddress.slice(0, 10)}...{provider.providerAddress.slice(-8)}
                </p>
              </div>
              {provider.isOnline && (
                <span className="px-2 py-0.5 bg-[#00ff9f]/10 text-[#00ff9f] border border-[#00ff9f]/30 rounded text-[10px] font-mono">
                  ONLINE
                </span>
              )}
            </div>
            
            <p className="text-sm text-[#888899] mb-4 line-clamp-2">{provider.description}</p>
            
            {/* Models */}
            <div className="mb-4">
              <div className="text-[10px] text-[#555566] mb-2 font-mono uppercase tracking-wider">// models</div>
              <div className="flex flex-wrap gap-2">
                {provider.models.map((model) => (
                  <span 
                    key={model.id}
                    className="px-2 py-1 bg-[#0d0d14] border border-[#1e1e2e] rounded text-xs font-mono text-[#00ccff]"
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
          message: 'Provider submitted for review! We\'ll notify you once approved.',
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
        <span className="font-mono text-xs text-[#555566]">provider.register()</span>
      </div>
      
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div className="font-mono text-xs text-[#555566] mb-4">
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
            <label htmlFor="name" className="block text-[10px] text-[#555566] mb-1 font-mono uppercase tracking-wider">
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
            <label htmlFor="apiUrl" className="block text-[10px] text-[#555566] mb-1 font-mono uppercase tracking-wider">
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
          <label htmlFor="providerAddress" className="block text-[10px] text-[#555566] mb-1 font-mono uppercase tracking-wider">
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
          <label htmlFor="description" className="block text-[10px] text-[#555566] mb-1 font-mono uppercase tracking-wider">
            Description *
          </label>
          <textarea
            id="description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            required
            placeholder="Describe your provider, supported models, features..."
            rows={3}
            className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded px-3 py-2 font-mono text-sm text-[#e0e0e0] placeholder:text-[#555566] focus:border-[#00ff9f] focus:outline-none"
          />
        </div>
        
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="contactEmail" className="block text-[10px] text-[#555566] mb-1 font-mono uppercase tracking-wider">
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
            <label htmlFor="website" className="block text-[10px] text-[#555566] mb-1 font-mono uppercase tracking-wider">
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
        
        <button
          type="submit"
          disabled={submitting}
          className="w-full btn-primary py-3 font-mono text-sm"
        >
          {submitting ? 'TESTING_CONNECTION...' : 'SUBMIT_FOR_REVIEW'}
        </button>
        
        <p className="text-[10px] text-[#555566] font-mono text-center">
          // your provider will be tested automatically before submission
        </p>
      </form>
    </div>
  );
}

// ============================================================================
// ADMIN INTERFACE
// ============================================================================

function AdminInterface() {
  const [password, setPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [counts, setCounts] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 });
  const [loading, setLoading] = useState(false);
  const [actionResult, setActionResult] = useState<{ id: string; success: boolean; message: string } | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending'>('pending');

  async function authenticate() {
    setLoading(true);
    try {
      const res = await fetch('/api/directory/admin', {
        headers: { 'x-admin-password': password },
      });
      
      if (res.ok) {
        setAuthenticated(true);
        await fetchProviders();
      } else {
        alert('Invalid password');
      }
    } catch (err) {
      alert('Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  async function fetchProviders() {
    setLoading(true);
    try {
      const res = await fetch(`/api/directory/admin?filter=${filter}`, {
        headers: { 'x-admin-password': password },
      });
      const data = await res.json();
      if (data.success) {
        setProviders(data.providers);
        setCounts(data.counts);
      }
    } finally {
      setLoading(false);
    }
  }

  async function performAction(action: string, providerId: string, reason?: string) {
    setLoading(true);
    setActionResult(null);
    
    try {
      const res = await fetch('/api/directory/admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': password,
        },
        body: JSON.stringify({ action, providerId, reason }),
      });
      
      const data = await res.json();
      setActionResult({
        id: providerId,
        success: data.success,
        message: data.message || data.error,
      });
      
      if (data.success) {
        await fetchProviders();
      }
    } catch (err: any) {
      setActionResult({
        id: providerId,
        success: false,
        message: err.message,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authenticated) {
      fetchProviders();
    }
  }, [filter, authenticated]);

  if (!authenticated) {
    return (
      <div className="terminal-card max-w-md mx-auto">
        <div className="terminal-header">
          <div className="terminal-dots">
            <div className="terminal-dot red"></div>
            <div className="terminal-dot yellow"></div>
            <div className="terminal-dot green"></div>
          </div>
          <span className="font-mono text-xs text-[#555566]">admin.login()</span>
        </div>
        
        <div className="p-6">
          <div className="font-mono text-xs text-[#555566] mb-4">// admin authentication required</div>
          
          <div className="flex gap-2">
            <label htmlFor="admin-password" className="sr-only">Admin Password</label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && authenticate()}
              placeholder="enter_password"
              className="flex-1 font-mono"
            />
            <button
              onClick={authenticate}
              disabled={loading}
              className="btn-primary px-4 font-mono text-xs"
            >
              {loading ? '...' : 'LOGIN'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'total', value: counts.total, color: '#e0e0e0' },
          { label: 'pending', value: counts.pending, color: '#ffff00' },
          { label: 'approved', value: counts.approved, color: '#00ff9f' },
          { label: 'rejected', value: counts.rejected, color: '#ff4444' },
        ].map((stat) => (
          <div key={stat.label} className="terminal-card">
            <div className="p-4 text-center">
              <div className="text-2xl font-bold font-mono" style={{ color: stat.color }}>
                {stat.value}
              </div>
              <div className="text-[10px] text-[#555566] font-mono uppercase tracking-wider">
                {stat.label}
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {/* Filter */}
      <div className="flex gap-2">
        <button
          onClick={() => setFilter('pending')}
          className={`px-4 py-2 rounded font-mono text-xs transition ${
            filter === 'pending'
              ? 'bg-[#ffff00]/10 text-[#ffff00] border border-[#ffff00]/30'
              : 'bg-[#0d0d14] text-[#888899] border border-[#1e1e2e]'
          }`}
        >
          PENDING ({counts.pending})
        </button>
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-2 rounded font-mono text-xs transition ${
            filter === 'all'
              ? 'bg-[#00ccff]/10 text-[#00ccff] border border-[#00ccff]/30'
              : 'bg-[#0d0d14] text-[#888899] border border-[#1e1e2e]'
          }`}
        >
          ALL ({counts.total})
        </button>
        <button
          onClick={() => performAction('health-check-all', '')}
          disabled={loading}
          className="ml-auto px-4 py-2 bg-[#0d0d14] text-[#888899] border border-[#1e1e2e] rounded font-mono text-xs hover:text-[#00ff9f] hover:border-[#00ff9f]/30 transition"
        >
          RUN_HEALTH_CHECK
        </button>
      </div>
      
      {/* Provider List */}
      <div className="space-y-4">
        {providers.length === 0 ? (
          <div className="text-center py-12 font-mono text-[#555566]">
            // no {filter === 'pending' ? 'pending' : ''} providers found
          </div>
        ) : (
          providers.map((provider) => (
            <div key={provider.id} className="terminal-card">
              <div className="terminal-header justify-between">
                <div className="flex items-center gap-3">
                  <div className="terminal-dots">
                    <div className="terminal-dot red"></div>
                    <div className="terminal-dot yellow"></div>
                    <div className="terminal-dot green"></div>
                  </div>
                  <span className="font-mono text-xs text-[#555566]">{provider.id}</span>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                  provider.status === 'approved' 
                    ? 'bg-[#00ff9f]/10 text-[#00ff9f] border-[#00ff9f]/30'
                    : provider.status === 'pending'
                    ? 'bg-[#ffff00]/10 text-[#ffff00] border-[#ffff00]/30'
                    : 'bg-[#ff4444]/10 text-[#ff4444] border-[#ff4444]/30'
                }`}>
                  {provider.status.toUpperCase()}
                </span>
              </div>
              
              <div className="p-4">
                <h3 className="font-bold text-[#e0e0e0] text-lg mb-2">{provider.name}</h3>
                
                <div className="grid grid-cols-2 gap-4 text-xs font-mono mb-4">
                  <div>
                    <div className="text-[#555566]">api_url</div>
                    <div className="text-[#00ccff] truncate">{provider.apiUrl}</div>
                  </div>
                  <div>
                    <div className="text-[#555566]">address</div>
                    <div className="text-[#e0e0e0]">{provider.providerAddress.slice(0, 14)}...</div>
                  </div>
                  <div>
                    <div className="text-[#555566]">email</div>
                    <div className="text-[#e0e0e0]">{provider.contactEmail}</div>
                  </div>
                  <div>
                    <div className="text-[#555566]">submitted</div>
                    <div className="text-[#e0e0e0]">{new Date(provider.submittedAt).toLocaleDateString()}</div>
                  </div>
                </div>
                
                <p className="text-sm text-[#888899] mb-4">{provider.description}</p>
                
                {actionResult?.id === provider.id && (
                  <div className={`mb-4 p-3 rounded font-mono text-xs ${
                    actionResult.success
                      ? 'bg-[#00ff9f]/10 text-[#00ff9f] border border-[#00ff9f]/30'
                      : 'bg-[#ff4444]/10 text-[#ff4444] border border-[#ff4444]/30'
                  }`}>
                    {actionResult.message}
                  </div>
                )}
                
                {/* Actions */}
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => performAction('test', provider.id)}
                    disabled={loading}
                    className="px-3 py-1.5 bg-[#0d0d14] border border-[#1e1e2e] rounded text-xs font-mono text-[#888899] hover:text-[#00ccff] hover:border-[#00ccff]/30 transition"
                  >
                    🔄 TEST
                  </button>
                  
                  {provider.status === 'pending' && (
                    <>
                      <button
                        onClick={() => performAction('approve', provider.id)}
                        disabled={loading}
                        className="px-3 py-1.5 bg-[#00ff9f]/10 border border-[#00ff9f]/30 rounded text-xs font-mono text-[#00ff9f] hover:bg-[#00ff9f]/20 transition"
                      >
                        ✓ APPROVE
                      </button>
                      <button
                        onClick={() => {
                          const reason = prompt('Rejection reason:');
                          if (reason) performAction('reject', provider.id, reason);
                        }}
                        disabled={loading}
                        className="px-3 py-1.5 bg-[#ff4444]/10 border border-[#ff4444]/30 rounded text-xs font-mono text-[#ff4444] hover:bg-[#ff4444]/20 transition"
                      >
                        ✗ REJECT
                      </button>
                    </>
                  )}
                  
                  <button
                    onClick={() => {
                      if (confirm('Delete this provider?')) performAction('delete', provider.id);
                    }}
                    disabled={loading}
                    className="px-3 py-1.5 bg-[#0d0d14] border border-[#1e1e2e] rounded text-xs font-mono text-[#555566] hover:text-[#ff4444] hover:border-[#ff4444]/30 transition ml-auto"
                  >
                    DELETE
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function DirectoryPage() {
  const [activeTab, setActiveTab] = useState<'marketplace' | 'submit' | 'admin'>('marketplace');

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#e0e0e0] bg-grid noise">
      {/* Header */}
      <header className="border-b border-[#1e1e2e] sticky top-0 bg-[#0a0a0f]/95 backdrop-blur-sm z-50">
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
              <span className="text-[10px] text-[#555566] hidden sm:inline font-mono uppercase tracking-widest">
                // directory
              </span>
            </a>
          </div>
          
          <a href="/" className="btn-secondary font-mono text-xs">
            DEMO
          </a>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Hero */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold font-mono gradient-text mb-2">
            PROVIDER_DIRECTORY
          </h1>
          <p className="text-[#555566] font-mono text-sm">
            // discover and register DRAIN-compatible AI providers
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-8 justify-center">
          {[
            { id: 'marketplace', label: 'MARKETPLACE', icon: '🏪' },
            { id: 'submit', label: 'REGISTER', icon: '📝' },
            { id: 'admin', label: 'ADMIN', icon: '🔐' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2 rounded font-mono text-xs transition ${
                activeTab === tab.id
                  ? 'bg-[#00ff9f]/10 text-[#00ff9f] border border-[#00ff9f]/30'
                  : 'bg-[#0d0d14] text-[#888899] border border-[#1e1e2e] hover:border-[#00ff9f]/30'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {activeTab === 'marketplace' && <MarketplaceView />}
        {activeTab === 'submit' && <SubmitForm />}
        {activeTab === 'admin' && <AdminInterface />}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#1e1e2e] py-4 mt-auto bg-[#0a0a0f]">
        <div className="max-w-6xl mx-auto px-4 text-center font-mono text-xs text-[#555566]">
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <a href="/" className="hover:text-[#00ff9f] transition">demo</a>
            <span className="text-[#1e1e2e]">|</span>
            <a href="https://github.com/kimbo128/DRAIN" className="hover:text-[#00ff9f] transition">github</a>
            <span className="text-[#1e1e2e]">|</span>
            <a href="/api/directory/providers" className="hover:text-[#00ff9f] transition">api</a>
          </div>
          <div className="mt-2 text-[10px]">// DRAIN directory v1.0</div>
        </div>
      </footer>
    </div>
  );
}
