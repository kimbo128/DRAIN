'use client';

import { useState, useRef, useEffect } from 'react';

// Provider URL - DRAIN Provider on Railway
const PROVIDER_URL = 'https://drain-production-a9d4.up.railway.app';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChannelState {
  id: string;
  deposit: string;
  spent: string;
  remaining: string;
}

export default function Home() {
  // Wallet State
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  
  // Channel State
  const [channel, setChannel] = useState<ChannelState | null>(null);
  const [depositAmount, setDepositAmount] = useState('5');
  
  // Chat State
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [voucherCount, setVoucherCount] = useState(0);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Connect Wallet (MetaMask)
  const connectWallet = async () => {
    if (typeof window.ethereum === 'undefined') {
      alert('Please install MetaMask!');
      return;
    }
    
    setIsConnecting(true);
    try {
      const accounts = await window.ethereum.request({ 
        method: 'eth_requestAccounts' 
      });
      const chain = await window.ethereum.request({ 
        method: 'eth_chainId' 
      });
      
      setAddress(accounts[0]);
      setChainId(parseInt(chain, 16));
    } catch (e) {
      console.error('Failed to connect:', e);
    } finally {
      setIsConnecting(false);
    }
  };

  // Open Channel (Mock for demo - in production would call contract)
  const openChannel = async () => {
    setIsLoading(true);
    
    // Simulate channel opening
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const mockChannelId = '0x' + Math.random().toString(16).slice(2, 66).padEnd(64, '0');
    
    setChannel({
      id: mockChannelId,
      deposit: depositAmount,
      spent: '0',
      remaining: depositAmount,
    });
    
    setMessages([{
      role: 'assistant',
      content: `✅ Channel opened with $${depositAmount} USDC!\n\nYou can now chat with AI. Each message costs ~$0.001-0.01 depending on length.\n\nTry asking me anything!`
    }]);
    
    setIsLoading(false);
  };

  // Send Message
  const sendMessage = async () => {
    if (!input.trim() || !channel) return;
    
    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);
    
    try {
      // In production: sign voucher and send to provider
      // For demo: simulate response
      
      const mockCost = (Math.random() * 0.005 + 0.001).toFixed(4);
      const newSpent = (parseFloat(channel.spent) + parseFloat(mockCost)).toFixed(4);
      const newRemaining = (parseFloat(channel.deposit) - parseFloat(newSpent)).toFixed(4);
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 1200));
      
      // Mock AI responses
      const responses = [
        "I'm running on DRAIN - a trustless payment protocol for AI. Each response you see is paid for via signed vouchers, settled in USDC on Polygon. No credit card needed, no middlemen taking fees!",
        "Great question! DRAIN uses payment channels - you deposit USDC once, then sign off-chain vouchers for each request. Only 3 blockchain transactions total, regardless of how many messages you send.",
        "The beauty of DRAIN is its simplicity: USDC in, AI out. No tokens, no staking, no governance drama. Just pay-per-use AI at the lowest possible cost.",
        "I'm processing your request through a DRAIN-enabled provider. The cost was just " + mockCost + " USDC - try doing that with a credit card! Micropayments are finally possible.",
        "Behind the scenes, your wallet signed a voucher authorizing payment. The provider delivered this response. Later, they'll claim the payment on-chain. Trustless and efficient!",
      ];
      
      const response = responses[Math.floor(Math.random() * responses.length)];
      
      setChannel({
        ...channel,
        spent: newSpent,
        remaining: newRemaining,
      });
      
      setVoucherCount(prev => prev + 1);
      
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: response 
      }]);
      
    } catch (e) {
      console.error('Failed to send:', e);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: '❌ Error sending message. Please try again.' 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const shortAddress = address 
    ? `${address.slice(0, 6)}...${address.slice(-4)}` 
    : null;

  const isPolygon = chainId === 137 || chainId === 80002;

  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-[#00D395] to-[#7B61FF] bg-clip-text text-transparent">
              DRAIN
            </h1>
            <p className="text-gray-400 text-sm">Pay-per-Token AI Demo</p>
          </div>
          
          {address ? (
            <div className="flex items-center gap-3">
              {!isPolygon && (
                <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded text-xs">
                  Switch to Polygon
                </span>
              )}
              <div className="px-4 py-2 bg-[#1a1a1a] rounded-lg border border-[#333] font-mono text-sm">
                {shortAddress}
              </div>
            </div>
          ) : (
            <button
              onClick={connectWallet}
              disabled={isConnecting}
              className="px-6 py-2 bg-[#00D395] hover:bg-[#00B080] disabled:bg-gray-600 text-black font-semibold rounded-lg transition"
            >
              {isConnecting ? 'Connecting...' : 'Connect Wallet'}
            </button>
          )}
        </header>

        {/* Main Content */}
        {!address ? (
          // Not Connected
          <div className="border border-[#333] rounded-2xl p-12 text-center bg-[#111]">
            <div className="text-6xl mb-6">🔌</div>
            <h2 className="text-2xl font-bold mb-4">Connect Your Wallet</h2>
            <p className="text-gray-400 mb-8 max-w-md mx-auto">
              Connect MetaMask to open a payment channel and chat with AI using USDC micropayments.
            </p>
            <button
              onClick={connectWallet}
              className="px-8 py-3 bg-[#00D395] hover:bg-[#00B080] text-black font-semibold rounded-lg transition text-lg"
            >
              Connect MetaMask
            </button>
          </div>
        ) : !channel ? (
          // Connected, No Channel
          <div className="border border-[#333] rounded-2xl p-8 bg-[#111]">
            <h2 className="text-xl font-bold mb-6">Open Payment Channel</h2>
            
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <div className="bg-[#0a0a0a] border border-[#222] rounded-lg p-4">
                <div className="text-xs text-gray-500 mb-1">NETWORK</div>
                <div className="font-mono">
                  {chainId === 137 ? '🟢 Polygon Mainnet' : 
                   chainId === 80002 ? '🟡 Polygon Amoy (Testnet)' : 
                   '⚠️ Wrong Network'}
                </div>
              </div>
              <div className="bg-[#0a0a0a] border border-[#222] rounded-lg p-4">
                <div className="text-xs text-gray-500 mb-1">DEPOSIT (USDC)</div>
                <input
                  type="number"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="bg-transparent text-xl font-mono w-full outline-none"
                  min="1"
                  step="1"
                />
              </div>
            </div>

            <div className="bg-[#0a0a0a] border border-[#222] rounded-lg p-4 mb-6">
              <div className="text-xs text-gray-500 mb-2">HOW IT WORKS</div>
              <ol className="text-sm text-gray-300 space-y-1 list-decimal list-inside">
                <li>Deposit USDC into a payment channel (one-time on-chain tx)</li>
                <li>Chat with AI - each message signs a voucher (free, off-chain)</li>
                <li>Provider claims payment, you withdraw remainder when done</li>
              </ol>
            </div>
            
            <button
              onClick={openChannel}
              disabled={isLoading || !isPolygon}
              className="w-full py-4 bg-[#00D395] hover:bg-[#00B080] disabled:bg-gray-700 disabled:cursor-not-allowed text-black font-bold rounded-xl transition"
            >
              {isLoading ? 'Opening Channel...' : `Open Channel ($${depositAmount} USDC)`}
            </button>
            
            {!isPolygon && (
              <p className="text-yellow-400 text-sm mt-3 text-center">
                Please switch to Polygon network in MetaMask
              </p>
            )}
          </div>
        ) : (
          // Channel Open - Chat Interface
          <div className="flex flex-col h-[70vh]">
            {/* Status Bar */}
            <div className="bg-[#111] border border-[#333] rounded-lg p-3 mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-[#00D395] animate-pulse"></div>
                <span className="text-sm text-gray-400">Channel Active</span>
              </div>
              <div className="flex items-center gap-6 font-mono text-sm">
                <div>
                  <span className="text-gray-500">Remaining:</span>{' '}
                  <span className="text-[#00D395]">${channel.remaining}</span>
                </div>
                <div>
                  <span className="text-gray-500">Spent:</span>{' '}
                  <span className="text-[#7B61FF]">${channel.spent}</span>
                </div>
                <div>
                  <span className="text-gray-500">Vouchers:</span>{' '}
                  <span>{voucherCount}</span>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 bg-[#111] border border-[#333] rounded-lg p-4 overflow-y-auto space-y-4">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`p-4 rounded-lg ${
                    msg.role === 'user' 
                      ? 'bg-[#1a1a2e] border-l-2 border-[#00D395] ml-12' 
                      : 'bg-[#1a1a1a] border-l-2 border-[#7B61FF] mr-12'
                  }`}
                >
                  <div className="text-xs text-gray-500 mb-1">
                    {msg.role === 'user' ? 'You' : 'AI (via DRAIN)'}
                  </div>
                  <div className="text-gray-100 whitespace-pre-wrap">{msg.content}</div>
                </div>
              ))}
              
              {isLoading && (
                <div className="bg-[#1a1a1a] border-l-2 border-[#7B61FF] mr-12 p-4 rounded-lg">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-[#7B61FF] rounded-full animate-bounce"></span>
                    <span className="w-2 h-2 bg-[#7B61FF] rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></span>
                    <span className="w-2 h-2 bg-[#7B61FF] rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></span>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="bg-[#111] border border-[#333] rounded-lg p-3 mt-4 flex gap-3">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                placeholder="Type a message..."
                className="flex-1 bg-transparent outline-none text-white placeholder-gray-500"
                disabled={isLoading}
              />
              <button
                onClick={sendMessage}
                disabled={isLoading || !input.trim()}
                className="px-6 py-2 bg-[#7B61FF] hover:bg-[#6B51EF] disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-medium transition"
              >
                Send
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-8 text-center text-gray-500 text-sm">
          <a href="https://github.com/kimbo128/DRAIN" className="text-[#00D395] hover:underline">GitHub</a>
          {' · '}
          <a href="https://polygonscan.com/address/0x1C1918C99b6DcE977392E4131C91654d8aB71e64" className="hover:underline">Contract</a>
          {' · '}
          DRAIN Protocol
        </footer>
      </div>
    </main>
  );
}

// TypeScript declaration for window.ethereum
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, callback: (...args: unknown[]) => void) => void;
    };
  }
}
