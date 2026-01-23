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
  wantsPremium?: boolean;
  isOnline: boolean;
  lastCheckedAt?: number;
  avgResponseTime?: number;
  models: ProviderModel[];
  chainId?: number;
}

export default function AdminPage() {
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
        localStorage.setItem('drain-admin-auth', password);
        await fetchProviders();
      } else {
        alert('Invalid password');
      }
    } catch {
      alert('Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  async function fetchProviders() {
    setLoading(true);
    const savedPassword = localStorage.getItem('drain-admin-auth') || password;
    try {
      const res = await fetch(`/api/directory/admin?filter=${filter}`, {
        headers: { 'x-admin-password': savedPassword },
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
    const savedPassword = localStorage.getItem('drain-admin-auth') || password;
    
    try {
      const res = await fetch('/api/directory/admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': savedPassword,
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

  // Check for saved auth on mount
  useEffect(() => {
    const savedPassword = localStorage.getItem('drain-admin-auth');
    if (savedPassword) {
      setPassword(savedPassword);
      setAuthenticated(true);
    }
  }, []);

  useEffect(() => {
    if (authenticated) {
      fetchProviders();
    }
  }, [filter, authenticated]);

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-[#0c0c12] text-[#f0f0f5] flex items-center justify-center">
        <div className="terminal-card w-full max-w-md">
          <div className="terminal-header">
            <div className="terminal-dots">
              <div className="terminal-dot red"></div>
              <div className="terminal-dot yellow"></div>
              <div className="terminal-dot green"></div>
            </div>
            <span className="font-mono text-xs text-[#707080]">admin.auth()</span>
          </div>
          
          <div className="p-6">
            <div className="font-mono text-xs text-[#ff4444] mb-4">// restricted access</div>
            
            <div className="flex gap-2">
              <label htmlFor="admin-password" className="sr-only">Admin Password</label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && authenticate()}
                placeholder="password"
                className="flex-1 bg-[#0c0c12] border border-[#2a2a3e] rounded px-3 py-2 font-mono text-sm outline-none focus:border-[#00ff9f]"
              />
              <button
                onClick={authenticate}
                disabled={loading}
                className="btn-primary px-4 font-mono text-xs"
              >
                {loading ? '...' : 'AUTH'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
            <span className="text-xl font-bold font-mono text-[#ff4444]">
              DRAIN_OPS
            </span>
          </div>
          
          <button
            onClick={() => {
              localStorage.removeItem('drain-admin-auth');
              setAuthenticated(false);
              setPassword('');
            }}
            className="px-3 py-1.5 bg-[#ff4444]/10 border border-[#ff4444]/30 rounded text-xs font-mono text-[#ff4444] hover:bg-[#ff4444]/20 transition"
          >
            LOGOUT
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'total', value: counts.total, color: '#f0f0f5' },
            { label: 'pending', value: counts.pending, color: '#ffff00' },
            { label: 'approved', value: counts.approved, color: '#00ff9f' },
            { label: 'rejected', value: counts.rejected, color: '#ff4444' },
          ].map((stat) => (
            <div key={stat.label} className="terminal-card">
              <div className="p-4 text-center">
                <div className="text-3xl font-bold font-mono" style={{ color: stat.color }}>
                  {stat.value}
                </div>
                <div className="text-[10px] text-[#707080] font-mono uppercase tracking-wider">
                  {stat.label}
                </div>
              </div>
            </div>
          ))}
        </div>
        
        {/* Filter & Actions */}
        <div className="flex gap-2 mb-6 flex-wrap">
          <button
            onClick={() => setFilter('pending')}
            className={`px-4 py-2 rounded font-mono text-xs transition ${
              filter === 'pending'
                ? 'bg-[#ffff00]/10 text-[#ffff00] border border-[#ffff00]/30'
                : 'bg-[#111118] text-[#a0a0b0] border border-[#2a2a3e]'
            }`}
          >
            PENDING ({counts.pending})
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded font-mono text-xs transition ${
              filter === 'all'
                ? 'bg-[#00ccff]/10 text-[#00ccff] border border-[#00ccff]/30'
                : 'bg-[#111118] text-[#a0a0b0] border border-[#2a2a3e]'
            }`}
          >
            ALL ({counts.total})
          </button>
          <button
            onClick={() => performAction('health-check-all', '')}
            disabled={loading}
            className="ml-auto px-4 py-2 bg-[#111118] text-[#a0a0b0] border border-[#2a2a3e] rounded font-mono text-xs hover:text-[#00ff9f] hover:border-[#00ff9f]/30 transition"
          >
            🔄 HEALTH_CHECK_ALL
          </button>
        </div>
        
        {/* Provider List */}
        <div className="space-y-4">
          {providers.length === 0 ? (
            <div className="text-center py-12 font-mono text-[#707080]">
              // no {filter === 'pending' ? 'pending' : ''} providers
            </div>
          ) : (
            providers.map((provider) => (
              <div key={provider.id} className={`terminal-card ${provider.isPremium ? 'border-[#ffff00]/50' : ''}`}>
                <div className="terminal-header justify-between">
                  <div className="flex items-center gap-3">
                    <div className="terminal-dots">
                      <div className="terminal-dot red"></div>
                      <div className="terminal-dot yellow"></div>
                      <div className="terminal-dot green"></div>
                    </div>
                    <span className="font-mono text-xs text-[#707080]">{provider.id}</span>
                    {provider.isPremium && (
                      <span className="px-2 py-0.5 bg-[#ffff00]/20 text-[#ffff00] border border-[#ffff00]/30 rounded text-[10px] font-mono">
                        ⭐ PREMIUM
                      </span>
                    )}
                    {provider.wantsPremium && !provider.isPremium && (
                      <span className="px-2 py-0.5 bg-[#ff00ff]/10 text-[#ff00ff] border border-[#ff00ff]/30 rounded text-[10px] font-mono">
                        WANTS_PREMIUM
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`status-dot ${provider.isOnline ? 'online' : 'offline'}`}></span>
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
                </div>
                
                <div className="p-4">
                  <h3 className="font-bold text-[#f0f0f5] text-lg mb-2">{provider.name}</h3>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono mb-4">
                    <div>
                      <div className="text-[#707080]">api_url</div>
                      <div className="text-[#00ccff] truncate" title={provider.apiUrl}>{provider.apiUrl}</div>
                    </div>
                    <div>
                      <div className="text-[#707080]">address</div>
                      <div className="text-[#f0f0f5]">{provider.providerAddress.slice(0, 14)}...</div>
                    </div>
                    <div>
                      <div className="text-[#707080]">email</div>
                      <div className="text-[#f0f0f5]">{provider.contactEmail}</div>
                    </div>
                    <div>
                      <div className="text-[#707080]">submitted</div>
                      <div className="text-[#f0f0f5]">{new Date(provider.submittedAt).toLocaleDateString()}</div>
                    </div>
                  </div>
                  
                  <p className="text-sm text-[#a0a0b0] mb-4">{provider.description}</p>
                  
                  {/* Models */}
                  {provider.models.length > 0 && (
                    <div className="mb-4">
                      <div className="text-[10px] text-[#707080] mb-2 font-mono">// models</div>
                      <div className="flex flex-wrap gap-2">
                        {provider.models.map((m) => (
                          <span key={m.id} className="px-2 py-1 bg-[#111118] border border-[#2a2a3e] rounded text-xs font-mono text-[#00ccff]">
                            {m.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  
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
                      className="px-3 py-1.5 bg-[#111118] border border-[#2a2a3e] rounded text-xs font-mono text-[#a0a0b0] hover:text-[#00ccff] hover:border-[#00ccff]/30 transition"
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
                    
                    {provider.status === 'approved' && (
                      <button
                        onClick={() => performAction('toggle-premium', provider.id)}
                        disabled={loading}
                        className={`px-3 py-1.5 rounded text-xs font-mono transition ${
                          provider.isPremium
                            ? 'bg-[#ffff00]/20 border border-[#ffff00]/50 text-[#ffff00] hover:bg-[#ffff00]/30'
                            : 'bg-[#111118] border border-[#2a2a3e] text-[#a0a0b0] hover:text-[#ffff00] hover:border-[#ffff00]/30'
                        }`}
                      >
                        {provider.isPremium ? '⭐ REMOVE_PREMIUM' : '⭐ MAKE_PREMIUM'}
                      </button>
                    )}
                    
                    <button
                      onClick={() => {
                        if (confirm('Delete this provider permanently?')) {
                          performAction('delete', provider.id);
                        }
                      }}
                      disabled={loading}
                      className="px-3 py-1.5 bg-[#111118] border border-[#2a2a3e] rounded text-xs font-mono text-[#707080] hover:text-[#ff4444] hover:border-[#ff4444]/30 transition ml-auto"
                    >
                      🗑️ DELETE
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
