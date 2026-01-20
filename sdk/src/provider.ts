/**
 * DRAIN Provider SDK
 * 
 * For AI service providers who want to accept payment via DRAIN channels.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  verifyTypedData,
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
  EIP712_DOMAIN,
} from './constants';
import type {
  Channel,
  Voucher,
  ClaimOptions,
  DrainConfig,
  SupportedChainId,
} from './types';

/**
 * Get chain from chainId
 */
function getChain(chainId: SupportedChainId) {
  return chainId === 137 ? polygon : polygonAmoy;
}

/**
 * Verification result for a voucher
 */
export interface VoucherVerification {
  /** Is the voucher valid? */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
  /** Recovered signer address */
  signer?: Address;
  /** Channel details */
  channel?: Channel;
  /** Amount that would be paid (voucher amount - already claimed) */
  payout?: bigint;
  /** Payout in human-readable format */
  payoutFormatted?: string;
}

/**
 * DRAIN Provider Client
 * 
 * Handles voucher verification and payment claims.
 */
export class DrainProvider {
  private publicClient: PublicClient;
  private walletClient: WalletClient | null;
  private account: Account | null;
  private chainId: SupportedChainId;
  private contractAddress: Address;
  private usdcAddress: Address;
  
  // Track highest seen nonce per channel to prevent replay
  private highestNonces: Map<Hash, bigint> = new Map();

  constructor(config: DrainConfig, walletClient?: WalletClient, account?: Account) {
    this.walletClient = walletClient ?? null;
    this.account = account ?? null;
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
   * Verify a voucher's signature and validity
   * 
   * This should be called before delivering service.
   */
  async verifyVoucher(voucher: Voucher): Promise<VoucherVerification> {
    try {
      // 1. Check nonce is higher than previously seen
      const highestNonce = this.highestNonces.get(voucher.channelId) ?? 0n;
      if (voucher.nonce <= highestNonce) {
        return {
          valid: false,
          error: `Nonce too low. Got: ${voucher.nonce}, highest seen: ${highestNonce}`,
        };
      }

      // 2. Get channel details
      const channel = await this.getChannel(voucher.channelId);
      
      // 3. Check channel exists
      if (channel.consumer === '0x0000000000000000000000000000000000000000') {
        return {
          valid: false,
          error: 'Channel not found',
        };
      }

      // 4. Check amount doesn't exceed deposit
      if (voucher.amount > channel.deposit) {
        return {
          valid: false,
          error: `Amount exceeds deposit. Voucher: ${formatUnits(voucher.amount, USDC_DECIMALS)}, deposit: ${formatUnits(channel.deposit, USDC_DECIMALS)}`,
        };
      }

      // 5. Check amount is higher than already claimed
      if (voucher.amount <= channel.claimed) {
        return {
          valid: false,
          error: `Amount not higher than claimed. Voucher: ${formatUnits(voucher.amount, USDC_DECIMALS)}, claimed: ${formatUnits(channel.claimed, USDC_DECIMALS)}`,
        };
      }

      // 6. Verify signature
      const isValid = await verifyTypedData({
        address: channel.consumer,
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
          channelId: voucher.channelId,
          amount: voucher.amount,
          nonce: voucher.nonce,
        },
        signature: voucher.signature,
      });

      if (!isValid) {
        return {
          valid: false,
          error: 'Invalid signature',
        };
      }

      // 7. Update highest seen nonce
      this.highestNonces.set(voucher.channelId, voucher.nonce);

      // 8. Calculate payout
      const payout = voucher.amount - channel.claimed;

      return {
        valid: true,
        signer: channel.consumer,
        channel,
        payout,
        payoutFormatted: formatUnits(payout, USDC_DECIMALS),
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Claim payment from a channel using a voucher
   * 
   * Requires walletClient to be configured.
   */
  async claim(voucher: Voucher): Promise<Hash> {
    if (!this.walletClient || !this.account) {
      throw new Error('WalletClient and account required for claiming. Initialize provider with wallet.');
    }

    const hash = await this.walletClient.writeContract({
      account: this.account,
      address: this.contractAddress,
      abi: DRAIN_CHANNEL_ABI,
      functionName: 'claim',
      args: [voucher.channelId, voucher.amount, voucher.nonce, voucher.signature],
      chain: getChain(this.chainId),
    });

    return hash;
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
   * Check if a channel has expired
   */
  async isChannelExpired(channelId: Hash): Promise<boolean> {
    const channel = await this.getChannel(channelId);
    return BigInt(Math.floor(Date.now() / 1000)) >= channel.expiry;
  }

  /**
   * Get time until channel expires (in seconds)
   */
  async getTimeUntilExpiry(channelId: Hash): Promise<number> {
    const channel = await this.getChannel(channelId);
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now >= channel.expiry) return 0;
    return Number(channel.expiry - now);
  }

  /**
   * Get the highest nonce seen for a channel
   */
  getHighestNonce(channelId: Hash): bigint {
    return this.highestNonces.get(channelId) ?? 0n;
  }

  /**
   * Store a voucher's nonce (for persistence across restarts)
   */
  setHighestNonce(channelId: Hash, nonce: bigint): void {
    this.highestNonces.set(channelId, nonce);
  }

  /**
   * Get the contract address
   */
  getContractAddress(): Address {
    return this.contractAddress;
  }
}

/**
 * Create a DRAIN provider client (read-only, for verification)
 */
export function createDrainProvider(config: DrainConfig): DrainProvider {
  return new DrainProvider(config);
}

/**
 * Create a DRAIN provider client with wallet (can claim payments)
 */
export function createDrainProviderWithWallet(
  config: DrainConfig,
  walletClient: WalletClient,
  account: Account
): DrainProvider {
  return new DrainProvider(config, walletClient, account);
}
