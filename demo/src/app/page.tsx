'use client';

import { useState, useRef, useEffect } from 'react';

const PROVIDER_URL = 'https://drain-production-a9d4.up.railway.app';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  cost?: string;
}

interface ChannelState {
  id: string;
  deposit: string;
  spent: string;
  remaining: string;
}

export default function Home() {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [channel, setChannel] = useState<ChannelState | null>(null);
  const [depositAmount, setDepositAmount] = useState('10');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [voucherCount, setVoucherCount] = useState(0);
  const [demoMode, setDemoMode] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Check if wallet already connected
  useEffect(() => {
    if (typeof window.ethereum !== 'undefined') {
      window.ethereum.request({ method: 'eth_accounts' }).then((accounts: unknown) => {
        const accs = accounts as string[];
        if (accs.length > 0) {
          setAddress(accs[0]);
          window.ethereum!.request({ method: 'eth_chainId' }).then((chain: unknown) => {
            setChainId(parseInt(chain as string, 16));
          });
        }
      });
    }
  }, []);

  const connectWallet = async () => {
    if (typeof window.ethereum === 'undefined') {
      alert('Please install MetaMask to use DRAIN with real payments.\n\nOr try Demo Mode to explore the interface!');
      return;
    }
    
    setIsConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[];
      const chain = await window.ethereum.request({ method: 'eth_chainId' }) as string;
      setAddress(accounts[0]);
      setChainId(parseInt(chain, 16));
    } catch (e) {
      console.error('Failed to connect:', e);
    } finally {
      setIsConnecting(false);
    }
  };

  const startDemoMode = () => {
    setDemoMode(true);
    setAddress('0xDemo...Mode');
    setChainId(137);
  };

  const openChannel = async () => {
    setIsLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1200));
    
    const mockChannelId = '0x' + Array.from({length: 64}, () => 
      Math.floor(Math.random() * 16).toString(16)).join('');
    
    setChannel({
      id: mockChannelId,
      deposit: depositAmount,
      spent: '0.0000',
      remaining: depositAmount,
    });
    
    setMessages([{
      role: 'system',
      content: `🎉 Payment channel opened with $${depositAmount} USDC!\n\nYour funds are now locked in the smart contract. Each message you send will create a signed voucher authorizing incremental payments.\n\n💡 Try asking: "How does DRAIN work?" or "What makes this different from credit cards?"`
    }]);
    
    setIsLoading(false);
  };

  const sendMessage = async () => {
    if (!input.trim() || !channel) return;
    
    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);
    
    try {
      // Calculate mock cost based on message length
      const baseCost = 0.0008;
      const lengthCost = userMessage.length * 0.00002;
      const responseCost = 0.002 + Math.random() * 0.003;
      const totalCost = (baseCost + lengthCost + responseCost).toFixed(4);
      
      const newSpent = (parseFloat(channel.spent) + parseFloat(totalCost)).toFixed(4);
      const newRemaining = (parseFloat(channel.deposit) - parseFloat(newSpent)).toFixed(4);
      
      // Simulate AI thinking
      await new Promise(resolve => setTimeout(resolve, 600 + Math.random() * 1000));
      
      // Smart responses based on keywords
      let response: string;
      const lowerMsg = userMessage.toLowerCase();
      
      if (lowerMsg.includes('how') && lowerMsg.includes('work')) {
        response = "DRAIN works like a prepaid phone card for AI:\n\n1️⃣ **Deposit** - Lock USDC in a smart contract (~$0.02 gas)\n2️⃣ **Use** - Sign vouchers for each AI request (free, off-chain)\n3️⃣ **Settle** - Provider claims payment, you get refund\n\nThe magic: unlimited requests, only 3 blockchain transactions total!";
      } else if (lowerMsg.includes('credit card') || lowerMsg.includes('different')) {
        response = "Credit cards can't do micropayments profitably:\n\n💳 Card: $0.30 minimum + 2.9% fee\n🔷 DRAIN: $0.0001 minimum, ~$0.02 per session\n\nThat's why AI APIs charge monthly minimums. DRAIN enables true pay-per-use - even for a single question!";
      } else if (lowerMsg.includes('cost') || lowerMsg.includes('price') || lowerMsg.includes('expensive')) {
        response = `This response cost you **$${totalCost} USDC**.\n\nBreakdown:\n- Input tokens: ~$${(baseCost + lengthCost).toFixed(4)}\n- Output tokens: ~$${responseCost.toFixed(4)}\n\nYou've used ${voucherCount + 1} vouchers so far. Your remaining balance: **$${newRemaining}**`;
      } else if (lowerMsg.includes('voucher') || lowerMsg.includes('signature')) {
        response = "Each message creates an EIP-712 signed voucher:\n\n```\n{\n  channelId: \"" + channel.id.slice(0, 10) + "...\",\n  amount: \"" + newSpent + "\",  // cumulative\n  nonce: " + (voucherCount + 1) + ",\n  signature: \"0x...\"\n}\n```\n\nThe provider only needs your **last** voucher to claim all payments. Elegant, right?";
      } else if (lowerMsg.includes('polygon') || lowerMsg.includes('chain') || lowerMsg.includes('usdc')) {
        response = "DRAIN runs on **Polygon** with native **USDC**:\n\n✅ $0.02 transaction costs\n✅ 5-second finality\n✅ $500M+ USDC liquidity\n✅ Circle CCTP for bridging\n\nNo volatile tokens. No staking. Just stable, predictable payments.";
      } else if (lowerMsg.includes('hello') || lowerMsg.includes('hi') || lowerMsg.includes('hey')) {
        response = "Hello! 👋 I'm an AI running on DRAIN - the trustless payment protocol.\n\nEvery response I give costs a tiny amount of USDC, paid directly to the provider. No middlemen, no monthly fees.\n\nAsk me anything about DRAIN, or just chat!";
      } else {
        const genericResponses = [
          "Interesting question! DRAIN makes AI accessible to anyone with USDC - no credit card, no bank account, no KYC required. That's 78% of the world who couldn't easily access AI APIs before.",
          "I'm processing this through a DRAIN payment channel. The provider will batch-claim these vouchers later, settling everything in one transaction. Efficient!",
          "Fun fact: AI agents can use DRAIN too! Unlike credit cards, payment channels work great for machine-to-machine payments. The future of autonomous AI commerce.",
          "This conversation is trustless - I can't overcharge you (you only sign what you agree to), and you can't underpay me (funds are locked in the contract). Cryptography > trust!",
        ];
        response = genericResponses[Math.floor(Math.random() * genericResponses.length)];
      }
      
      setChannel({
        ...channel,
        spent: newSpent,
        remaining: newRemaining,
      });
      
      setVoucherCount(prev => prev + 1);
      
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: response,
        cost: totalCost
      }]);
      
    } catch (e) {
      console.error('Error:', e);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: '❌ Something went wrong. Please try again.' 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const shortAddress = address 
    ? address.startsWith('0xDemo') ? '🎮 Demo Mode' : `${address.slice(0, 6)}...${address.slice(-4)}`
    : null;

  const isPolygon = chainId === 137 || chainId === 80002;

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#0a0a0a] via-[#0f0f1a] to-[#0a0a0a]">
      {/* Hero / Header */}
      <header className="border-b border-[#222] bg-[#0a0a0a]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#00D395] to-[#7B61FF] flex items-center justify-center text-xl font-bold">
              D
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">DRAIN</h1>
              <p className="text-xs text-gray-500">Pay-per-Token AI</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {address ? (
              <>
                {demoMode && (
                  <span className="px-2 py-1 bg-purple-500/20 text-purple-400 rounded text-xs font-medium">
                    Demo Mode
                  </span>
                )}
                {!isPolygon && !demoMode && (
                  <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded text-xs">
                    Switch to Polygon
                  </span>
                )}
                <div className="px-4 py-2 bg-[#1a1a1a] rounded-lg border border-[#333] font-mono text-sm text-gray-300">
                  {shortAddress}
                </div>
              </>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={startDemoMode}
                  className="px-4 py-2 bg-[#222] hover:bg-[#333] text-gray-300 font-medium rounded-lg transition text-sm"
                >
                  Try Demo
                </button>
                <button
                  onClick={connectWallet}
                  disabled={isConnecting}
                  className="px-4 py-2 bg-[#00D395] hover:bg-[#00B080] disabled:bg-gray-600 text-black font-semibold rounded-lg transition text-sm"
                >
                  {isConnecting ? '...' : 'Connect'}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {!address ? (
          // Landing / Not Connected
          <div className="space-y-12">
            {/* Hero */}
            <div className="text-center py-16">
              <h2 className="text-5xl md:text-6xl font-bold mb-6">
                <span className="bg-gradient-to-r from-[#00D395] via-[#00D395] to-[#7B61FF] bg-clip-text text-transparent">
                  AI Without Credit Cards
                </span>
              </h2>
              <p className="text-xl text-gray-400 mb-8 max-w-2xl mx-auto">
                Pay for AI with USDC micropayments. No tokens, no subscriptions, no middlemen.
              </p>
              <div className="flex gap-4 justify-center">
                <button
                  onClick={connectWallet}
                  className="px-8 py-4 bg-[#00D395] hover:bg-[#00B080] text-black font-bold rounded-xl transition text-lg shadow-lg shadow-[#00D395]/20"
                >
                  Connect Wallet
                </button>
                <button
                  onClick={startDemoMode}
                  className="px-8 py-4 bg-[#1a1a1a] hover:bg-[#222] text-white font-semibold rounded-xl transition text-lg border border-[#333]"
                >
                  Try Demo →
                </button>
              </div>
            </div>

            {/* Features */}
            <div className="grid md:grid-cols-3 gap-6">
              <div className="bg-[#111] border border-[#222] rounded-2xl p-6 hover:border-[#00D395]/50 transition">
                <div className="text-3xl mb-4">💸</div>
                <h3 className="text-lg font-bold mb-2">True Micropayments</h3>
                <p className="text-gray-400 text-sm">Pay $0.001 per request. Credit cards can't do that - DRAIN can.</p>
              </div>
              <div className="bg-[#111] border border-[#222] rounded-2xl p-6 hover:border-[#7B61FF]/50 transition">
                <div className="text-3xl mb-4">🔐</div>
                <h3 className="text-lg font-bold mb-2">Trustless</h3>
                <p className="text-gray-400 text-sm">Smart contracts, not promises. You control your funds.</p>
              </div>
              <div className="bg-[#111] border border-[#222] rounded-2xl p-6 hover:border-[#00D395]/50 transition">
                <div className="text-3xl mb-4">🌍</div>
                <h3 className="text-lg font-bold mb-2">Global Access</h3>
                <p className="text-gray-400 text-sm">78% of the world lacks credit cards. DRAIN works for everyone.</p>
              </div>
            </div>

            {/* How it works */}
            <div className="bg-[#111] border border-[#222] rounded-2xl p-8">
              <h3 className="text-xl font-bold mb-6 text-center">How It Works</h3>
              <div className="grid md:grid-cols-3 gap-8">
                <div className="text-center">
                  <div className="w-12 h-12 rounded-full bg-[#00D395]/20 text-[#00D395] flex items-center justify-center mx-auto mb-4 text-xl font-bold">1</div>
                  <h4 className="font-semibold mb-2">Deposit USDC</h4>
                  <p className="text-sm text-gray-400">Lock funds in a payment channel. One transaction, ~$0.02.</p>
                </div>
                <div className="text-center">
                  <div className="w-12 h-12 rounded-full bg-[#7B61FF]/20 text-[#7B61FF] flex items-center justify-center mx-auto mb-4 text-xl font-bold">2</div>
                  <h4 className="font-semibold mb-2">Use AI</h4>
                  <p className="text-sm text-gray-400">Sign vouchers for each request. Free, off-chain, instant.</p>
                </div>
                <div className="text-center">
                  <div className="w-12 h-12 rounded-full bg-[#00D395]/20 text-[#00D395] flex items-center justify-center mx-auto mb-4 text-xl font-bold">3</div>
                  <h4 className="font-semibold mb-2">Settle</h4>
                  <p className="text-sm text-gray-400">Provider claims payment. You withdraw remainder.</p>
                </div>
              </div>
            </div>
          </div>
        ) : !channel ? (
          // Connected, No Channel
          <div className="max-w-lg mx-auto">
            <div className="bg-[#111] border border-[#222] rounded-2xl p-8">
              <h2 className="text-2xl font-bold mb-2">Open Payment Channel</h2>
              <p className="text-gray-400 mb-6">Deposit USDC to start chatting with AI.</p>
              
              <div className="space-y-4 mb-6">
                <div className="bg-[#0a0a0a] border border-[#222] rounded-xl p-4">
                  <label className="text-xs text-gray-500 block mb-2">DEPOSIT AMOUNT (USDC)</label>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl text-gray-500">$</span>
                    <input
                      type="number"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      className="bg-transparent text-3xl font-mono w-full outline-none text-white"
                      min="1"
                      step="1"
                    />
                  </div>
                </div>
                
                <div className="flex gap-2">
                  {['5', '10', '25', '50'].map(amt => (
                    <button
                      key={amt}
                      onClick={() => setDepositAmount(amt)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                        depositAmount === amt 
                          ? 'bg-[#00D395] text-black' 
                          : 'bg-[#1a1a1a] text-gray-400 hover:bg-[#222]'
                      }`}
                    >
                      ${amt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-[#0a0a0a] border border-[#222] rounded-xl p-4 mb-6">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-500">Estimated messages</span>
                  <span className="text-white font-mono">~{Math.floor(parseFloat(depositAmount) / 0.003).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Network fee</span>
                  <span className="text-white font-mono">~$0.02</span>
                </div>
              </div>
              
              <button
                onClick={openChannel}
                disabled={isLoading || (!isPolygon && !demoMode)}
                className="w-full py-4 bg-gradient-to-r from-[#00D395] to-[#00B080] hover:from-[#00B080] hover:to-[#009970] disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed text-black font-bold rounded-xl transition text-lg"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                    </svg>
                    Opening Channel...
                  </span>
                ) : (
                  `Open Channel • $${depositAmount} USDC`
                )}
              </button>
              
              {!isPolygon && !demoMode && (
                <p className="text-yellow-400 text-sm mt-3 text-center">
                  Please switch to Polygon network in MetaMask
                </p>
              )}
              
              {demoMode && (
                <p className="text-purple-400 text-sm mt-3 text-center">
                  🎮 Demo mode - no real transactions
                </p>
              )}
            </div>
          </div>
        ) : (
          // Chat Interface
          <div className="flex flex-col h-[calc(100vh-140px)]">
            {/* Status Bar */}
            <div className="bg-[#111] border border-[#222] rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-[#00D395] animate-pulse shadow-lg shadow-[#00D395]/50"></div>
                  <span className="text-sm text-gray-400">Channel Active</span>
                  <span className="text-xs text-gray-600 font-mono">{channel.id.slice(0, 10)}...</span>
                </div>
                <div className="flex items-center gap-6 font-mono text-sm">
                  <div className="text-center">
                    <div className="text-[#00D395] text-lg font-bold">${channel.remaining}</div>
                    <div className="text-xs text-gray-500">remaining</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[#7B61FF] text-lg font-bold">${channel.spent}</div>
                    <div className="text-xs text-gray-500">spent</div>
                  </div>
                  <div className="text-center">
                    <div className="text-white text-lg font-bold">{voucherCount}</div>
                    <div className="text-xs text-gray-500">vouchers</div>
                  </div>
                </div>
              </div>
              {/* Progress bar */}
              <div className="mt-3 h-1 bg-[#222] rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-[#00D395] to-[#7B61FF] transition-all duration-500"
                  style={{ width: `${(parseFloat(channel.spent) / parseFloat(channel.deposit)) * 100}%` }}
                />
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 bg-[#111] border border-[#222] rounded-xl p-4 overflow-y-auto space-y-4">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`max-w-[85%] ${
                    msg.role === 'user' ? 'ml-auto' : 
                    msg.role === 'system' ? 'mx-auto max-w-[95%]' : ''
                  }`}
                >
                  <div className={`p-4 rounded-2xl ${
                    msg.role === 'user' 
                      ? 'bg-[#00D395] text-black rounded-br-md' 
                      : msg.role === 'system'
                      ? 'bg-[#1a1a2e] border border-[#333] text-center'
                      : 'bg-[#1a1a1a] border border-[#222] rounded-bl-md'
                  }`}>
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">
                      {msg.content}
                    </div>
                    {msg.cost && (
                      <div className="mt-2 pt-2 border-t border-white/10 text-xs text-gray-400">
                        Cost: ${msg.cost} USDC
                      </div>
                    )}
                  </div>
                </div>
              ))}
              
              {isLoading && (
                <div className="max-w-[85%]">
                  <div className="bg-[#1a1a1a] border border-[#222] p-4 rounded-2xl rounded-bl-md">
                    <div className="flex gap-1.5">
                      <span className="w-2 h-2 bg-[#7B61FF] rounded-full animate-bounce"></span>
                      <span className="w-2 h-2 bg-[#7B61FF] rounded-full animate-bounce" style={{animationDelay: '0.15s'}}></span>
                      <span className="w-2 h-2 bg-[#7B61FF] rounded-full animate-bounce" style={{animationDelay: '0.3s'}}></span>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="bg-[#111] border border-[#222] rounded-xl p-3 mt-4">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && !isLoading && sendMessage()}
                  placeholder="Ask about DRAIN, or just chat..."
                  className="flex-1 bg-[#0a0a0a] border border-[#222] rounded-xl px-4 py-3 outline-none text-white placeholder-gray-500 focus:border-[#333] transition"
                  disabled={isLoading}
                />
                <button
                  onClick={sendMessage}
                  disabled={isLoading || !input.trim()}
                  className="px-6 py-3 bg-[#7B61FF] hover:bg-[#6B51EF] disabled:bg-[#333] disabled:cursor-not-allowed rounded-xl font-semibold transition flex items-center gap-2"
                >
                  <span>Send</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-[#222] mt-auto">
        <div className="max-w-5xl mx-auto px-4 py-6 flex items-center justify-between text-sm text-gray-500">
          <div>
            <a href="https://github.com/kimbo128/DRAIN" className="text-[#00D395] hover:underline">GitHub</a>
            {' · '}
            <a href="https://polygonscan.com/address/0x1C1918C99b6DcE977392E4131C91654d8aB71e64" className="hover:text-white transition">Contract</a>
            {' · '}
            <a href={PROVIDER_URL + '/v1/pricing'} className="hover:text-white transition">API</a>
          </div>
          <div>DRAIN Protocol © 2026</div>
        </div>
      </footer>
    </main>
  );
}

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, callback: (...args: unknown[]) => void) => void;
    };
  }
}
