'use client';

import { useState, useRef, useEffect } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { formatUnits, parseUnits, type Hash } from 'viem';
import { polygon, polygonAmoy } from 'wagmi/chains';

// Contract addresses
const DRAIN_ADDRESSES = {
  137: '0x1C1918C99b6DcE977392E4131C91654d8aB71e64' as const,
  80002: '0x61f1C1E04d6Da1C92D0aF1a3d7Dc0fEFc8794d7C' as const,
};

const USDC_ADDRESSES = {
  137: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' as const,
  80002: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582' as const,
};

// Simplified ABIs
const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;

const DRAIN_ABI = [
  { name: 'open', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'provider', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'duration', type: 'uint256' }], outputs: [{ name: 'channelId', type: 'bytes32' }] },
  { name: 'getChannel', type: 'function', stateMutability: 'view', inputs: [{ name: 'channelId', type: 'bytes32' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'consumer', type: 'address' }, { name: 'provider', type: 'address' }, { name: 'deposit', type: 'uint256' }, { name: 'claimed', type: 'uint256' }, { name: 'expiry', type: 'uint256' }] }] },
  { name: 'getBalance', type: 'function', stateMutability: 'view', inputs: [{ name: 'channelId', type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
] as const;

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChannelInfo {
  id: Hash;
  deposit: bigint;
  claimed: bigint;
  balance: bigint;
  expiry: bigint;
}

export default function Home() {
  const { address, isConnected, chain } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<string>('0');
  const [depositAmount, setDepositAmount] = useState('5');
  const [nonce, setNonce] = useState(0);
  const [totalSpent, setTotalSpent] = useState(0n);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chainId = (chain?.id as 137 | 80002) || 137;
  const isTestnet = chainId === 80002;

  // Fetch USDC balance
  useEffect(() => {
    if (!address || !publicClient) return;
    
    const fetchBalance = async () => {
      try {
        const balance = await publicClient.readContract({
          address: USDC_ADDRESSES[chainId],
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        });
        setUsdcBalance(formatUnits(balance, 6));
      } catch (e) {
        console.error('Failed to fetch balance:', e);
      }
    };
    
    fetchBalance();
    const interval = setInterval(fetchBalance, 10000);
    return () => clearInterval(interval);
  }, [address, publicClient, chainId]);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Open a channel
  const openChannel = async () => {
    if (!walletClient || !address || !publicClient) return;
    
    setIsLoading(true);
    try {
      const amount = parseUnits(depositAmount, 6);
      const drainAddress = DRAIN_ADDRESSES[chainId];
      const usdcAddress = USDC_ADDRESSES[chainId];
      
      // Check allowance
      const allowance = await publicClient.readContract({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, drainAddress],
      });
      
      // Approve if needed
      if (allowance < amount) {
        const approveHash = await walletClient.writeContract({
          address: usdcAddress,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [drainAddress, amount],
          chain: isTestnet ? polygonAmoy : polygon,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }
      
      // Demo provider address (replace with real provider)
      const providerAddress = '0x7E2e552f60544E07206f4Ea31479faF4118e1757';
      const duration = 3600n; // 1 hour
      
      // Open channel
      const openHash = await walletClient.writeContract({
        address: drainAddress,
        abi: DRAIN_ABI,
        functionName: 'open',
        args: [providerAddress, amount, duration],
        chain: isTestnet ? polygonAmoy : polygon,
      });
      
      const receipt = await publicClient.waitForTransactionReceipt({ hash: openHash });
      
      // Get channel ID from event
      const channelId = receipt.logs[1]?.topics[1] as Hash;
      
      // Fetch channel details
      const channelData = await publicClient.readContract({
        address: drainAddress,
        abi: DRAIN_ABI,
        functionName: 'getChannel',
        args: [channelId],
      });
      
      setChannel({
        id: channelId,
        deposit: channelData.deposit,
        claimed: channelData.claimed,
        balance: channelData.deposit - channelData.claimed,
        expiry: channelData.expiry,
      });
      
      setNonce(0);
      setTotalSpent(0n);
      setMessages([]);
      
    } catch (e) {
      console.error('Failed to open channel:', e);
      alert('Failed to open channel. Check console for details.');
    } finally {
      setIsLoading(false);
    }
  };

  // Simulate sending a message (mock - would connect to real provider)
  const sendMessage = async () => {
    if (!input.trim() || !channel) return;
    
    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);
    
    try {
      // In production, this would:
      // 1. Sign a voucher with walletClient.signTypedData()
      // 2. Send request to provider with voucher in header
      // 3. Receive response and track cost
      
      // Mock response for demo
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const mockCost = parseUnits('0.001', 6); // $0.001 per message
      const newTotal = totalSpent + mockCost;
      setTotalSpent(newTotal);
      setNonce(n => n + 1);
      setChannel(prev => prev ? {
        ...prev,
        balance: prev.deposit - newTotal,
      } : null);
      
      const responses = [
        "I'm a demo AI assistant running on DRAIN! Each response costs a tiny amount of USDC, paid directly to the provider.",
        "DRAIN enables trustless micropayments for AI. No tokens, no intermediaries, just USDC on Polygon.",
        "This is a simulation. In production, I'd be a real AI model (like GPT-4) accepting DRAIN payments!",
        "Payment channels let you pay per-token without on-chain fees for every request. Efficient!",
      ];
      
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: responses[Math.floor(Math.random() * responses.length)] }
      ]);
      
    } catch (e) {
      console.error('Failed to send message:', e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold gradient-text">DRAIN</h1>
            <p className="text-gray-400 text-sm">Trustless AI Payments Demo</p>
          </div>
          <div className="flex items-center gap-4">
            {isTestnet && (
              <span className="px-3 py-1 bg-yellow-500/20 text-yellow-400 rounded-full text-xs font-medium">
                Testnet
              </span>
            )}
            <ConnectButton />
          </div>
        </header>

        {/* Main Content */}
        {!isConnected ? (
          <div className="animated-border p-12 text-center">
            <div className="text-6xl mb-6">🔌</div>
            <h2 className="text-2xl font-bold mb-4">Connect Your Wallet</h2>
            <p className="text-gray-400 mb-6">
              Connect your wallet to open a payment channel and chat with AI
            </p>
            <ConnectButton />
          </div>
        ) : !channel ? (
          <div className="animated-border p-8">
            <h2 className="text-xl font-bold mb-6">Open Payment Channel</h2>
            
            <div className="grid md:grid-cols-2 gap-6 mb-6">
              <div className="terminal p-4">
                <div className="text-xs text-gray-500 mb-2">YOUR USDC BALANCE</div>
                <div className="text-2xl font-mono">${parseFloat(usdcBalance).toFixed(2)}</div>
              </div>
              <div className="terminal p-4">
                <div className="text-xs text-gray-500 mb-2">DEPOSIT AMOUNT (USDC)</div>
                <input
                  type="number"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="bg-transparent text-2xl font-mono w-full outline-none"
                  min="0.01"
                  step="0.01"
                />
              </div>
            </div>
            
            <div className="terminal p-4 mb-6">
              <div className="text-xs text-gray-500 mb-2">HOW IT WORKS</div>
              <ul className="text-sm text-gray-300 space-y-2">
                <li>1. Deposit USDC into a payment channel</li>
                <li>2. Sign vouchers off-chain for each request (free)</li>
                <li>3. Provider claims payment on-chain (batched)</li>
                <li>4. Withdraw unused funds after expiry</li>
              </ul>
            </div>
            
            <button
              onClick={openChannel}
              disabled={isLoading || parseFloat(usdcBalance) < parseFloat(depositAmount)}
              className="w-full py-4 bg-[#00D395] hover:bg-[#00B080] disabled:bg-gray-700 disabled:cursor-not-allowed text-black font-bold rounded-xl transition glow-green"
            >
              {isLoading ? 'Opening Channel...' : `Open Channel ($${depositAmount} USDC)`}
            </button>
            
            {parseFloat(usdcBalance) < parseFloat(depositAmount) && (
              <p className="text-red-400 text-sm mt-2 text-center">
                Insufficient USDC balance. {isTestnet ? 'Get test USDC from a faucet.' : 'Bridge USDC to Polygon.'}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col h-[70vh]">
            {/* Channel Status Bar */}
            <div className="terminal p-4 mb-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-3 h-3 rounded-full bg-[#00D395] pulse-green"></div>
                <span className="text-sm text-gray-400">Channel Active</span>
              </div>
              <div className="flex items-center gap-6 font-mono text-sm">
                <div>
                  <span className="text-gray-500">Balance:</span>{' '}
                  <span className="text-[#00D395]">${formatUnits(channel.balance, 6)}</span>
                </div>
                <div>
                  <span className="text-gray-500">Spent:</span>{' '}
                  <span className="text-[#7B61FF]">${formatUnits(totalSpent, 6)}</span>
                </div>
                <div>
                  <span className="text-gray-500">Vouchers:</span>{' '}
                  <span>{nonce}</span>
                </div>
              </div>
            </div>
            
            {/* Chat Messages */}
            <div className="flex-1 terminal p-4 overflow-y-auto space-y-4">
              {messages.length === 0 && (
                <div className="text-center text-gray-500 py-12">
                  <div className="text-4xl mb-4">💬</div>
                  <p>Send a message to start chatting!</p>
                  <p className="text-sm mt-2">Each message signs a voucher (off-chain, free)</p>
                </div>
              )}
              
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`p-4 rounded-lg ${
                    msg.role === 'user' ? 'chat-user ml-12' : 'chat-assistant mr-12'
                  }`}
                >
                  <div className="text-xs text-gray-500 mb-1">
                    {msg.role === 'user' ? 'You' : 'AI Assistant'}
                  </div>
                  <div className="text-gray-100">{msg.content}</div>
                </div>
              ))}
              
              {isLoading && (
                <div className="chat-assistant mr-12 p-4 rounded-lg">
                  <div className="flex gap-1">
                    <span className="loading-dot w-2 h-2 bg-[#7B61FF] rounded-full"></span>
                    <span className="loading-dot w-2 h-2 bg-[#7B61FF] rounded-full"></span>
                    <span className="loading-dot w-2 h-2 bg-[#7B61FF] rounded-full"></span>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
            
            {/* Input */}
            <div className="terminal p-4 mt-4 flex gap-4">
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
          <p>
            <a href="https://github.com/kimbo128/DRAIN" className="text-[#00D395] hover:underline">
              GitHub
            </a>
            {' · '}
            <a href="https://polygonscan.com/address/0x1C1918C99b6DcE977392E4131C91654d8aB71e64" className="hover:underline">
              Contract
            </a>
            {' · '}
            DRAIN Protocol © 2026
          </p>
        </footer>
      </div>
    </main>
  );
}
