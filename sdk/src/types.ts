/**
 * DRAIN Protocol Types
 */

import type { Address, Hash, Hex } from 'viem';

/**
 * Supported chain IDs
 */
export type SupportedChainId = 137 | 80002;

/**
 * Payment channel state
 */
export interface Channel {
  /** Unique channel identifier */
  id: Hash;
  /** Consumer (payer) address */
  consumer: Address;
  /** Provider (payee) address */
  provider: Address;
  /** Total USDC deposited (in smallest units, 6 decimals) */
  deposit: bigint;
  /** Amount already claimed by provider */
  claimed: bigint;
  /** Unix timestamp when channel expires */
  expiry: bigint;
}

/**
 * Voucher - signed payment authorization
 */
export interface Voucher {
  /** Channel this voucher is for */
  channelId: Hash;
  /** Cumulative amount (NOT incremental) */
  amount: bigint;
  /** Monotonically increasing nonce */
  nonce: bigint;
  /** EIP-712 signature from consumer */
  signature: Hex;
}

/**
 * Unsigned voucher (before signing)
 */
export interface UnsignedVoucher {
  channelId: Hash;
  amount: bigint;
  nonce: bigint;
}

/**
 * Options for opening a channel
 */
export interface OpenChannelOptions {
  /** Provider address to pay */
  provider: Address;
  /** Amount in USDC (human readable, e.g., "10.50") */
  amount: string;
  /** Duration in seconds, or string like "1h", "24h", "7d" */
  duration: number | string;
}

/**
 * Result of opening a channel
 */
export interface OpenChannelResult {
  /** Channel ID */
  channelId: Hash;
  /** Transaction hash */
  txHash: Hash;
  /** Channel details */
  channel: Channel;
}

/**
 * Options for claiming payment
 */
export interface ClaimOptions {
  /** Channel ID */
  channelId: Hash;
  /** Cumulative amount to claim */
  amount: bigint;
  /** Voucher nonce */
  nonce: bigint;
  /** Consumer's signature */
  signature: Hex;
}

/**
 * EIP-712 typed data for voucher signing
 */
export interface VoucherTypedData {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: Address;
  };
  types: {
    Voucher: [
      { name: 'channelId'; type: 'bytes32' },
      { name: 'amount'; type: 'uint256' },
      { name: 'nonce'; type: 'uint256' },
    ];
  };
  primaryType: 'Voucher';
  message: {
    channelId: Hash;
    amount: bigint;
    nonce: bigint;
  };
}

/**
 * SDK configuration
 */
export interface DrainConfig {
  /** Chain ID (137 for Polygon mainnet, 80002 for Amoy testnet) */
  chainId: SupportedChainId;
  /** Custom RPC URL (optional) */
  rpcUrl?: string;
  /** Custom contract address (optional, for testing) */
  contractAddress?: Address;
  /** Custom USDC address (optional, for testing) */
  usdcAddress?: Address;
}
