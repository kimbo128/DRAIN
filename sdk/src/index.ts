/**
 * DRAIN Protocol SDK
 * 
 * Trustless micropayments for AI inference.
 * 
 * @packageDocumentation
 */

// Consumer exports
export {
  DrainConsumer,
  createDrainConsumer,
} from './consumer';

// Provider exports
export {
  DrainProvider,
  createDrainProvider,
  createDrainProviderWithWallet,
  type VoucherVerification,
} from './provider';

// Types
export type {
  Channel,
  Voucher,
  UnsignedVoucher,
  OpenChannelOptions,
  OpenChannelResult,
  ClaimOptions,
  DrainConfig,
  SupportedChainId,
  VoucherTypedData,
} from './types';

// Constants
export {
  CHAIN_IDS,
  DRAIN_ADDRESSES,
  USDC_ADDRESSES,
  USDC_DECIMALS,
  EIP712_DOMAIN,
  VOUCHER_TYPEHASH,
  DRAIN_CHANNEL_ABI,
  ERC20_ABI,
} from './constants';

// Utility: Parse USDC amount
import { parseUnits, formatUnits } from 'viem';

/**
 * Parse USDC amount from human-readable string to wei (6 decimals)
 */
export function parseUsdc(amount: string): bigint {
  return parseUnits(amount, 6);
}

/**
 * Format USDC amount from wei to human-readable string
 */
export function formatUsdc(amount: bigint): string {
  return formatUnits(amount, 6);
}
