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
  
  // Channel history
  const [channelHistory, setChannelHistory] = useState<ChannelHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  
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
  // CHANNEL HISTORY
  // ============================================================================

  const fetchChannelHistory = async (userAddress: string) => {
    setIsLoadingHistory(true);
    try {
      // ChannelOpened event topic: keccak256("ChannelOpened(bytes32,address,address,uint256,uint256)")
      // = 0x506f81b7a67b45bfbc6167fd087b3dd9b65b4531a2380ec406aab5b57ac62152
      const eventTopic = '0x506f81b7a67b45bfbc6167fd087b3dd9b65b4531a2380ec406aab5b57ac62152';
      const paddedAddress = '0x' + userAddress.slice(2).toLowerCase().padStart(64, '0');
      
      // Query logs for ChannelOpened events where consumer (topic2) is the user
      const response = await fetch('https://polygon-rpc.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getLogs',
          params: [{
            address: DRAIN_CONTRACT,
            topics: [eventTopic, null, paddedAddress], // topic0=event, topic1=channelId, topic2=consumer
            fromBlock: '0x0',
            toBlock: 'latest',
          }],
          id: 1,
        }),
      });
      
      const json = await response.json();
      const logs = json.result || [];
      
      // Parse each log and check channel status
      const channels: ChannelHistoryItem[] = [];
      
      for (const log of logs) {
        const channelId = log.topics[1];
        const provider = '0x' + log.topics[3].slice(26); // Extract provider from topic3
        
        // Get current channel state
        const channelData = await getChannelState(channelId);
        
        if (channelData) {
          const now = Math.floor(Date.now() / 1000);
          const isExpired = now >= channelData.expiry;
          const isClosed = channelData.consumer === '0x0000000000000000000000000000000000000000';
          
          let status: 'active' | 'expired' | 'closed';
          if (isClosed) {
            status = 'closed';
          } else if (isExpired) {
            status = 'expired';
          } else {
            status = 'active';
          }
          
          channels.push({
            id: channelId,
            provider: provider,
            deposit: channelData.deposit,
            claimed: channelData.claimed,
            expiry: channelData.expiry,
            status,
            refundable: channelData.deposit - channelData.claimed,
          });
        }
      }
      
      // Sort by expiry (newest first)
      channels.sort((a, b) => b.expiry - a.expiry);
      
      setChannelHistory(channels);
    } catch (e) {
      console.error('Failed to fetch channel history:', e);
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
                <div className="flex items-center gap-2">
                  <div className="px-3 py-1.5 bg-[#1a1a1a] rounded-lg border border-[#333] font-mono text-sm text-gray-300">
                    {shortAddress}
                  </div>
                  <button
                    onClick={disconnectWallet}
                    className="p-1.5 hover:bg-[#333] rounded-lg transition text-gray-500 hover:text-white"
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
                  {['0.10', '0.50', '1', '5', '10'].map(amt => (
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
            
            {/* Channel History Section */}
            {!demoMode && (
              <div className="mt-6 bg-[#111] border border-[#222] rounded-2xl p-6">
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className="w-full flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-bold">Your Channels</h3>
                    {channelHistory.filter(c => c.status === 'expired').length > 0 && (
                      <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-xs font-medium animate-pulse">
                        {channelHistory.filter(c => c.status === 'expired').length} refundable
                      </span>
                    )}
                  </div>
                  <svg 
                    className={`w-5 h-5 text-gray-400 transition-transform ${showHistory ? 'rotate-180' : ''}`} 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {showHistory && (
                  <div className="mt-4 space-y-3">
                    {isLoadingHistory ? (
                      <div className="text-center py-8 text-gray-500">
                        <div className="animate-spin inline-block w-6 h-6 border-2 border-gray-500 border-t-transparent rounded-full mb-2"></div>
                        <p className="text-sm">Loading channels...</p>
                      </div>
                    ) : channelHistory.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        <p className="text-sm">No channels found</p>
                        <p className="text-xs mt-1">Open your first channel above!</p>
                      </div>
                    ) : (
                      <>
                        {/* Refundable Channels First */}
                        {channelHistory.filter(c => c.status === 'expired').map(ch => (
                          <div key={ch.id} className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-yellow-400"></span>
                                <span className="text-sm font-medium text-yellow-400">Expired - Refund Available!</span>
                              </div>
                              <span className="text-xs text-gray-500 font-mono">{ch.id.slice(0, 10)}...</span>
                            </div>
                            <div className="grid grid-cols-2 gap-4 mb-3 text-sm">
                              <div>
                                <div className="text-gray-500 text-xs">Deposit</div>
                                <div className="font-mono">${formatUSDC(ch.deposit)}</div>
                              </div>
                              <div>
                                <div className="text-gray-500 text-xs">Refundable</div>
                                <div className="font-mono text-[#00D395]">${formatUSDC(ch.refundable)}</div>
                              </div>
                            </div>
                            <div className="text-xs text-gray-500 mb-3">
                              Expired: {new Date(ch.expiry * 1000).toLocaleString()}
                            </div>
                            <button
                              onClick={() => refundChannel(ch.id)}
                              disabled={isLoading}
                              className="w-full py-2 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-700 text-black font-semibold rounded-lg transition"
                            >
                              {isLoading ? 'Processing...' : `Claim $${formatUSDC(ch.refundable)} Refund`}
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
                            <div key={ch.id} className="bg-[#0a0a0a] border border-[#333] rounded-xl p-4">
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-[#00D395] animate-pulse"></span>
                                  <span className="text-sm font-medium">Active</span>
                                </div>
                                <span className="text-xs text-gray-500 font-mono">{ch.id.slice(0, 10)}...</span>
                              </div>
                              <div className="grid grid-cols-3 gap-4 text-sm">
                                <div>
                                  <div className="text-gray-500 text-xs">Deposit</div>
                                  <div className="font-mono">${formatUSDC(ch.deposit)}</div>
                                </div>
                                <div>
                                  <div className="text-gray-500 text-xs">Used</div>
                                  <div className="font-mono text-[#7B61FF]">${formatUSDC(ch.claimed)}</div>
                                </div>
                                <div>
                                  <div className="text-gray-500 text-xs">Expires in</div>
                                  <div className="font-mono">{hours}h {minutes}m</div>
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
                                className="w-full mt-3 py-2 bg-[#00D395]/20 hover:bg-[#00D395]/30 text-[#00D395] font-medium rounded-lg transition text-sm"
                              >
                                Continue Using This Channel
                              </button>
                            </div>
                          );
                        })}
                        
                        {/* Closed Channels */}
                        {channelHistory.filter(c => c.status === 'closed').length > 0 && (
                          <div className="pt-4 border-t border-[#222]">
                            <div className="text-xs text-gray-500 mb-2">Closed Channels</div>
                            {channelHistory.filter(c => c.status === 'closed').slice(0, 3).map(ch => (
                              <div key={ch.id} className="flex items-center justify-between py-2 text-sm text-gray-500">
                                <span className="font-mono">{ch.id.slice(0, 10)}...</span>
                                <span>${formatUSDC(ch.deposit)} deposit</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    
                    <button
                      onClick={() => address && fetchChannelHistory(address)}
                      disabled={isLoadingHistory}
                      className="w-full py-2 bg-[#1a1a1a] hover:bg-[#222] text-gray-400 rounded-lg text-sm transition"
                    >
                      {isLoadingHistory ? 'Loading...' : '↻ Refresh'}
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
            {/* Status Bar */}
            <div className="bg-[#111] border border-[#222] rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="w-2 h-2 rounded-full bg-[#00D395] animate-pulse"></div>
                  <span className="text-sm text-gray-400">{selectedProvider.name}</span>
                  <span className="px-2 py-0.5 bg-[#7B61FF]/20 text-[#7B61FF] rounded text-xs font-medium">
                    {selectedModel.name}
                  </span>
                  {/* Expiry Timer */}
                  {!demoMode && (() => {
                    const now = Math.floor(Date.now() / 1000);
                    const remaining = channel.expiry - now;
                    const isExpired = remaining <= 0;
                    const hours = Math.floor(Math.abs(remaining) / 3600);
                    const minutes = Math.floor((Math.abs(remaining) % 3600) / 60);
                    
                    return (
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        isExpired 
                          ? 'bg-yellow-500/20 text-yellow-400' 
                          : 'bg-gray-500/20 text-gray-400'
                      }`}>
                        {isExpired ? '⏰ Expired' : `⏱️ ${hours}h ${minutes}m left`}
                      </span>
                    );
                  })()}
                  {/* Close/Refund Button */}
                  {demoMode ? (
                    <button
                      onClick={() => { setChannel(null); setMessages([]); }}
                      disabled={isLoading}
                      className="px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-xs font-medium transition"
                    >
                      Close Demo
                    </button>
                  ) : (() => {
                    const now = Math.floor(Date.now() / 1000);
                    const isExpired = now >= channel.expiry;
                    
                    return isExpired ? (
                      <button
                        onClick={closeChannel}
                        disabled={isLoading}
                        className="px-3 py-1 bg-yellow-500 hover:bg-yellow-400 text-black rounded-lg text-xs font-semibold transition"
                      >
                        Claim Refund (${formatUSDC(remaining)})
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setChannel(null);
                          setMessages([]);
                          setVoucherNonce(0);
                          setPreSignedVouchers([]);
                          setUsedVoucherIndex(0);
                        }}
                        className="px-3 py-1 bg-gray-500/20 hover:bg-gray-500/30 text-gray-400 rounded-lg text-xs font-medium transition"
                        title="Channel will remain open. Return later to claim refund after expiry."
                      >
                        Exit (keep channel)
                      </button>
                    );
                  })()}
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
              
              {/* Auto-Sign Panel */}
              {!demoMode && (
                <div className="mt-4 pt-4 border-t border-[#222]">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    {/* Toggle */}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setAutoSignEnabled(!autoSignEnabled)}
                        className={`relative w-12 h-6 rounded-full transition-colors ${
                          autoSignEnabled ? 'bg-[#00D395]' : 'bg-[#333]'
                        }`}
                      >
                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                          autoSignEnabled ? 'left-7' : 'left-1'
                        }`} />
                      </button>
                      <div>
                        <div className="text-sm font-medium">
                          {autoSignEnabled ? 'Auto-Sign' : 'Manual Sign'}
                        </div>
                        <div className="text-xs text-gray-500">
                          {autoSignEnabled 
                            ? 'No popups per message' 
                            : 'Sign each message manually'}
                        </div>
                      </div>
                    </div>
                    
                    {/* Pre-Sign Controls */}
                    {autoSignEnabled && (
                      <div className="flex items-center gap-3">
                        {/* Voucher Count Display */}
                        <div className="text-center px-3">
                          <div className={`text-lg font-bold ${
                            preSignedVouchers.length - usedVoucherIndex > 0 
                              ? 'text-[#00D395]' 
                              : 'text-yellow-400'
                          }`}>
                            {preSignedVouchers.length - usedVoucherIndex}
                          </div>
                          <div className="text-xs text-gray-500">vouchers left</div>
                        </div>
                        
                        {/* Slider for count */}
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="5"
                            max="50"
                            step="5"
                            value={preSignCount}
                            onChange={(e) => setPreSignCount(parseInt(e.target.value))}
                            className="w-20 h-1.5 bg-[#222] rounded-lg appearance-none cursor-pointer accent-[#7B61FF]"
                          />
                          <span className="text-xs text-gray-400 w-6">{preSignCount}</span>
                        </div>
                        
                        {/* Pre-Sign Button */}
                        <button
                          onClick={startPreSignSession}
                          disabled={isLoading}
                          className="px-4 py-2 bg-[#7B61FF] hover:bg-[#6B51EF] disabled:bg-gray-700 text-white font-medium rounded-lg text-sm transition flex items-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                          {preSignedVouchers.length > 0 ? 'Sign More' : `Sign ${preSignCount}`}
                        </button>
                      </div>
                    )}
                  </div>
                  
                  {/* Help Text */}
                  {autoSignEnabled && preSignedVouchers.length === 0 && (
                    <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                      <p className="text-xs text-yellow-400">
                        💡 <strong>Tip:</strong> Click "Sign {preSignCount}" to pre-authorize {preSignCount} messages. 
                        You'll sign once, then chat without MetaMask popups!
          </p>
        </div>
                  )}
                </div>
              )}
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
