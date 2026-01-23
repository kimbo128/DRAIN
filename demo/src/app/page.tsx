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
  provider?: string;
}

interface ChannelHistoryItem {
  id: string;
  provider: string;
  deposit: bigint;
  claimed: bigint;
  expiry: number;
  status: 'active' | 'expired' | 'closed';
  refundable: bigint;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  cost?: string;
}

interface PreSignedVoucher {
  amount: bigint;
  nonce: number;
  signature: string;
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

const MIN_DEPOSIT = 0.10;  // $0.10 minimum - true micropayments!
const MAX_DEPOSIT = 100;   // $100 maximum

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

function ExpiryBadge({ expiry }: { expiry: number }) {
  const now = Math.floor(Date.now() / 1000);
  const remaining = expiry - now;
  const isExpired = remaining <= 0;
  const hours = Math.floor(Math.abs(remaining) / 3600);
  const minutes = Math.floor((Math.abs(remaining) % 3600) / 60);
  
  return (
    <span className={`px-2 py-0.5 rounded font-mono text-[10px] border ${
      isExpired 
        ? 'bg-[#ffff00]/10 text-[#ffff00] border-[#ffff00]/30' 
        : 'bg-[#0d0d14] text-[#888899] border-[#1e1e2e]'
    }`}>
      {isExpired ? 'TTL:EXPIRED' : `TTL:${hours}h${minutes}m`}
    </span>
  );
}

function ChannelActionButton({ 
  channel, 
  remaining, 
  isLoading, 
  onClose, 
  onExit 
}: { 
  channel: Channel;
  remaining: bigint;
  isLoading: boolean;
  onClose: () => void;
  onExit: () => void;
}) {
  const now = Math.floor(Date.now() / 1000);
  const isExpired = now >= channel.expiry;
  
  if (isExpired) {
    return (
      <button
        onClick={onClose}
        disabled={isLoading}
        className="px-3 py-1 bg-[#ffff00] hover:bg-[#cccc00] text-black rounded font-mono text-[10px] font-semibold transition"
      >
        CLAIM_REFUND(${formatUSDC(remaining)})
      </button>
    );
  }
  
  return (
    <button
      onClick={onExit}
      className="px-3 py-1 bg-[#1e1e2e] hover:bg-[#2a2a3e] text-[#888899] hover:text-[#e0e0e0] rounded font-mono text-[10px] transition border border-[#1e1e2e]"
      title="Channel will remain open. Return later to claim refund after expiry."
    >
      EXIT_SESSION
    </button>
  );
}

// ============================================================================
// MAIN COMPONENT
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
  
  // Channel history
  const [channelHistory, setChannelHistory] = useState<ChannelHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [showHistory, setShowHistory] = useState(true); // Show by default
  
  // Local storage for known channels
  const STORAGE_KEY = 'drain_channels';
  
  // Provider/Model state
  const [selectedProvider, setSelectedProvider] = useState(PROVIDERS[0]);
  const [selectedModel, setSelectedModel] = useState(PROVIDERS[0].models[0]);
  
  // Pre-sign state
  const [autoSignEnabled, setAutoSignEnabled] = useState(true);
  const [preSignCount, setPreSignCount] = useState(20);
  const [preSignedVouchers, setPreSignedVouchers] = useState<PreSignedVoucher[]>([]);
  const [usedVoucherIndex, setUsedVoucherIndex] = useState(0);
  
  // UI state
  const [depositAmount, setDepositAmount] = useState('1');
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
      // Use direct RPC call for reliability (MetaMask can be flaky with eth_call)
      const paddedAddr = addr.toLowerCase().slice(2).padStart(64, '0');
      const data = '0x70a08231' + paddedAddr;
      
      const response = await fetch('https://polygon-rpc.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_call',
          params: [{ to: USDC_ADDRESS, data }, 'latest'],
          id: 1,
        }),
      });
      
      const json = await response.json();
      const result = json.result;
      
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
  
  const disconnectWallet = () => {
    setAddress(null);
    setChainId(null);
    setUsdcBalance(0n);
    setChannel(null);
    setMessages([]);
    setDemoMode(false);
  };
  
  // Refetch balance when chain changes to Polygon
  useEffect(() => {
    if (address && chainId === CHAIN_ID && !demoMode) {
      fetchUSDCBalance(address);
      fetchChannelHistory(address);
    }
  }, [chainId, address, demoMode]);

  // ============================================================================
  // LOCAL STORAGE FOR CHANNELS
  // ============================================================================

  const saveChannelToStorage = (channelId: string, provider: string) => {
    try {
      console.log('[DRAIN] Saving channel to storage:', channelId, provider);
      const stored = localStorage.getItem(STORAGE_KEY);
      const channels: { id: string; provider: string; savedAt: number }[] = stored ? JSON.parse(stored) : [];
      
      // Don't add duplicates
      if (!channels.find(c => c.id === channelId)) {
        channels.push({ id: channelId, provider, savedAt: Date.now() });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(channels));
        console.log('[DRAIN] Channel saved. Total channels:', channels.length);
      } else {
        console.log('[DRAIN] Channel already exists in storage');
      }
    } catch (e) {
      console.error('[DRAIN] Failed to save channel to storage:', e);
    }
  };

  const getStoredChannels = (): { id: string; provider: string }[] => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const channels = stored ? JSON.parse(stored) : [];
      console.log('[DRAIN] Retrieved stored channels:', channels);
      return channels;
    } catch (e) {
      console.error('[DRAIN] Failed to get stored channels:', e);
      return [];
    }
  };

  // ============================================================================
  // CHANNEL HISTORY
  // ============================================================================

  const fetchChannelHistory = async (userAddress: string) => {
    setIsLoadingHistory(true);
    console.log('[DRAIN] Fetching channel history for:', userAddress);
    
    try {
      // Primary source: localStorage (most reliable for user's own channels)
      const storedChannels = getStoredChannels();
      console.log('[DRAIN] Stored channels:', storedChannels);
      
      if (storedChannels.length === 0) {
        console.log('[DRAIN] No stored channels found');
        setChannelHistory([]);
        setIsLoadingHistory(false);
        return;
      }
      
      // Check each stored channel's on-chain status
      const channels: ChannelHistoryItem[] = [];
      
      for (const stored of storedChannels) {
        console.log('[DRAIN] Checking channel:', stored.id);
        
        try {
          const channelData = await getChannelState(stored.id);
          console.log('[DRAIN] Channel data:', channelData);
          
          if (!channelData) {
            console.log('[DRAIN] No data for channel:', stored.id);
            continue;
          }
          
          const now = Math.floor(Date.now() / 1000);
          const isExpired = now >= channelData.expiry;
          const isClosed = channelData.consumer === '0x0000000000000000000000000000000000000000';
          
          // Check if this channel belongs to this user
          const isOwner = channelData.consumer.toLowerCase() === userAddress.toLowerCase();
          
          if (!isOwner && !isClosed) {
            console.log('[DRAIN] Channel not owned by user:', stored.id);
            continue;
          }
          
          let status: 'active' | 'expired' | 'closed';
          if (isClosed) {
            status = 'closed';
          } else if (isExpired) {
            status = 'expired';
          } else {
            status = 'active';
          }
          
          channels.push({
            id: stored.id,
            provider: stored.provider,
            deposit: channelData.deposit,
            claimed: channelData.claimed,
            expiry: channelData.expiry,
            status,
            refundable: channelData.deposit - channelData.claimed,
          });
          
          console.log('[DRAIN] Added channel:', stored.id, 'status:', status);
        } catch (channelError) {
          console.error('[DRAIN] Error checking channel:', stored.id, channelError);
        }
      }
      
      // Sort: active first, then expired, then closed
      channels.sort((a, b) => {
        const order = { active: 0, expired: 1, closed: 2 };
        if (order[a.status] !== order[b.status]) {
          return order[a.status] - order[b.status];
        }
        return b.expiry - a.expiry;
      });
      
      console.log('[DRAIN] Final channel list:', channels);
      setChannelHistory(channels);
    } catch (e) {
      console.error('[DRAIN] Failed to fetch channel history:', e);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const getChannelState = async (channelId: string): Promise<{
    consumer: string;
    provider: string;
    deposit: bigint;
    claimed: bigint;
    expiry: number;
  } | null> => {
    try {
      // getChannel(bytes32) selector: 0x7a7ebd7b
      const data = '0x7a7ebd7b' + channelId.slice(2);
      
      const response = await fetch('https://polygon-rpc.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_call',
          params: [{ to: DRAIN_CONTRACT, data }, 'latest'],
          id: 1,
        }),
      });
      
      const json = await response.json();
      const result = json.result;
      
      if (!result || result === '0x') return null;
      
      // Decode tuple: (address consumer, address provider, uint256 deposit, uint256 claimed, uint256 expiry)
      const consumer = '0x' + result.slice(26, 66);
      const provider = '0x' + result.slice(90, 130);
      const deposit = BigInt('0x' + result.slice(130, 194));
      const claimed = BigInt('0x' + result.slice(194, 258));
      const expiry = Number(BigInt('0x' + result.slice(258, 322)));
      
      return { consumer, provider, deposit, claimed, expiry };
    } catch (e) {
      console.error('Failed to get channel state:', e);
      return null;
    }
  };

  const refundChannel = async (channelId: string) => {
    if (!address || !window.ethereum) return;
    
    setIsLoading(true);
    setStatus('Closing channel and refunding...');
    
    try {
      // close(bytes32)
      const closeData = '0x39c79e0c' + channelId.slice(2);
      
      const txHash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
          from: address,
          to: DRAIN_CONTRACT,
          data: closeData,
        }],
      }) as string;
      
      setStatus('Waiting for confirmation...');
      
      // Poll for receipt
      let receipt = null;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        receipt = await window.ethereum.request({
          method: 'eth_getTransactionReceipt',
          params: [txHash],
        });
        if (receipt) break;
      }
      
      // Refresh history and balance
      await fetchChannelHistory(address);
      await fetchUSDCBalance(address);
      
      setStatus('');
      alert('Channel closed! Refund sent to your wallet.');
      
    } catch (e) {
      console.error('Failed to refund channel:', e);
      setStatus('');
      const error = e as { message?: string; code?: number };
      if (error.message?.includes('NotExpired') || error.code === -32603) {
        alert('Channel has not expired yet. Please wait until expiry to claim your refund.');
      } else {
        alert('Failed to close channel: ' + (error.message || 'Unknown error'));
      }
    } finally {
      setIsLoading(false);
    }
  };

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
        address.slice(2).toLowerCase().padStart(64, '0') + 
        DRAIN_CONTRACT.slice(2).toLowerCase().padStart(64, '0');
      
      const allowanceResult = await window.ethereum.request({
        method: 'eth_call',
        params: [{ to: USDC_ADDRESS, data: allowanceData }, 'latest'],
      }) as string;
      
      const allowance = BigInt(allowanceResult);
      
      // 2. Approve if needed
      if (allowance < amount) {
        setStatus('Approving USDC spend...');
        
        // approve(address,uint256) - approve max to avoid future approvals
        const maxApproval = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
        const approveData = '0x095ea7b3' +
          DRAIN_CONTRACT.slice(2).toLowerCase().padStart(64, '0') +
          maxApproval.toString(16).padStart(64, '0');
        
        const approveTxHash = await window.ethereum.request({
          method: 'eth_sendTransaction',
          params: [{
            from: address,
            to: USDC_ADDRESS,
            data: approveData,
          }],
        }) as string;
        
        // Wait for approval confirmation
        setStatus('Waiting for approval confirmation...');
        let approveReceipt = null;
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 2000));
          approveReceipt = await window.ethereum.request({
            method: 'eth_getTransactionReceipt',
            params: [approveTxHash],
          });
          if (approveReceipt) break;
        }
        
        if (!approveReceipt) {
          throw new Error('Approval transaction not confirmed');
        }
      }
      
      // 3. Open channel
      setStatus('Opening payment channel...');
      
      // open(address,uint256,uint256) - selector: 0x89a86ad3
      // keccak256("open(address,uint256,uint256)") = 0x89a86ad3...
      const openData = '0x89a86ad3' +
        selectedProvider.address.slice(2).toLowerCase().padStart(64, '0') +
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
      
      // Save to localStorage for history tracking
      saveChannelToStorage(channelId, selectedProvider.address);
      
      setChannel({
        id: channelId,
        deposit: amount,
        claimed: 0n,
        expiry: Math.floor(Date.now() / 1000) + Number(duration),
        spent: 0n,
        provider: selectedProvider.address,
      });
      
      setMessages([{
        role: 'system',
        content: `🎉 Payment channel opened!\n\n• Deposit: $${depositAmount} USDC\n• Provider: ${selectedProvider.name}\n• Model: ${selectedModel.name}\n• Channel: ${channelId.slice(0, 18)}...\n• Expires: ${new Date(Date.now() + Number(duration) * 1000).toLocaleString()}\n\nYou can now chat with AI. Each message costs ~$${selectedModel.costPer1k.toFixed(4)}/1K tokens.`
      }]);
      
      setVoucherNonce(0);
      setPreSignedVouchers([]);
      setUsedVoucherIndex(0);
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
      setPreSignedVouchers([]);
      setUsedVoucherIndex(0);
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
  // PRE-SIGN VOUCHERS
  // ============================================================================

  const preSignVouchers = async (count: number): Promise<PreSignedVoucher[]> => {
    if (!address || !window.ethereum || !channel) {
      throw new Error('Not connected or no channel');
    }

    const vouchers: PreSignedVoucher[] = [];
    const costPerVoucher = 10000n; // $0.01 max per message
    const currentSpent = channel.spent;

    setStatus(`Pre-signing ${count} vouchers...`);

    // Sign all vouchers in one batch popup by creating all signatures
    for (let i = 0; i < count; i++) {
      const amount = currentSpent + (BigInt(i + 1) * costPerVoucher);
      const nonce = voucherNonce + i + 1;
      
      // Check if we'd exceed deposit
      if (amount > channel.deposit) {
        setStatus(`Pre-signed ${i} vouchers (reached deposit limit)`);
        break;
      }

      setStatus(`Signing voucher ${i + 1}/${count}...`);
      
      try {
        const signature = await signVoucher(amount, nonce);
        vouchers.push({ amount, nonce, signature });
      } catch (e) {
        // User cancelled or error
        if (vouchers.length > 0) {
          setStatus(`Pre-signed ${vouchers.length} vouchers`);
          break;
        }
        throw e;
      }
    }

    return vouchers;
  };

  const startPreSignSession = async () => {
    if (!channel) return;
    
    setIsLoading(true);
    try {
      const vouchers = await preSignVouchers(preSignCount);
      setPreSignedVouchers(vouchers);
      setUsedVoucherIndex(0);
      
      if (vouchers.length > 0) {
        setMessages(prev => [...prev, {
          role: 'system',
          content: `✅ Pre-signed ${vouchers.length} vouchers!\n\nYou can now send ${vouchers.length} messages without MetaMask popups.\nMax authorized: $${formatUSDC(vouchers[vouchers.length - 1].amount)} USDC`
        }]);
      }
      setStatus('');
    } catch (e) {
      console.error('Failed to pre-sign:', e);
      setStatus('');
      alert('Failed to pre-sign vouchers: ' + (e as Error).message);
    } finally {
      setIsLoading(false);
    }
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
      
      let signature: string;
      let nextNonce: number;
      let voucherAmount: bigint;
      
      // Check if we have pre-signed vouchers available
      const remainingVouchers = preSignedVouchers.length - usedVoucherIndex;
      const usePreSigned = autoSignEnabled && remainingVouchers > 0;
      
      if (usePreSigned) {
        // Use pre-signed voucher (no popup!)
        const voucher = preSignedVouchers[usedVoucherIndex];
        signature = voucher.signature;
        nextNonce = voucher.nonce;
        voucherAmount = voucher.amount;
        setUsedVoucherIndex(prev => prev + 1);
        setStatus('Sending to AI...');
      } else if (!autoSignEnabled || preSignedVouchers.length === 0) {
        // Manual signing (will show popup)
        nextNonce = voucherNonce + 1;
        voucherAmount = newTotal;
        setStatus('Signing voucher...');
        signature = await signVoucher(voucherAmount, nextNonce);
        setStatus('Sending to AI...');
      } else {
        // Ran out of pre-signed vouchers
        setMessages(prev => [...prev, {
          role: 'system',
          content: `⚠️ Ran out of pre-signed vouchers!\n\nClick "Pre-sign More" to continue chatting without popups,\nor disable Auto-Sign to sign each message manually.`
        }]);
        setIsLoading(false);
        return;
      }
      
      // Create voucher header (JSON format as expected by provider)
      const voucherHeader = JSON.stringify({
        channelId: channel.id,
        amount: voucherAmount.toString(),
        nonce: nextNonce.toString(),
        signature: signature,
      });
      
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
      
      // Update channel state
      const actualCost = cost ? BigInt(cost) : estimatedCost;
      const actualTotal = totalSpent ? BigInt(totalSpent) : voucherAmount;
      
      setChannel(prev => prev ? {
        ...prev,
        spent: actualTotal,
      } : null);
      
      // Only update nonce for manual signing
      if (!usePreSigned) {
        setVoucherNonce(nextNonce);
      }
      
      // Show remaining pre-signed vouchers in cost
      const vouchersLeft = usePreSigned ? remainingVouchers - 1 : 0;
      const costDisplay = usePreSigned 
        ? `$${formatUSDC(actualCost)} (${vouchersLeft} pre-signed left)`
        : `$${formatUSDC(actualCost)}`;
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: assistantMessage,
        cost: costDisplay,
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
      content: '// test mode active\n\nSimulated environment - no blockchain transactions.\nConnect a wallet for real micropayments.'
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
    <div className="min-h-screen bg-[#0a0a0f] text-[#e0e0e0] bg-grid noise">
      {/* Header - Terminal Style */}
      <header className="border-b border-[#1e1e2e] sticky top-0 bg-[#0a0a0f]/95 backdrop-blur-sm z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Terminal dots */}
            <div className="terminal-dots hidden sm:flex">
              <div className="terminal-dot red"></div>
              <div className="terminal-dot yellow"></div>
              <div className="terminal-dot green"></div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold font-mono gradient-text tracking-wider">
                DRAIN
              </span>
              <span className="text-[10px] text-[#555566] hidden sm:inline font-mono uppercase tracking-widest">
                // payment_layer
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {address ? (
              <>
                {demoMode && (
                  <span className="px-2 py-0.5 bg-[#555566]/20 text-[#888899] rounded text-[10px] font-mono">
                    test
                  </span>
                )}
                {!isPolygon && !demoMode && (
                  <button
                    onClick={switchToPolygon}
                    className="px-3 py-1.5 bg-[#ffff00]/10 hover:bg-[#ffff00]/20 text-[#ffff00] border border-[#ffff00]/30 rounded text-xs font-mono transition"
                  >
                    ⚠ SWITCH_NETWORK
                  </button>
                )}
                {isPolygon && !demoMode && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0d0d14] border border-[#1e1e2e] rounded">
                    <span className="status-dot online"></span>
                    <span className="text-xs font-mono text-[#00ff9f]">
                      ${formatUSDC(usdcBalance)}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <div className="px-3 py-1.5 bg-[#0d0d14] rounded border border-[#1e1e2e] font-mono text-xs text-[#00ccff]">
                    {shortAddress}
                  </div>
                  <button
                    onClick={disconnectWallet}
                    className="p-2 hover:bg-[#1a1a24] rounded transition text-[#555566] hover:text-[#ff4444] border border-transparent hover:border-[#ff4444]/30"
                    title="Disconnect"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                  </button>
                </div>
              </>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={startDemoMode}
                  className="px-3 py-1.5 text-[#555566] hover:text-[#888899] font-mono text-[10px] transition"
                  title="Try without wallet"
                >
                  test_mode
                </button>
                <button
                  onClick={connectWallet}
                  disabled={isConnecting}
                  className="btn-primary font-mono text-xs"
                >
                  {isConnecting ? '...' : 'CONNECT'}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Not Connected - Terminal Hero */}
        {!address && (
          <div className="py-16">
            {/* ASCII Art Header */}
            <pre className="text-[#00ff9f] font-mono text-xs sm:text-sm text-center mb-8 leading-tight opacity-60">
{`
██████╗ ██████╗  █████╗ ██╗███╗   ██╗
██╔══██╗██╔══██╗██╔══██╗██║████╗  ██║
██║  ██║██████╔╝███████║██║██╔██╗ ██║
██║  ██║██╔══██╗██╔══██║██║██║╚██╗██║
██████╔╝██║  ██║██║  ██║██║██║ ╚████║
╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝
`}
            </pre>
            
            <div className="terminal-card max-w-2xl mx-auto">
              <div className="terminal-header">
                <div className="terminal-dots">
                  <div className="terminal-dot red"></div>
                  <div className="terminal-dot yellow"></div>
                  <div className="terminal-dot green"></div>
                </div>
                <span className="font-mono text-xs text-[#555566]">drain_protocol.init()</span>
              </div>
              
              <div className="p-6 space-y-4 font-mono text-sm">
                <div className="text-[#555566]">
                  <span className="text-[#00ccff]">$</span> initializing payment layer...
                </div>
                <div>
                  <span className="text-[#00ff9f]">✓</span> <span className="text-[#888899]">protocol:</span> <span className="text-[#e0e0e0]">DRAIN v1.0</span>
                </div>
                <div>
                  <span className="text-[#00ff9f]">✓</span> <span className="text-[#888899]">network:</span> <span className="text-[#e0e0e0]">Polygon Mainnet</span>
                </div>
                <div>
                  <span className="text-[#00ff9f]">✓</span> <span className="text-[#888899]">currency:</span> <span className="text-[#e0e0e0]">USDC</span>
                </div>
                <div>
                  <span className="text-[#00ff9f]">✓</span> <span className="text-[#888899]">tx_cost:</span> <span className="text-[#e0e0e0]">~$0.02</span>
                </div>
                <div className="pt-4 border-t border-[#1e1e2e]">
                  <span className="text-[#ffff00]">⚡</span> <span className="text-[#888899]">status:</span> <span className="text-[#00ff9f]">ready</span>
                </div>
                <div className="text-[#555566]">
                  <span className="text-[#00ccff]">$</span> awaiting wallet connection<span className="cursor-blink"></span>
                </div>
              </div>
            </div>
            
            <div className="flex flex-col items-center gap-3 mt-8">
              <button
                onClick={connectWallet}
                className="btn-primary font-mono px-8 py-4 text-sm"
              >
                CONNECT_WALLET
              </button>
              <button
                onClick={startDemoMode}
                className="text-[#555566] hover:text-[#888899] font-mono text-xs transition"
              >
                or try without wallet →
              </button>
            </div>
            
            <p className="text-center text-[#555566] text-xs font-mono mt-6 max-w-md mx-auto">
              // trustless micropayments for autonomous AI agents
            </p>
          </div>
        )}

        {/* Connected, No Channel */}
        {address && !channel && (
          <div className="max-w-lg mx-auto">
            <div className="terminal-card">
              <div className="terminal-header">
                <div className="terminal-dots">
                  <div className="terminal-dot red"></div>
                  <div className="terminal-dot yellow"></div>
                  <div className="terminal-dot green"></div>
                </div>
                <span className="font-mono text-xs text-[#555566]">channel.open()</span>
              </div>
              
              <div className="p-6">
                <div className="font-mono text-xs text-[#555566] mb-4">
                  // deposit USDC to initialize payment channel
                </div>
              
                <div className="space-y-6 mb-6">
                  {/* Amount Display */}
                  <div className="text-center py-4 bg-[#0a0a0f] rounded-lg border border-[#1e1e2e]">
                    <div className="text-4xl font-mono font-bold text-[#00ff9f] mb-1 text-glow-green">
                      ${parseFloat(depositAmount) || 0}
                    </div>
                    <div className="text-[#555566] text-xs font-mono uppercase tracking-wider">USDC_DEPOSIT</div>
                  </div>
                  
                  {/* Slider */}
                  <div className="space-y-2">
                    <label htmlFor="deposit-amount" className="sr-only">Deposit Amount</label>
                    <input
                      id="deposit-amount"
                      name="deposit-amount"
                      type="range"
                      min={MIN_DEPOSIT}
                      max={MAX_DEPOSIT}
                      step="0.5"
                      value={parseFloat(depositAmount) || MIN_DEPOSIT}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      className="w-full"
                      autoComplete="off"
                    />
                    <div className="flex justify-between text-xs text-[#555566] font-mono">
                      <span>${MIN_DEPOSIT}</span>
                      <span>${MAX_DEPOSIT}</span>
                    </div>
                  </div>
                  
                  {/* Quick Select */}
                  <div className="flex gap-2">
                    {['0.10', '0.50', '1', '5', '10'].map(amt => (
                      <button
                        key={amt}
                        onClick={() => setDepositAmount(amt)}
                        className={`flex-1 py-2 rounded text-xs font-mono transition border ${
                          depositAmount === amt 
                            ? 'bg-[#00ff9f]/10 text-[#00ff9f] border-[#00ff9f]/50' 
                            : 'bg-[#0d0d14] text-[#888899] border-[#1e1e2e] hover:border-[#00ff9f]/30'
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
                <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg p-3">
                  <label htmlFor="provider-select" className="text-[10px] text-[#555566] block mb-2 font-mono uppercase tracking-wider">PROVIDER</label>
                  <select
                    id="provider-select"
                    name="provider-select"
                    value={selectedProvider.id}
                    onChange={(e) => {
                      const provider = PROVIDERS.find(p => p.id === e.target.value)!;
                      setSelectedProvider(provider);
                      setSelectedModel(provider.models[0]);
                    }}
                    className="w-full bg-[#0d0d14] border border-[#1e1e2e] rounded px-3 py-2 text-[#e0e0e0] font-mono text-sm outline-none focus:border-[#00ff9f]"
                  >
                    {PROVIDERS.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                
                {/* Model Selection */}
                <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg p-3">
                  <label className="text-[10px] text-[#555566] block mb-2 font-mono uppercase tracking-wider">MODEL</label>
                  <div className="grid grid-cols-2 gap-2">
                    {selectedProvider.models.map(model => (
                      <button
                        key={model.id}
                        onClick={() => setSelectedModel(model)}
                        className={`p-3 rounded text-left transition font-mono border ${
                          selectedModel.id === model.id
                            ? 'bg-[#00ff9f]/10 border-[#00ff9f]/50 text-[#00ff9f]'
                            : 'bg-[#0d0d14] border-[#1e1e2e] text-[#888899] hover:border-[#00ff9f]/30'
                        }`}
                      >
                        <div className="text-xs font-medium">{model.name}</div>
                        <div className="text-[10px] opacity-60">${model.costPer1k.toFixed(4)}/1K</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Data Display - Terminal Style */}
              <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg p-4 mb-6 font-mono text-sm">
                <div className="text-[10px] text-[#555566] mb-3 uppercase tracking-wider">// estimates</div>
                <div className="space-y-2">
                  <div className="data-row">
                    <span className="data-label">messages</span>
                    <span className="data-value positive">~{Math.floor((parseFloat(depositAmount) || 0) / selectedModel.costPer1k).toLocaleString()}</span>
                  </div>
                  <div className="data-row">
                    <span className="data-label">cost_per_1k</span>
                    <span className="data-value">${selectedModel.costPer1k.toFixed(4)}</span>
                  </div>
                  <div className="data-row">
                    <span className="data-label">provider</span>
                    <span className="data-value text-[#00ccff]">{selectedProvider.address.slice(0, 10)}...</span>
                  </div>
                  <div className="data-row">
                    <span className="data-label">network</span>
                    <span className="data-value">polygon</span>
                  </div>
                  <div className="data-row">
                    <span className="data-label">duration</span>
                    <span className="data-value">24h</span>
                  </div>
                </div>
              </div>
              
              <button
                onClick={openChannel}
                disabled={isLoading || (!isPolygon && !demoMode) || parseUSDC(depositAmount) === 0n || (!demoMode && usdcBalance < parseUSDC(depositAmount))}
                className="w-full btn-primary py-4 font-mono text-sm disabled:opacity-50"
              >
                {isLoading ? status || 'PROCESSING...' : `OPEN_CHANNEL($${parseFloat(depositAmount) || 0})`}
              </button>
              
              {!isPolygon && !demoMode && (
                <button
                  onClick={switchToPolygon}
                  className="w-full mt-3 py-2 bg-[#ffff00]/10 hover:bg-[#ffff00]/20 text-[#ffff00] border border-[#ffff00]/30 rounded text-xs font-mono"
                >
                  ⚠ SWITCH_TO_POLYGON
                </button>
              )}
              
              {isPolygon && !demoMode && usdcBalance < parseUSDC(depositAmount) && parseUSDC(depositAmount) > 0n && (
                <p className="text-[#ff4444] text-xs mt-3 text-center font-mono">
                  ERROR: insufficient_balance ({formatUSDC(usdcBalance)} available)
                </p>
              )}
        </div>
          </div>
            
            {/* Channel History Section */}
            {!demoMode && (
              <div className="mt-6 terminal-card">
                <div className="terminal-header justify-between">
                  <div className="flex items-center gap-3">
                    <div className="terminal-dots">
                      <div className="terminal-dot red"></div>
                      <div className="terminal-dot yellow"></div>
                      <div className="terminal-dot green"></div>
                    </div>
                    <span className="font-mono text-xs text-[#555566]">channels.history()</span>
                  </div>
                  {channelHistory.filter(c => c.status === 'expired').length > 0 && (
                    <span className="px-2 py-0.5 bg-[#ffff00]/10 text-[#ffff00] border border-[#ffff00]/30 rounded text-[10px] font-mono animate-pulse">
                      {channelHistory.filter(c => c.status === 'expired').length} REFUNDABLE
                    </span>
                  )}
                </div>
                
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className="w-full p-3 flex items-center justify-between text-left hover:bg-[#1a1a24] transition"
                >
                  <span className="font-mono text-sm text-[#888899]">
                    {channelHistory.length} channel(s) found
                  </span>
                  <svg 
                    className={`w-4 h-4 text-[#555566] transition-transform ${showHistory ? 'rotate-180' : ''}`} 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {showHistory && (
                  <div className="p-4 space-y-3 border-t border-[#1e1e2e]">
                    {isLoadingHistory ? (
                      <div className="text-center py-6 font-mono text-sm">
                        <div className="text-[#00ff9f] animate-pulse">⏳ fetching_channels...</div>
                      </div>
                    ) : channelHistory.length === 0 ? (
                      <div className="text-center py-6 font-mono text-sm text-[#555566]">
                        <div>// no channels found</div>
                        <div className="mt-1 text-[10px]">open your first channel above</div>
                      </div>
                    ) : (
                      <>
                        {/* Refundable Channels First */}
                        {channelHistory.filter(c => c.status === 'expired').map(ch => (
                          <div key={ch.id} className="bg-[#ffff00]/5 border border-[#ffff00]/30 rounded p-4 font-mono">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <span className="status-dot warning"></span>
                                <span className="text-xs text-[#ffff00]">EXPIRED // refund_available</span>
                              </div>
                              <span className="text-[10px] text-[#555566]">{ch.id.slice(0, 10)}...</span>
                            </div>
                            <div className="space-y-1 mb-3 text-xs">
                              <div className="data-row">
                                <span className="data-label">deposit</span>
                                <span className="data-value">${formatUSDC(ch.deposit)}</span>
                              </div>
                              <div className="data-row">
                                <span className="data-label">refundable</span>
                                <span className="data-value positive">${formatUSDC(ch.refundable)}</span>
                              </div>
                              <div className="data-row">
                                <span className="data-label">expired</span>
                                <span className="data-value text-[#888899]">{new Date(ch.expiry * 1000).toLocaleString()}</span>
                              </div>
                            </div>
                            <button
                              onClick={() => refundChannel(ch.id)}
                              disabled={isLoading}
                              className="w-full py-2 bg-[#ffff00] hover:bg-[#cccc00] disabled:bg-[#1e1e2e] text-black font-semibold rounded text-xs transition"
                            >
                              {isLoading ? 'PROCESSING...' : `CLAIM_REFUND($${formatUSDC(ch.refundable)})`}
                            </button>
                          </div>
                        ))}
                        
                        {/* Active Channels */}
                        {channelHistory.filter(c => c.status === 'active').map(ch => {
                          const now = Math.floor(Date.now() / 1000);
                          const remaining = ch.expiry - now;
                          const hours = Math.floor(remaining / 3600);
                          const minutes = Math.floor((remaining % 3600) / 60);
                          
                          return (
                            <div key={ch.id} className="bg-[#0a0a0f] border border-[#1e1e2e] rounded p-4 font-mono">
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                  <span className="status-dot online"></span>
                                  <span className="text-xs text-[#00ff9f]">ACTIVE</span>
                                </div>
                                <span className="text-[10px] text-[#555566]">{ch.id.slice(0, 10)}...</span>
                              </div>
                              <div className="grid grid-cols-3 gap-3 text-xs">
                                <div>
                                  <div className="text-[#555566] text-[10px] uppercase">deposit</div>
                                  <div className="text-[#e0e0e0]">${formatUSDC(ch.deposit)}</div>
                                </div>
                                <div>
                                  <div className="text-[#555566] text-[10px] uppercase">used</div>
                                  <div className="text-[#ff00ff]">${formatUSDC(ch.claimed)}</div>
                                </div>
                                <div>
                                  <div className="text-[#555566] text-[10px] uppercase">ttl</div>
                                  <div className="text-[#e0e0e0]">{hours}h {minutes}m</div>
                                </div>
                              </div>
                              <button
                                onClick={() => {
                                  setChannel({
                                    id: ch.id,
                                    deposit: ch.deposit,
                                    claimed: ch.claimed,
                                    expiry: ch.expiry,
                                    spent: ch.claimed,
                                    provider: ch.provider,
                                  });
                                  setMessages([{
                                    role: 'system',
                                    content: `📡 Reconnected to channel ${ch.id.slice(0, 10)}...\n\nRemaining: $${formatUSDC(ch.deposit - ch.claimed)} USDC\nExpires: ${new Date(ch.expiry * 1000).toLocaleString()}`
                                  }]);
                                }}
                                className="w-full mt-3 py-2 bg-[#00ff9f]/10 hover:bg-[#00ff9f]/20 text-[#00ff9f] border border-[#00ff9f]/30 rounded text-xs transition"
                              >
                                RESUME_CHANNEL
                              </button>
                            </div>
                          );
                        })}
                        
                        {/* Closed Channels */}
                        {channelHistory.filter(c => c.status === 'closed').length > 0 && (
                          <div className="pt-3 border-t border-[#1e1e2e]">
                            <div className="text-[10px] text-[#555566] mb-2 font-mono uppercase tracking-wider">// closed</div>
                            {channelHistory.filter(c => c.status === 'closed').slice(0, 3).map(ch => (
                              <div key={ch.id} className="flex items-center justify-between py-2 text-xs text-[#555566] font-mono">
                                <span>{ch.id.slice(0, 10)}...</span>
                                <span>${formatUSDC(ch.deposit)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    
                    <button
                      onClick={() => address && fetchChannelHistory(address)}
                      disabled={isLoadingHistory}
                      className="w-full py-2 bg-[#0d0d14] hover:bg-[#1a1a24] text-[#555566] hover:text-[#00ccff] border border-[#1e1e2e] rounded text-xs font-mono transition"
                    >
                      {isLoadingHistory ? 'LOADING...' : '↻ REFRESH'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Chat Interface */}
        {address && channel && (
          <div className="flex flex-col h-[calc(100vh-160px)]">
            {/* Status Bar - Terminal Style */}
            <div className="terminal-card mb-4">
              <div className="terminal-header">
                <div className="flex items-center gap-3">
                  <div className="terminal-dots">
                    <div className="terminal-dot red"></div>
                    <div className="terminal-dot yellow"></div>
                    <div className="terminal-dot green"></div>
                  </div>
                  <span className="font-mono text-xs text-[#555566]">session.active()</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="status-dot online"></span>
                  <span className="font-mono text-xs text-[#00ff9f]">LIVE</span>
                </div>
              </div>
              
              <div className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center gap-3 flex-wrap font-mono text-xs">
                    <span className="text-[#888899]">{selectedProvider.name}</span>
                    <span className="px-2 py-0.5 bg-[#ff00ff]/10 text-[#ff00ff] border border-[#ff00ff]/30 rounded">
                      {selectedModel.name}
                    </span>
                    {/* Expiry Timer */}
                    {!demoMode && (
                      <ExpiryBadge expiry={channel.expiry} />
                    )}
                    {/* Close/Refund Button */}
                    {demoMode ? (
                      <button
                        onClick={() => { setChannel(null); setMessages([]); }}
                        disabled={isLoading}
                        className="px-3 py-1 bg-[#1e1e2e] hover:bg-[#2a2a3e] text-[#888899] border border-[#1e1e2e] rounded text-[10px] font-mono transition"
                      >
                        exit
                      </button>
                    ) : (
                      <ChannelActionButton 
                        channel={channel}
                        remaining={remaining}
                        isLoading={isLoading}
                        onClose={closeChannel}
                        onExit={() => {
                          // Save channel ID to show in history
                          if (address) {
                            fetchChannelHistory(address);
                          }
                          setChannel(null);
                          setMessages([]);
                          setVoucherNonce(0);
                          setPreSignedVouchers([]);
                          setUsedVoucherIndex(0);
                          setShowHistory(true); // Show history panel
                        }}
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-6 font-mono text-xs">
                    <div className="text-center">
                      <div className="text-[#00ff9f] text-lg font-bold text-glow-green">${formatUSDC(remaining)}</div>
                      <div className="text-[10px] text-[#555566] uppercase tracking-wider">balance</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[#ff00ff] text-lg font-bold">${formatUSDC(channel.spent)}</div>
                      <div className="text-[10px] text-[#555566] uppercase tracking-wider">spent</div>
                    </div>
                  </div>
                </div>
                
                {/* Progress bar */}
                <div className="mt-4 h-1 bg-[#1e1e2e] rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-[#00ff9f] to-[#ff00ff] transition-all"
                    style={{ width: `${Number(channel.spent) / Number(channel.deposit) * 100}%` }}
                  />
                </div>
              </div>
              
              {/* Auto-Sign Panel */}
              {!demoMode && (
                <div className="px-4 pb-4 pt-2 border-t border-[#1e1e2e]">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    {/* Toggle */}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setAutoSignEnabled(!autoSignEnabled)}
                        className={`relative w-10 h-5 rounded-full transition-colors ${
                          autoSignEnabled ? 'bg-[#00ff9f]' : 'bg-[#1e1e2e]'
                        }`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 bg-[#0a0a0f] rounded-full transition-transform border ${
                          autoSignEnabled ? 'left-5 border-[#00ff9f]' : 'left-0.5 border-[#555566]'
                        }`} />
                      </button>
                      <div className="font-mono text-xs">
                        <div className={autoSignEnabled ? 'text-[#00ff9f]' : 'text-[#888899]'}>
                          {autoSignEnabled ? 'AUTO_SIGN' : 'MANUAL_SIGN'}
        </div>
                        <div className="text-[10px] text-[#555566]">
                          {autoSignEnabled ? 'batch signing enabled' : 'sign each tx'}
                        </div>
                      </div>
                    </div>
                    
                    {/* Pre-Sign Controls */}
                    {autoSignEnabled && (
                      <div className="flex items-center gap-3">
                        {/* Voucher Count Display */}
                        <div className="text-center px-3 font-mono">
                          <div className={`text-lg font-bold ${
                            preSignedVouchers.length - usedVoucherIndex > 0 
                              ? 'text-[#00ff9f]' 
                              : 'text-[#ffff00]'
                          }`}>
                            {preSignedVouchers.length - usedVoucherIndex}
                          </div>
                          <div className="text-[10px] text-[#555566] uppercase">vouchers</div>
                        </div>
                        
                        {/* Slider for count */}
                        <div className="flex items-center gap-2">
                          <label htmlFor="presign-count" className="sr-only">Pre-sign voucher count</label>
                          <input
                            id="presign-count"
                            name="presign-count"
                            type="range"
                            min="5"
                            max="50"
                            step="5"
                            value={preSignCount}
                            onChange={(e) => setPreSignCount(parseInt(e.target.value))}
                            className="w-16"
                            autoComplete="off"
                          />
                          <span className="text-xs text-[#888899] font-mono w-6">{preSignCount}</span>
                        </div>
                        
                        {/* Pre-Sign Button */}
                        <button
                          onClick={startPreSignSession}
                          disabled={isLoading}
                          className="px-3 py-1.5 bg-[#ff00ff]/10 hover:bg-[#ff00ff]/20 border border-[#ff00ff]/30 text-[#ff00ff] font-mono text-xs rounded transition flex items-center gap-2"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                          {preSignedVouchers.length > 0 ? 'SIGN_MORE' : `SIGN(${preSignCount})`}
                        </button>
                      </div>
                    )}
                  </div>
                  
                  {/* Help Text */}
                  {autoSignEnabled && preSignedVouchers.length === 0 && (
                    <div className="mt-3 p-3 bg-[#ffff00]/5 border border-[#ffff00]/20 rounded font-mono text-xs">
                      <p className="text-[#ffff00]">
                        // tip: pre-sign {preSignCount} vouchers for seamless chat</p>
        </div>
                  )}
                </div>
              )}
            </div>

            {/* Messages - Terminal Output */}
            <div className="flex-1 terminal-card overflow-hidden">
              <div className="terminal-header">
                <div className="terminal-dots">
                  <div className="terminal-dot red"></div>
                  <div className="terminal-dot yellow"></div>
                  <div className="terminal-dot green"></div>
                </div>
                <span className="font-mono text-xs text-[#555566]">output.log</span>
              </div>
              <div className="p-4 overflow-y-auto h-[calc(100%-40px)] space-y-4">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`max-w-[85%] animate-fadeIn ${
                      msg.role === 'user' ? 'ml-auto' : 
                      msg.role === 'system' ? 'mx-auto max-w-[95%]' : ''
                    }`}
                  >
                    <div className={`p-4 rounded font-mono text-sm ${
                      msg.role === 'user' 
                        ? 'bg-[#00ff9f]/10 border border-[#00ff9f]/30 text-[#00ff9f]' 
                        : msg.role === 'system'
                        ? 'bg-[#0a0a0f] border border-[#1e1e2e] text-center text-[#555566]'
                        : 'bg-[#0d0d14] border border-[#1e1e2e] text-[#e0e0e0]'
                    }`}>
                      {msg.role === 'user' && (
                        <div className="text-[10px] text-[#555566] mb-1">{'>'} user</div>
                      )}
                      {msg.role === 'assistant' && (
                        <div className="text-[10px] text-[#ff00ff] mb-1">{'<'} ai</div>
                      )}
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                      {msg.cost && (
                        <div className="text-[10px] text-[#555566] mt-2 text-right">// cost: {msg.cost}</div>
                      )}
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex items-center gap-2 text-[#00ccff] font-mono text-sm">
                    <span className="animate-pulse">▊</span>
                    <span>{status || 'processing...'}</span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Input - Command Line */}
            <div className="mt-4 flex gap-3">
              <label htmlFor="chat-input" className="sr-only">Message</label>
              <div className="flex-1 flex items-center bg-[#0d0d14] border border-[#1e1e2e] rounded px-4 py-3 focus-within:border-[#00ff9f] transition">
                <span className="text-[#00ff9f] font-mono text-sm mr-2">{'>'}</span>
                <input
                  id="chat-input"
                  name="chat-input"
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (demoMode ? sendDemoMessage() : sendMessage())}
                  placeholder="enter message..."
                  disabled={isLoading}
                  autoComplete="off"
                  className="flex-1 bg-transparent outline-none font-mono text-sm text-[#e0e0e0] placeholder:text-[#555566]"
                />
              </div>
              <button
                onClick={demoMode ? sendDemoMessage : sendMessage}
                disabled={isLoading || !input.trim()}
                className="btn-primary px-6 py-3 font-mono text-sm"
              >
                SEND
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-[#1e1e2e] py-4 mt-auto bg-[#0a0a0f]">
        <div className="max-w-6xl mx-auto px-4 text-center font-mono text-xs text-[#555566]">
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <a href="/directory" className="hover:text-[#00ff9f] transition">providers</a>
            <span className="text-[#1e1e2e]">|</span>
            <a href={`https://polygonscan.com/address/${DRAIN_CONTRACT}`} className="hover:text-[#00ff9f] transition">contract</a>
            <span className="text-[#1e1e2e]">|</span>
            <a href={`${selectedProvider.url}/v1/pricing`} className="hover:text-[#00ff9f] transition">api</a>
            <span className="text-[#1e1e2e]">|</span>
            <a href="https://github.com/kimbo128/DRAIN" className="hover:text-[#00ff9f] transition">github</a>
          </div>
          <div className="mt-2 text-[10px]">DRAIN © 2026</div>
        </div>
      </footer>
    </div>
  );
}
