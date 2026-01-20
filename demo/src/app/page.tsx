'use client';

import { useState, useEffect, useRef } from 'react';

// ============================================================================
// CONSTANTS
// ============================================================================

const DRAIN_CONTRACT = '0x1C1918C99b6DcE977392E4131C91654d8aB71e64';
const USDC_ADDRESS = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const CHAIN_ID = 137;

// Available AI Providers
const PROVIDERS = [
  {
    id: 'drain-official',
    name: 'DRAIN Official',
    url: 'https://drain-production-a9d4.up.railway.app',
    address: '0xCCf2a94EcC6002b8Dd9d161ef15Bb4ABD5cD9E41',
    models: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', costPer1k: 0.001125 },
      { id: 'gpt-4o', name: 'GPT-4o', costPer1k: 0.01875 },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', costPer1k: 0.06 },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', costPer1k: 0.003 },
    ],
  },
  // Add more providers here in the future
  // {
  //   id: 'another-provider',
  //   name: 'Another AI Provider',
  //   url: 'https://...',
  //   address: '0x...',
  //   models: [...],
  // },
];

// ABIs
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
];

const DRAIN_ABI = [
  'function open(address provider, uint256 amount, uint256 duration) returns (bytes32)',
  'function close(bytes32 channelId)',
  'function getChannel(bytes32 channelId) view returns (tuple(address consumer, address provider, uint256 deposit, uint256 claimed, uint256 expiry))',
  'function getBalance(bytes32 channelId) view returns (uint256)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
  'event ChannelOpened(bytes32 indexed channelId, address indexed consumer, address indexed provider, uint256 deposit, uint256 expiry)',
];

// EIP-712 Types for voucher signing
const VOUCHER_TYPES = {
  Voucher: [
    { name: 'channelId', type: 'bytes32' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
};

// ============================================================================
// TYPES
// ============================================================================

interface Channel {
  id: string;
  deposit: bigint;
  claimed: bigint;
  expiry: number;
  spent: bigint; // Local tracking
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  cost?: string;
}

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, callback: (...args: unknown[]) => void) => void;
    };
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function formatUSDC(wei: bigint): string {
  const num = Number(wei) / 1_000_000;
  if (num < 0.0001) return num.toFixed(6);
  if (num < 0.01) return num.toFixed(4);
  return num.toFixed(2);
}

function parseUSDC(amount: string): bigint {
  const num = parseFloat(amount);
  if (isNaN(num) || num <= 0) return 0n;
  return BigInt(Math.floor(num * 1_000_000));
}

const MIN_DEPOSIT = 0.5;  // $0.50 minimum
const MAX_DEPOSIT = 100;  // $100 maximum

// ============================================================================
// COMPONENT
// ============================================================================

export default function Home() {
  // Wallet state
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<bigint>(0n);
  const [isConnecting, setIsConnecting] = useState(false);
  
  // Channel state
  const [channel, setChannel] = useState<Channel | null>(null);
  const [voucherNonce, setVoucherNonce] = useState(0);
  
  // Provider/Model state
  const [selectedProvider, setSelectedProvider] = useState(PROVIDERS[0]);
  const [selectedModel, setSelectedModel] = useState(PROVIDERS[0].models[0]);
  
  // UI state
  const [depositAmount, setDepositAmount] = useState('5');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [demoMode, setDemoMode] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isPolygon = chainId === CHAIN_ID;

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Check wallet on load
  useEffect(() => {
    if (typeof window.ethereum !== 'undefined') {
      window.ethereum.request({ method: 'eth_accounts' }).then(async (accounts: unknown) => {
        const accs = accounts as string[];
        if (accs.length > 0) {
          setAddress(accs[0]);
          const chain = await window.ethereum!.request({ method: 'eth_chainId' }) as string;
          setChainId(parseInt(chain, 16));
          if (parseInt(chain, 16) === CHAIN_ID) {
            fetchUSDCBalance(accs[0]);
          }
        }
      });
    }
  }, []);

  // ============================================================================
  // WALLET FUNCTIONS
  // ============================================================================

  const connectWallet = async () => {
    if (typeof window.ethereum === 'undefined') {
      alert('Please install MetaMask to use DRAIN with real payments.\n\nOr try Demo Mode!');
      return;
    }
    
    setIsConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[];
      const chain = await window.ethereum.request({ method: 'eth_chainId' }) as string;
      setAddress(accounts[0]);
      setChainId(parseInt(chain, 16));
      
      if (parseInt(chain, 16) === CHAIN_ID) {
        await fetchUSDCBalance(accounts[0]);
      }
    } catch (e) {
      console.error('Failed to connect:', e);
    } finally {
      setIsConnecting(false);
    }
  };

  const switchToPolygon = async () => {
    if (!window.ethereum) return;
    
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x89' }],
      });
      // Get current chain to confirm switch
      const newChain = await window.ethereum.request({ method: 'eth_chainId' }) as string;
      setChainId(parseInt(newChain, 16));
    } catch (switchError: unknown) {
      const err = switchError as { code?: number };
      if (err.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: '0x89',
              chainName: 'Polygon Mainnet',
              nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
              rpcUrls: ['https://polygon-rpc.com'],
              blockExplorerUrls: ['https://polygonscan.com'],
            }],
          });
          const newChain = await window.ethereum.request({ method: 'eth_chainId' }) as string;
          setChainId(parseInt(newChain, 16));
        } catch (addError) {
          console.error('Failed to add Polygon:', addError);
        }
      }
    }
  };

  const fetchUSDCBalance = async (addr: string) => {
    try {
      // Call balanceOf using eth_call
      // balanceOf(address) selector = 0x70a08231
      const paddedAddr = addr.toLowerCase().slice(2).padStart(64, '0');
      const data = '0x70a08231' + paddedAddr;
      
      const result = await window.ethereum!.request({
        method: 'eth_call',
        params: [{ to: USDC_ADDRESS, data }, 'latest'],
      }) as string;
      
      // Handle empty result or 0x
      if (!result || result === '0x' || result === '0x0') {
        setUsdcBalance(0n);
      } else {
        setUsdcBalance(BigInt(result));
      }
    } catch (e) {
      console.error('Failed to fetch USDC balance:', e);
      setUsdcBalance(0n);
    }
  };
  
  // Refetch balance when chain changes to Polygon
  useEffect(() => {
    if (address && chainId === CHAIN_ID && !demoMode) {
      fetchUSDCBalance(address);
    }
  }, [chainId, address, demoMode]);

  // ============================================================================
  // CHANNEL FUNCTIONS
  // ============================================================================

  const openChannel = async () => {
    if (!address || !window.ethereum) return;
    
    setIsLoading(true);
    setStatus('Checking USDC allowance...');
    
    try {
      const amount = parseUSDC(depositAmount);
      const duration = 86400n; // 24 hours
      
      // 1. Check allowance
      const allowanceData = '0xdd62ed3e' + 
        address.slice(2).padStart(64, '0') + 
        DRAIN_CONTRACT.slice(2).padStart(64, '0');
      
      const allowanceResult = await window.ethereum.request({
        method: 'eth_call',
        params: [{ to: USDC_ADDRESS, data: allowanceData }, 'latest'],
      }) as string;
      
      const allowance = BigInt(allowanceResult);
      
      // 2. Approve if needed
      if (allowance < amount) {
        setStatus('Approving USDC spend...');
        
        // approve(address,uint256)
        const approveData = '0x095ea7b3' +
          DRAIN_CONTRACT.slice(2).padStart(64, '0') +
          amount.toString(16).padStart(64, '0');
        
        await window.ethereum.request({
          method: 'eth_sendTransaction',
          params: [{
            from: address,
            to: USDC_ADDRESS,
            data: approveData,
          }],
        });
        
        // Wait for approval
        setStatus('Waiting for approval confirmation...');
        await new Promise(r => setTimeout(r, 3000));
      }
      
      // 3. Open channel
      setStatus('Opening payment channel...');
      
      // open(address,uint256,uint256)
      const openData = '0x' +
        'e4350d38' + // function selector for open(address,uint256,uint256)
        selectedProvider.address.slice(2).padStart(64, '0') +
        amount.toString(16).padStart(64, '0') +
        duration.toString(16).padStart(64, '0');
      
      const txHash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
          from: address,
          to: DRAIN_CONTRACT,
          data: openData,
        }],
      }) as string;
      
      setStatus('Waiting for confirmation...');
      
      // Poll for transaction receipt
      let receipt = null;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        receipt = await window.ethereum.request({
          method: 'eth_getTransactionReceipt',
          params: [txHash],
        });
        if (receipt) break;
      }
      
      if (!receipt) {
        throw new Error('Transaction not confirmed');
      }
      
      // Extract channelId from ChannelOpened event
      const logs = (receipt as { logs: Array<{ topics: string[]; data: string }> }).logs;
      const openedEvent = logs.find(log => 
        log.topics[0] === '0x506f81b7a67b45bfbc6167fd087b3dd9b65b4531a2380ec406aab5b57ac62152'
      );
      
      if (!openedEvent) {
        throw new Error('ChannelOpened event not found');
      }
      
      const channelId = openedEvent.topics[1];
      
      setChannel({
        id: channelId,
        deposit: amount,
        claimed: 0n,
        expiry: Math.floor(Date.now() / 1000) + Number(duration),
        spent: 0n,
      });
      
      setMessages([{
        role: 'system',
        content: `🎉 Payment channel opened!\n\n• Deposit: $${depositAmount} USDC\n• Provider: ${selectedProvider.name}\n• Model: ${selectedModel.name}\n• Channel: ${channelId.slice(0, 18)}...\n• Expires: ${new Date(Date.now() + Number(duration) * 1000).toLocaleString()}\n\nYou can now chat with AI. Each message costs ~$${selectedModel.costPer1k.toFixed(4)}/1K tokens.`
      }]);
      
      setVoucherNonce(0);
      setStatus('');
      await fetchUSDCBalance(address);
      
    } catch (e) {
      console.error('Failed to open channel:', e);
      setStatus('');
      alert('Failed to open channel: ' + (e as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const closeChannel = async () => {
    if (!channel || !address || !window.ethereum) return;
    
    setIsLoading(true);
    setStatus('Closing channel and refunding...');
    
    try {
      // close(bytes32)
      const closeData = '0x39c79e0c' + channel.id.slice(2);
      
      await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
          from: address,
          to: DRAIN_CONTRACT,
          data: closeData,
        }],
      });
      
      setStatus('Waiting for confirmation...');
      await new Promise(r => setTimeout(r, 5000));
      
      const refund = channel.deposit - channel.spent;
      
      setMessages(prev => [...prev, {
        role: 'system',
        content: `💰 Channel Closed!\n\n• Spent: $${formatUSDC(channel.spent)} USDC\n• Refunded: $${formatUSDC(refund)} USDC\n\nNote: Refund is sent after channel expiry (${new Date(channel.expiry * 1000).toLocaleString()})`
      }]);
      
      setChannel(null);
      setVoucherNonce(0);
      setStatus('');
      await fetchUSDCBalance(address);
      
    } catch (e) {
      console.error('Failed to close channel:', e);
      setStatus('');
      alert('Failed to close channel: ' + (e as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================================
  // VOUCHER SIGNING
  // ============================================================================

  const signVoucher = async (amount: bigint, nonce: number): Promise<string> => {
    if (!address || !window.ethereum || !channel) {
      throw new Error('Not connected');
    }

    const domain = {
      name: 'DrainChannel',
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: DRAIN_CONTRACT,
    };

    const message = {
      channelId: channel.id,
      amount: '0x' + amount.toString(16),
      nonce: nonce,
    };

    const signature = await window.ethereum.request({
      method: 'eth_signTypedData_v4',
      params: [address, JSON.stringify({
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
          ],
          ...VOUCHER_TYPES,
        },
        primaryType: 'Voucher',
        domain,
        message,
      })],
    }) as string;

    return signature;
  };

  // ============================================================================
  // CHAT FUNCTION
  // ============================================================================

  const sendMessage = async () => {
    if (!input.trim() || !channel) return;
    
    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);
    
    try {
      // Estimate cost (pessimistic: $0.01 per message max)
      const estimatedCost = 10000n; // $0.01 in USDC wei
      const newTotal = channel.spent + estimatedCost;
      
      if (newTotal > channel.deposit) {
        setMessages(prev => [...prev, {
          role: 'system',
          content: '⚠️ Insufficient funds in channel. Please close and open a new channel with more USDC.'
        }]);
        setIsLoading(false);
        return;
      }
      
      // Sign voucher for new total
      const nextNonce = voucherNonce + 1;
      setStatus('Signing voucher...');
      const signature = await signVoucher(newTotal, nextNonce);
      
      // Create voucher header
      const voucherHeader = `${channel.id}:${newTotal.toString()}:${nextNonce}:${signature}`;
      
      setStatus('Sending to AI...');
      
      // Call provider API
      const response = await fetch(`${selectedProvider.url}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-DRAIN-Voucher': voucherHeader,
        },
        body: JSON.stringify({
          model: selectedModel.id,
          messages: [
            ...messages.filter(m => m.role !== 'system').map(m => ({
              role: m.role,
              content: m.content,
            })),
            { role: 'user', content: userMessage },
          ],
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'API request failed');
      }
      
      const completion = await response.json();
      const assistantMessage = completion.choices[0]?.message?.content || 'No response';
      
      // Get cost from headers
      const cost = response.headers.get('X-DRAIN-Cost');
      const totalSpent = response.headers.get('X-DRAIN-Total');
      const remaining = response.headers.get('X-DRAIN-Remaining');
      
      // Update channel state
      const actualCost = cost ? BigInt(cost) : estimatedCost;
      const actualTotal = totalSpent ? BigInt(totalSpent) : newTotal;
      
      setChannel(prev => prev ? {
        ...prev,
        spent: actualTotal,
      } : null);
      
      setVoucherNonce(nextNonce);
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: assistantMessage,
        cost: `$${formatUSDC(actualCost)}`,
      }]);
      
      setStatus('');
      
    } catch (e) {
      console.error('Failed to send message:', e);
      setStatus('');
      setMessages(prev => [...prev, {
        role: 'system',
        content: `❌ Error: ${(e as Error).message}`
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================================
  // DEMO MODE
  // ============================================================================

  const startDemoMode = () => {
    setDemoMode(true);
    setAddress('0xDemo...Mode');
    setChainId(CHAIN_ID);
    setUsdcBalance(parseUSDC('100'));
    setChannel({
      id: '0x' + 'demo'.repeat(16),
      deposit: parseUSDC('10'),
      claimed: 0n,
      expiry: Math.floor(Date.now() / 1000) + 86400,
      spent: 0n,
    });
    setMessages([{
      role: 'system',
      content: '🎮 Demo Mode Active\n\nThis is a simulation - no real transactions. Connect a real wallet to use DRAIN with actual payments!'
    }]);
  };

  const sendDemoMessage = async () => {
    if (!input.trim() || !channel) return;
    
    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);
    
    await new Promise(r => setTimeout(r, 1000));
    
    const mockCost = 500n + BigInt(Math.floor(Math.random() * 1000));
    
    setChannel(prev => prev ? {
      ...prev,
      spent: prev.spent + mockCost,
    } : null);
    
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `This is a demo response. In real mode, this would be powered by GPT-4 via the DRAIN provider.\n\nYour message was: "${userMessage}"`,
      cost: `$${formatUSDC(mockCost)}`,
    }]);
    
    setIsLoading(false);
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '';
  const remaining = channel ? channel.deposit - channel.spent : 0n;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="border-b border-[#222] sticky top-0 bg-[#0a0a0a]/95 backdrop-blur z-50">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold bg-gradient-to-r from-[#00D395] to-[#7B61FF] bg-clip-text text-transparent">
              DRAIN
            </span>
            <span className="text-xs text-gray-500 hidden sm:inline">Pay-per-Token AI</span>
          </div>
          
          <div className="flex items-center gap-3">
            {address ? (
              <>
                {demoMode && (
                  <span className="px-2 py-1 bg-purple-500/20 text-purple-400 rounded text-xs font-medium">
                    Demo
                  </span>
                )}
                {!isPolygon && !demoMode && (
                  <button
                    onClick={switchToPolygon}
                    className="px-3 py-1.5 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 rounded-lg text-xs font-medium transition"
                  >
                    ⚠️ Switch to Polygon
                  </button>
                )}
                {isPolygon && !demoMode && (
                  <span className="text-xs text-gray-400">
                    {formatUSDC(usdcBalance)} USDC
                  </span>
                )}
                <div className="px-3 py-1.5 bg-[#1a1a1a] rounded-lg border border-[#333] font-mono text-sm text-gray-300">
                  {shortAddress}
                </div>
              </>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={startDemoMode}
                  className="px-4 py-2 bg-[#222] hover:bg-[#333] text-gray-300 font-medium rounded-lg transition text-sm"
                >
                  Demo
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

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Not Connected */}
        {!address && (
          <div className="text-center py-20">
            <h1 className="text-5xl font-bold mb-6">
              <span className="bg-gradient-to-r from-[#00D395] to-[#7B61FF] bg-clip-text text-transparent">
                AI Without Credit Cards
              </span>
            </h1>
            <p className="text-xl text-gray-400 mb-8 max-w-2xl mx-auto">
              Pay for AI with USDC micropayments. Real on-chain payments, real AI responses.
            </p>
            <div className="flex gap-4 justify-center">
              <button
                onClick={connectWallet}
                className="px-8 py-4 bg-[#00D395] hover:bg-[#00B080] text-black font-bold rounded-xl transition text-lg"
              >
                Connect Wallet
              </button>
              <button
                onClick={startDemoMode}
                className="px-8 py-4 bg-[#222] hover:bg-[#333] text-white font-semibold rounded-xl transition text-lg border border-[#333]"
              >
                Try Demo
              </button>
            </div>
          </div>
        )}

        {/* Connected, No Channel */}
        {address && !channel && (
          <div className="max-w-md mx-auto">
            <div className="bg-[#111] border border-[#222] rounded-2xl p-8">
              <h2 className="text-2xl font-bold mb-2">Open Payment Channel</h2>
              <p className="text-gray-400 mb-6">Deposit USDC to start chatting with AI.</p>
              
              <div className="space-y-6 mb-6">
                {/* Amount Display */}
                <div className="text-center">
                  <div className="text-5xl font-bold text-white mb-2">
                    ${parseFloat(depositAmount) || 0}
                  </div>
                  <div className="text-gray-500 text-sm">USDC deposit</div>
                </div>
                
                {/* Slider */}
                <div className="space-y-2">
                  <input
                    type="range"
                    min={MIN_DEPOSIT}
                    max={MAX_DEPOSIT}
                    step="0.5"
                    value={parseFloat(depositAmount) || MIN_DEPOSIT}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    className="w-full h-2 bg-[#222] rounded-lg appearance-none cursor-pointer accent-[#00D395]"
                    style={{
                      background: `linear-gradient(to right, #00D395 0%, #00D395 ${((parseFloat(depositAmount) || MIN_DEPOSIT) - MIN_DEPOSIT) / (MAX_DEPOSIT - MIN_DEPOSIT) * 100}%, #222 ${((parseFloat(depositAmount) || MIN_DEPOSIT) - MIN_DEPOSIT) / (MAX_DEPOSIT - MIN_DEPOSIT) * 100}%, #222 100%)`
                    }}
                  />
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>${MIN_DEPOSIT}</span>
                    <span>${MAX_DEPOSIT}</span>
                  </div>
                </div>
                
                {/* Quick Select */}
                <div className="flex gap-2">
                  {['1', '5', '10', '25', '50'].map(amt => (
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

              {/* Provider & Model Selection */}
              <div className="space-y-3 mb-6">
                {/* Provider Selection */}
                <div className="bg-[#0a0a0a] border border-[#222] rounded-xl p-3">
                  <label className="text-xs text-gray-500 block mb-2">AI PROVIDER</label>
                  <select
                    value={selectedProvider.id}
                    onChange={(e) => {
                      const provider = PROVIDERS.find(p => p.id === e.target.value)!;
                      setSelectedProvider(provider);
                      setSelectedModel(provider.models[0]);
                    }}
                    className="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-white outline-none focus:border-[#00D395]"
                  >
                    {PROVIDERS.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                
                {/* Model Selection */}
                <div className="bg-[#0a0a0a] border border-[#222] rounded-xl p-3">
                  <label className="text-xs text-gray-500 block mb-2">AI MODEL</label>
                  <div className="grid grid-cols-2 gap-2">
                    {selectedProvider.models.map(model => (
                      <button
                        key={model.id}
                        onClick={() => setSelectedModel(model)}
                        className={`p-3 rounded-lg text-left transition ${
                          selectedModel.id === model.id
                            ? 'bg-[#00D395]/20 border-2 border-[#00D395]'
                            : 'bg-[#111] border border-[#333] hover:border-[#444]'
                        }`}
                      >
                        <div className="font-medium text-sm">{model.name}</div>
                        <div className="text-xs text-gray-500">${model.costPer1k.toFixed(4)}/1K</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Estimates */}
              <div className="bg-[#0a0a0a] border border-[#222] rounded-xl p-4 mb-6">
                <div className="grid grid-cols-2 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-[#00D395]">
                      ~{Math.floor((parseFloat(depositAmount) || 0) / selectedModel.costPer1k).toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-500">est. messages</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-[#7B61FF]">
                      ${selectedModel.costPer1k.toFixed(4)}
                    </div>
                    <div className="text-xs text-gray-500">per ~1K tokens</div>
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-[#222] text-xs text-gray-500 space-y-1">
                  <div className="flex justify-between">
                    <span>Provider Address</span>
                    <span className="font-mono">{selectedProvider.address.slice(0, 10)}...</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Network</span>
                    <span className="text-gray-300">Polygon Mainnet</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Channel Duration</span>
                    <span className="text-gray-300">24 hours</span>
                  </div>
                </div>
              </div>
              
              <button
                onClick={openChannel}
                disabled={isLoading || (!isPolygon && !demoMode) || parseUSDC(depositAmount) === 0n || (!demoMode && usdcBalance < parseUSDC(depositAmount))}
                className="w-full py-4 bg-gradient-to-r from-[#00D395] to-[#00B080] hover:from-[#00B080] hover:to-[#009970] disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed text-black font-bold rounded-xl transition text-lg"
              >
                {isLoading ? status || 'Processing...' : `Open Channel • $${parseFloat(depositAmount) || 0} USDC`}
              </button>
              
              {!isPolygon && !demoMode && (
                <button
                  onClick={switchToPolygon}
                  className="w-full mt-3 py-2 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 rounded-lg text-sm"
                >
                  ⚠️ Switch to Polygon
                </button>
              )}
              
              {isPolygon && !demoMode && usdcBalance < parseUSDC(depositAmount) && parseUSDC(depositAmount) > 0n && (
                <p className="text-red-400 text-sm mt-3 text-center">
                  Insufficient USDC balance ({formatUSDC(usdcBalance)} available)
                </p>
              )}
            </div>
          </div>
        )}

        {/* Chat Interface */}
        {address && channel && (
          <div className="flex flex-col h-[calc(100vh-160px)]">
            {/* Status Bar */}
            <div className="bg-[#111] border border-[#222] rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="w-2 h-2 rounded-full bg-[#00D395] animate-pulse"></div>
                  <span className="text-sm text-gray-400">{selectedProvider.name}</span>
                  <span className="px-2 py-0.5 bg-[#7B61FF]/20 text-[#7B61FF] rounded text-xs font-medium">
                    {selectedModel.name}
                  </span>
                  <button
                    onClick={demoMode ? () => { setChannel(null); setMessages([]); } : closeChannel}
                    disabled={isLoading}
                    className="px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-xs font-medium transition"
                  >
                    Close
                  </button>
                </div>
                <div className="flex items-center gap-6 font-mono text-sm">
                  <div className="text-center">
                    <div className="text-[#00D395] text-lg font-bold">${formatUSDC(remaining)}</div>
                    <div className="text-xs text-gray-500">remaining</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[#7B61FF] text-lg font-bold">${formatUSDC(channel.spent)}</div>
                    <div className="text-xs text-gray-500">spent</div>
                  </div>
                </div>
              </div>
              <div className="mt-3 h-1 bg-[#222] rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-[#00D395] to-[#7B61FF] transition-all"
                  style={{ width: `${Number(channel.spent) / Number(channel.deposit) * 100}%` }}
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
                      ? 'bg-[#00D395] text-black rounded-br-sm' 
                      : msg.role === 'system'
                      ? 'bg-[#1a1a2e] border border-[#333] text-center'
                      : 'bg-[#1a1a1a] border border-[#222] rounded-bl-sm'
                  }`}>
                    <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                    {msg.cost && (
                      <div className="text-xs opacity-60 mt-2 text-right">{msg.cost}</div>
                    )}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex items-center gap-2 text-gray-400">
                  <div className="animate-pulse">●</div>
                  <span className="text-sm">{status || 'Thinking...'}</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="mt-4 flex gap-3">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (demoMode ? sendDemoMessage() : sendMessage())}
                placeholder="Type a message..."
                disabled={isLoading}
                className="flex-1 bg-[#111] border border-[#222] rounded-xl px-4 py-3 outline-none focus:border-[#00D395] transition"
              />
              <button
                onClick={demoMode ? sendDemoMessage : sendMessage}
                disabled={isLoading || !input.trim()}
                className="px-6 py-3 bg-[#00D395] hover:bg-[#00B080] disabled:bg-gray-700 text-black font-semibold rounded-xl transition"
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-[#222] py-4 mt-auto">
        <div className="max-w-5xl mx-auto px-4 text-center text-xs text-gray-500">
          <a href="https://github.com/kimbo128/DRAIN" className="hover:text-white">GitHub</a>
          <span className="mx-2">·</span>
          <a href={`https://polygonscan.com/address/${DRAIN_CONTRACT}`} className="hover:text-white">Contract</a>
          <span className="mx-2">·</span>
          <a href={`${selectedProvider.url}/v1/pricing`} className="hover:text-white">API Pricing</a>
          <div className="mt-1">DRAIN Protocol © 2026</div>
        </div>
      </footer>
    </div>
  );
}
