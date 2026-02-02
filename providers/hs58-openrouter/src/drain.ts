/**
 * DRAIN Integration
 * 
 * Handles voucher validation and payment claims.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  verifyTypedData,
  type Hash,
  type Hex,
  type Address,
} from 'viem';
import { polygon, polygonAmoy } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import {
  DRAIN_ADDRESSES,
  DRAIN_CHANNEL_ABI,
  EIP712_DOMAIN,
} from './constants.js';
import type { ProviderConfig, VoucherHeader, StoredVoucher, ChannelState } from './types.js';
import { VoucherStorage } from './storage.js';

/**
 * DRAIN service for the provider
 */
export class DrainService {
  private config: ProviderConfig;
  private storage: VoucherStorage;
  private publicClient;
  private walletClient;
  private account;
  private contractAddress: Address;

  constructor(config: ProviderConfig, storage: VoucherStorage) {
    this.config = config;
    this.storage = storage;

    const chain = config.chainId === 137 ? polygon : polygonAmoy;
    
    this.publicClient = createPublicClient({
      chain,
      transport: http(),
    });

    this.account = privateKeyToAccount(config.providerPrivateKey);
    
    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(),
    });

    this.contractAddress = DRAIN_ADDRESSES[config.chainId] as Address;
  }

  /**
   * Parse voucher from header
   */
  parseVoucherHeader(header: string): VoucherHeader | null {
    try {
      const parsed = JSON.parse(header);
      
      if (!parsed.channelId || !parsed.amount || !parsed.nonce || !parsed.signature) {
        return null;
      }
      
      return {
        channelId: parsed.channelId as Hash,
        amount: parsed.amount,
        nonce: parsed.nonce,
        signature: parsed.signature as Hex,
      };
    } catch {
      return null;
    }
  }

  /**
   * Validate a voucher
   */
  async validateVoucher(
    voucher: VoucherHeader,
    requiredAmount: bigint
  ): Promise<{
    valid: boolean;
    error?: string;
    channel?: ChannelState;
    newTotal?: bigint;
  }> {
    try {
      const amount = BigInt(voucher.amount);
      const nonce = BigInt(voucher.nonce);

      // 1. Get channel from contract
      const channelData = await this.publicClient.readContract({
        address: this.contractAddress,
        abi: DRAIN_CHANNEL_ABI,
        functionName: 'getChannel',
        args: [voucher.channelId],
      }) as any;

      // 2. Check channel exists
      if (channelData.consumer === '0x0000000000000000000000000000000000000000') {
        return { valid: false, error: 'channel_not_found' };
      }

      // 3. Check we are the provider
      if (channelData.provider.toLowerCase() !== this.account.address.toLowerCase()) {
        return { valid: false, error: 'wrong_provider' };
      }

      // 4. Get or create local channel state
      let channelState = this.storage.getChannel(voucher.channelId);
      
      if (!channelState) {
        channelState = {
          channelId: voucher.channelId,
          consumer: channelData.consumer,
          deposit: channelData.deposit,
          totalCharged: 0n,
          createdAt: Date.now(),
          lastActivityAt: Date.now(),
        };
      }

      // 5. Check voucher amount covers required
      const previousTotal = channelState.totalCharged;
      const expectedTotal = previousTotal + requiredAmount;
      
      if (amount < expectedTotal) {
        return {
          valid: false,
          error: 'insufficient_funds',
          channel: channelState,
        };
      }

      // 6. Check amount doesn't exceed deposit
      if (amount > channelData.deposit) {
        return {
          valid: false,
          error: 'exceeds_deposit',
          channel: channelState,
        };
      }

      // 7. Check nonce is higher than last seen
      if (channelState.lastVoucher && nonce <= channelState.lastVoucher.nonce) {
        return {
          valid: false,
          error: 'invalid_nonce',
          channel: channelState,
        };
      }

      // 8. Verify signature
      const isValid = await verifyTypedData({
        address: channelData.consumer,
        domain: {
          name: EIP712_DOMAIN.name,
          version: EIP712_DOMAIN.version,
          chainId: this.config.chainId,
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
          amount,
          nonce,
        },
        signature: voucher.signature,
      });

      if (!isValid) {
        return { valid: false, error: 'invalid_signature' };
      }

      return {
        valid: true,
        channel: channelState,
        newTotal: amount,
      };
    } catch (error) {
      console.error('Voucher validation error:', error);
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'validation_error',
      };
    }
  }

  /**
   * Store a valid voucher and update channel state
   */
  storeVoucher(
    voucher: VoucherHeader,
    channelState: ChannelState,
    cost: bigint
  ): void {
    const storedVoucher: StoredVoucher = {
      channelId: voucher.channelId,
      amount: BigInt(voucher.amount),
      nonce: BigInt(voucher.nonce),
      signature: voucher.signature,
      consumer: channelState.consumer,
      receivedAt: Date.now(),
      claimed: false,
    };

    // Update channel state
    channelState.totalCharged += cost;
    channelState.lastVoucher = storedVoucher;
    channelState.lastActivityAt = Date.now();

    // Store
    this.storage.storeVoucher(storedVoucher);
    this.storage.updateChannel(voucher.channelId, channelState);
  }

  /**
   * Claim payments for all channels above threshold
   */
  async claimPayments(forceAll: boolean = false): Promise<Hash[]> {
    const txHashes: Hash[] = [];
    const highest = this.storage.getHighestVoucherPerChannel();

    for (const [channelId, voucher] of highest) {
      // Skip if below threshold (unless force)
      if (!forceAll && voucher.amount < this.config.claimThreshold) {
        console.log(`Skipping channel ${channelId}: amount ${voucher.amount} below threshold ${this.config.claimThreshold}`);
        continue;
      }

      try {
        const hash = await this.walletClient.writeContract({
          address: this.contractAddress,
          abi: DRAIN_CHANNEL_ABI,
          functionName: 'claim',
          args: [voucher.channelId, voucher.amount, voucher.nonce, voucher.signature],
        });

        // Mark as claimed
        this.storage.markClaimed(channelId, hash);
        txHashes.push(hash);

        console.log(`Claimed ${voucher.amount} from channel ${channelId}: ${hash}`);
      } catch (error) {
        console.error(`Failed to claim from channel ${channelId}:`, error);
      }
    }

    return txHashes;
  }

  /**
   * Get provider address
   */
  getProviderAddress(): Address {
    return this.account.address;
  }

  /**
   * Get channel balance from contract
   */
  async getChannelBalance(channelId: Hash): Promise<bigint> {
    const balance = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: DRAIN_CHANNEL_ABI,
      functionName: 'getBalance',
      args: [channelId],
    });
    return balance as bigint;
  }
}
