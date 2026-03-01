/**
 * Channel Service
 * 
 * Manages payment channels: open, close, status, voucher signing.
 */

import { 
  formatUnits, 
  parseUnits, 
  type Address, 
  type Hash, 
  type Hex,
  type PublicClient, 
  type WalletClient, 
  type Account 
} from 'viem';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { USDC_DECIMALS, DRAIN_CHANNEL_ABI, ERC20_ABI, EIP712_DOMAIN, VOUCHER_TYPES } from '../constants.js';
import type { DrainConfig } from '../config.js';

export interface Channel {
  id: Hash;
  consumer: Address;
  provider: Address;
  deposit: bigint;
  claimed: bigint;
  expiry: bigint;
}

export interface ChannelInfo {
  id: string;
  provider: string;
  deposit: string;
  claimed: string;
  remaining: string;
  expiry: Date;
  isExpired: boolean;
  secondsRemaining: number;
}

export interface Voucher {
  channelId: Hash;
  amount: bigint;
  nonce: bigint;
  signature: Hex;
}

export interface ChannelMeta {
  providerId: string;
  providerName?: string;
  category?: string;
  deposit?: string;
  expiry?: number;
  openedAt?: number;
}

export class ChannelService {
  private nonces: Map<Hash, bigint> = new Map();
  private spending: Map<Hash, bigint> = new Map();
  private channelMeta: Map<Hash, ChannelMeta> = new Map();
  private channelsFile: string;

  constructor(
    private publicClient: PublicClient,
    private walletClient: WalletClient,
    private account: Account,
    private config: DrainConfig
  ) {
    const dir = join(homedir(), '.drain-mcp');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.channelsFile = join(dir, 'channels.json');
    this.loadChannelMeta();
  }

  private loadChannelMeta(): void {
    try {
      if (existsSync(this.channelsFile)) {
        const data = JSON.parse(readFileSync(this.channelsFile, 'utf-8'));
        for (const [k, v] of Object.entries(data)) {
          if (typeof v === 'string') {
            this.channelMeta.set(k as Hash, { providerId: v });
          } else {
            this.channelMeta.set(k as Hash, v as ChannelMeta);
          }
        }
      }
    } catch { /* ignore corrupt file */ }
  }

  private saveChannelMeta(): void {
    try {
      const obj: Record<string, ChannelMeta> = {};
      for (const [k, v] of this.channelMeta.entries()) {
        obj[k] = v;
      }
      writeFileSync(this.channelsFile, JSON.stringify(obj, null, 2));
    } catch { /* non-fatal */ }
  }

  getKnownChannelIds(): Hash[] {
    return Array.from(this.channelMeta.keys());
  }

  getChannelMeta(channelId: Hash): ChannelMeta | undefined {
    return this.channelMeta.get(channelId);
  }

  /**
   * Open a new payment channel
   */
  async openChannel(
    provider: Address,
    amount: string,
    durationSeconds: number
  ): Promise<{ channelId: Hash; txHash: Hash; channel: ChannelInfo }> {
    const amountWei = parseUnits(amount, USDC_DECIMALS);
    
    // Check allowance first
    const allowance = await this.publicClient.readContract({
      address: this.config.usdcAddress,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [this.account.address, this.config.drainAddress],
    }) as bigint;
    
    if (allowance < amountWei) {
      throw new Error(
        `Insufficient USDC allowance. Have: ${formatUnits(allowance as bigint, USDC_DECIMALS)} USDC, ` +
        `need: ${amount} USDC. Approve more USDC first.`
      );
    }
    
    // Open the channel
    const hash = await this.walletClient.writeContract({
      account: this.account,
      address: this.config.drainAddress,
      abi: DRAIN_CHANNEL_ABI,
      functionName: 'open',
      args: [provider, amountWei, BigInt(durationSeconds)],
      chain: this.config.chain,
    });
    
    // Wait for confirmation and get receipt
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    
    // Find ChannelOpened event
    const openedEvent = receipt.logs.find(log => 
      log.topics[0] === '0x506f81b7a67b45bfbc6167fd087b3dd9b65b4531a2380ec406aab5b57ac62152'
    );
    
    if (!openedEvent || !openedEvent.topics[1]) {
      throw new Error('Could not find ChannelOpened event in transaction');
    }
    
    const channelId = openedEvent.topics[1] as Hash;
    
    // Initialize tracking for this channel
    this.nonces.set(channelId, 0n);
    this.spending.set(channelId, 0n);
    
    // Parse deposit + expiry directly from event data (avoids a second RPC call
    // that can return stale state and cause 1970-01-01 expiry or broken responses)
    let channel: ChannelInfo;
    try {
      const eventData = openedEvent.data;
      const deposit = BigInt('0x' + eventData.slice(2, 66));
      const expiry = BigInt('0x' + eventData.slice(66, 130));
      const now = BigInt(Math.floor(Date.now() / 1000));

      channel = {
        id: channelId,
        provider: provider,
        deposit: formatUnits(deposit, USDC_DECIMALS),
        claimed: '0',
        remaining: formatUnits(deposit, USDC_DECIMALS),
        expiry: new Date(Number(expiry) * 1000),
        isExpired: now >= expiry,
        secondsRemaining: Math.max(0, Number(expiry - now)),
      };
    } catch {
      channel = await this.getChannel(channelId);
    }
    
    return { channelId, txHash: hash, channel };
  }

  /**
   * Close an expired channel and get refund
   */
  async closeChannel(channelId: Hash): Promise<{ txHash: Hash; refundAmount: string }> {
    // Get channel to calculate refund
    const channelData = await this.getChannelRaw(channelId);
    const refundAmount = channelData.deposit - channelData.claimed;
    
    // Check if expired
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now < channelData.expiry) {
      const remaining = Number(channelData.expiry - now);
      throw new Error(
        `Channel has not expired yet. ${remaining} seconds remaining. ` +
        `Expires at: ${new Date(Number(channelData.expiry) * 1000).toISOString()}`
      );
    }
    
    // Close the channel
    const hash = await this.walletClient.writeContract({
      account: this.account,
      address: this.config.drainAddress,
      abi: DRAIN_CHANNEL_ABI,
      functionName: 'close',
      args: [channelId],
      chain: this.config.chain,
    });
    
    await this.publicClient.waitForTransactionReceipt({ hash });
    
    this.nonces.delete(channelId);
    this.spending.delete(channelId);
    this.channelMeta.delete(channelId);
    this.saveChannelMeta();
    
    return { 
      txHash: hash, 
      refundAmount: formatUnits(refundAmount, USDC_DECIMALS) 
    };
  }

  /**
   * Cooperative close: ask provider for a close signature, then close on-chain immediately
   */
  async cooperativeCloseChannel(
    channelId: Hash,
    providerApiUrl: string
  ): Promise<{ txHash: Hash; refundAmount: string; payout: string; fee: string }> {
    const res = await fetch(`${providerApiUrl}/v1/close-channel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Provider refused cooperative close (HTTP ${res.status}): ${body.slice(0, 200)}`);
    }

    const { finalAmount, signature } = await res.json() as { finalAmount: string; signature: string };

    const channelData = await this.getChannelRaw(channelId);
    const finalAmountBn = BigInt(finalAmount);
    const refund = channelData.deposit - finalAmountBn;
    const payout = finalAmountBn - channelData.claimed;
    const feeBps = 200n;
    const fee = (payout * feeBps) / 10000n;

    const hash = await this.walletClient.writeContract({
      account: this.account,
      address: this.config.drainAddress,
      abi: DRAIN_CHANNEL_ABI,
      functionName: 'cooperativeClose',
      args: [channelId, finalAmountBn, signature as Hex],
      chain: this.config.chain,
    });

    await this.publicClient.waitForTransactionReceipt({ hash });

    this.nonces.delete(channelId);
    this.spending.delete(channelId);
    this.channelMeta.delete(channelId);
    this.saveChannelMeta();

    return {
      txHash: hash,
      refundAmount: formatUnits(refund, USDC_DECIMALS),
      payout: formatUnits(payout, USDC_DECIMALS),
      fee: formatUnits(fee, USDC_DECIMALS),
    };
  }

  /**
   * Get channel details (raw)
   */
  async getChannelRaw(channelId: Hash): Promise<Channel> {
    const result = await this.publicClient.readContract({
      address: this.config.drainAddress,
      abi: DRAIN_CHANNEL_ABI,
      functionName: 'getChannel',
      args: [channelId],
    }) as { consumer: Address; provider: Address; deposit: bigint; claimed: bigint; expiry: bigint };
    
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
   * Get channel details (formatted)
   */
  async getChannel(channelId: Hash): Promise<ChannelInfo> {
    const channel = await this.getChannelRaw(channelId);
    const now = BigInt(Math.floor(Date.now() / 1000));
    const remaining = channel.deposit - channel.claimed;
    
    return {
      id: channelId,
      provider: channel.provider,
      deposit: formatUnits(channel.deposit, USDC_DECIMALS),
      claimed: formatUnits(channel.claimed, USDC_DECIMALS),
      remaining: formatUnits(remaining, USDC_DECIMALS),
      expiry: new Date(Number(channel.expiry) * 1000),
      isExpired: now >= channel.expiry,
      secondsRemaining: Math.max(0, Number(channel.expiry - now)),
    };
  }

  /**
   * Sign a voucher for payment
   * 
   * @param channelId - The channel to pay from
   * @param additionalAmount - Amount to add to cumulative total (in USDC, e.g., "0.01")
   */
  async signVoucher(channelId: Hash, additionalAmount: string): Promise<Voucher> {
    const additionalWei = parseUnits(additionalAmount, USDC_DECIMALS);
    
    // Get current cumulative spending and add new amount
    const currentSpending = this.spending.get(channelId) ?? 0n;
    const newTotal = currentSpending + additionalWei;
    
    // Get and increment nonce
    const currentNonce = this.nonces.get(channelId) ?? 0n;
    const nonce = currentNonce + 1n;
    
    // Sign the voucher using EIP-712
    const signature = await this.walletClient.signTypedData({
      account: this.account,
      domain: {
        name: EIP712_DOMAIN.name,
        version: EIP712_DOMAIN.version,
        chainId: this.config.chainId,
        verifyingContract: this.config.drainAddress,
      },
      types: VOUCHER_TYPES,
      primaryType: 'Voucher',
      message: {
        channelId,
        amount: newTotal,
        nonce,
      },
    });
    
    // Update tracking
    this.nonces.set(channelId, nonce);
    this.spending.set(channelId, newTotal);
    
    return {
      channelId,
      amount: newTotal,
      nonce,
      signature,
    };
  }

  setProviderId(channelId: Hash, providerId: string): void {
    const existing = this.channelMeta.get(channelId);
    if (existing) {
      existing.providerId = providerId;
    } else {
      this.channelMeta.set(channelId, { providerId });
    }
    this.saveChannelMeta();
  }

  setChannelMeta(channelId: Hash, meta: ChannelMeta): void {
    this.channelMeta.set(channelId, meta);
    this.saveChannelMeta();
  }

  getProviderId(channelId: Hash): string | undefined {
    return this.channelMeta.get(channelId)?.providerId;
  }

  /**
   * Get current spending for a channel (local tracking)
   */
  getSpending(channelId: Hash): string {
    const spending = this.spending.get(channelId) ?? 0n;
    return formatUnits(spending, USDC_DECIMALS);
  }

  /**
   * Check if channel has sufficient balance for an amount
   */
  async hasBalance(channelId: Hash, amount: string): Promise<boolean> {
    const amountWei = parseUnits(amount, USDC_DECIMALS);
    const currentSpending = this.spending.get(channelId) ?? 0n;
    const channel = await this.getChannelRaw(channelId);
    
    return (currentSpending + amountWei) <= channel.deposit;
  }
}
