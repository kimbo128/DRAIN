/**
 * DRAIN Consumer SDK
 * 
 * For users who want to pay for AI services via payment channels.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Account,
} from 'viem';
import { polygon, polygonAmoy } from 'viem/chains';
import {
  DRAIN_ADDRESSES,
  USDC_ADDRESSES,
  USDC_DECIMALS,
  DRAIN_CHANNEL_ABI,
  ERC20_ABI,
  EIP712_DOMAIN,
} from './constants';
import type {
  Channel,
  Voucher,
  UnsignedVoucher,
  OpenChannelOptions,
  OpenChannelResult,
  DrainConfig,
  SupportedChainId,
  VoucherTypedData,
} from './types';

/**
 * Parse duration string to seconds
 * Supports: "1h", "24h", "7d", "30m", or raw seconds
 */
function parseDuration(duration: number | string): number {
  if (typeof duration === 'number') return duration;
  
  const match = duration.match(/^(\d+)(s|m|h|d)$/);
  if (!match) throw new Error(`Invalid duration format: ${duration}`);
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: throw new Error(`Unknown duration unit: ${unit}`);
  }
}

/**
 * Get chain from chainId
 */
function getChain(chainId: SupportedChainId) {
  return chainId === 137 ? polygon : polygonAmoy;
}

/**
 * DRAIN Consumer Client
 * 
 * Handles channel opening, voucher signing, and channel closing.
 */
export class DrainConsumer {
  private publicClient: PublicClient;
  private walletClient: WalletClient;
  private account: Account;
  private chainId: SupportedChainId;
  private contractAddress: Address;
  private usdcAddress: Address;
  
  // Track nonces per channel for voucher signing
  private voucherNonces: Map<Hash, bigint> = new Map();

  constructor(
    walletClient: WalletClient,
    account: Account,
    config: DrainConfig
  ) {
    this.walletClient = walletClient;
    this.account = account;
    this.chainId = config.chainId;
    
    const chain = getChain(config.chainId);
    
    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    });
    
    this.contractAddress = config.contractAddress ?? DRAIN_ADDRESSES[config.chainId];
    this.usdcAddress = config.usdcAddress ?? USDC_ADDRESSES[config.chainId];
  }

  /**
   * Get USDC balance for the consumer
   */
  async getUsdcBalance(): Promise<string> {
    const balance = await this.publicClient.readContract({
      address: this.usdcAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [this.account.address],
    });
    return formatUnits(balance, USDC_DECIMALS);
  }

  /**
   * Approve USDC spending for the DRAIN contract
   */
  async approveUsdc(amount: string): Promise<Hash> {
    const amountWei = parseUnits(amount, USDC_DECIMALS);
    
    const hash = await this.walletClient.writeContract({
      account: this.account,
      address: this.usdcAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [this.contractAddress, amountWei],
      chain: getChain(this.chainId),
    });
    
    return hash;
  }

  /**
   * Check current USDC allowance
   */
  async getAllowance(): Promise<string> {
    const allowance = await this.publicClient.readContract({
      address: this.usdcAddress,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [this.account.address, this.contractAddress],
    });
    return formatUnits(allowance, USDC_DECIMALS);
  }

  /**
   * Open a payment channel
   * 
   * @param options - Channel options (provider, amount, duration)
   * @returns Channel ID and transaction hash
   */
  async openChannel(options: OpenChannelOptions): Promise<OpenChannelResult> {
    const { provider, amount, duration } = options;
    
    const amountWei = parseUnits(amount, USDC_DECIMALS);
    const durationSeconds = parseDuration(duration);
    
    // Check allowance first
    const allowance = await this.publicClient.readContract({
      address: this.usdcAddress,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [this.account.address, this.contractAddress],
    });
    
    if (allowance < amountWei) {
      throw new Error(
        `Insufficient USDC allowance. Have: ${formatUnits(allowance, USDC_DECIMALS)}, need: ${amount}. ` +
        `Call approveUsdc() first.`
      );
    }
    
    // Open the channel
    const hash = await this.walletClient.writeContract({
      account: this.account,
      address: this.contractAddress,
      abi: DRAIN_CHANNEL_ABI,
      functionName: 'open',
      args: [provider as Address, amountWei, BigInt(durationSeconds)],
      chain: getChain(this.chainId),
    });
    
    // Wait for transaction and get channel ID from event
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    
    // Find ChannelOpened event
    const openedEvent = receipt.logs.find(log => {
      // ChannelOpened event topic
      return log.topics[0] === '0x506f81b7a67b45bfbc6167fd087b3dd9b65b4531a2380ec406aab5b57ac62152';
    });
    
    if (!openedEvent || !openedEvent.topics[1]) {
      throw new Error('Could not find ChannelOpened event');
    }
    
    const channelId = openedEvent.topics[1] as Hash;
    
    // Initialize voucher nonce for this channel
    this.voucherNonces.set(channelId, 0n);
    
    // Get channel details
    const channel = await this.getChannel(channelId);
    
    return {
      channelId,
      txHash: hash,
      channel,
    };
  }

  /**
   * Get channel details
   */
  async getChannel(channelId: Hash): Promise<Channel> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: DRAIN_CHANNEL_ABI,
      functionName: 'getChannel',
      args: [channelId],
    });
    
    return {
      id: channelId,
      consumer: result.consumer,
      provider: result.provider,
      deposit: result.deposit,
      claimed: result.claimed,
      expiry: result.expiry,
    };
  }

  /**
   * Get remaining balance in channel
   */
  async getChannelBalance(channelId: Hash): Promise<string> {
    const balance = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: DRAIN_CHANNEL_ABI,
      functionName: 'getBalance',
      args: [channelId],
    });
    return formatUnits(balance, USDC_DECIMALS);
  }

  /**
   * Sign a voucher for payment
   * 
   * @param channelId - Channel to pay from
   * @param amount - CUMULATIVE amount (total spent, not incremental)
   * @returns Signed voucher
   */
  async signVoucher(channelId: Hash, amount: string): Promise<Voucher> {
    const amountWei = parseUnits(amount, USDC_DECIMALS);
    
    // Get and increment nonce
    const currentNonce = this.voucherNonces.get(channelId) ?? 0n;
    const nonce = currentNonce + 1n;
    this.voucherNonces.set(channelId, nonce);
    
    // Build EIP-712 typed data
    const typedData: VoucherTypedData = {
      domain: {
        name: EIP712_DOMAIN.name,
        version: EIP712_DOMAIN.version,
        chainId: this.chainId,
        verifyingContract: this.contractAddress,
      },
      types: {
        Voucher: [
          { name: 'channelId', type: 'bytes32' },
          { name: 'amount', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
        ],
      },
      primaryType: 'Voucher',
      message: {
        channelId,
        amount: amountWei,
        nonce,
      },
    };
    
    // Sign the voucher
    const signature = await this.walletClient.signTypedData({
      account: this.account,
      ...typedData,
    });
    
    return {
      channelId,
      amount: amountWei,
      nonce,
      signature,
    };
  }

  /**
   * Close a channel and get refund (only after expiry)
   */
  async closeChannel(channelId: Hash): Promise<Hash> {
    const hash = await this.walletClient.writeContract({
      account: this.account,
      address: this.contractAddress,
      abi: DRAIN_CHANNEL_ABI,
      functionName: 'close',
      args: [channelId],
      chain: getChain(this.chainId),
    });
    
    return hash;
  }

  /**
   * Create an unsigned voucher (for off-chain transmission)
   */
  createUnsignedVoucher(channelId: Hash, amount: string): UnsignedVoucher {
    const amountWei = parseUnits(amount, USDC_DECIMALS);
    const currentNonce = this.voucherNonces.get(channelId) ?? 0n;
    const nonce = currentNonce + 1n;
    
    return {
      channelId,
      amount: amountWei,
      nonce,
    };
  }

  /**
   * Get the contract address
   */
  getContractAddress(): Address {
    return this.contractAddress;
  }

  /**
   * Get the USDC address
   */
  getUsdcAddress(): Address {
    return this.usdcAddress;
  }
}

/**
 * Create a DRAIN consumer client
 */
export function createDrainConsumer(
  walletClient: WalletClient,
  account: Account,
  config: DrainConfig
): DrainConsumer {
  return new DrainConsumer(walletClient, account, config);
}
