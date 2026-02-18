/**
 * DRAIN MCP Server Configuration
 * 
 * All configuration is done via environment variables.
 */

import { createWalletClient, createPublicClient, http, type Address, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon, polygonAmoy } from 'viem/chains';

// Contract addresses
export const DRAIN_ADDRESSES: Record<number, Address> = {
  137: '0x1C1918C99b6DcE977392E4131C91654d8aB71e64',    // Polygon Mainnet
  80002: '0x73d16e39F0E4C0bfb8b3e41a2F721EcC0eDef74F',  // Polygon Amoy
};

export const USDC_ADDRESSES: Record<number, Address> = {
  137: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',    // Polygon Mainnet (native USDC)
  80002: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582', // Polygon Amoy (test USDC)
};

// Default RPC URLs
const DEFAULT_RPC_URLS: Record<number, string> = {
  137: 'https://polygon-rpc.com',
  80002: 'https://rpc-amoy.polygon.technology',
};

// Chain configs
const CHAINS: Record<number, Chain> = {
  137: polygon,
  80002: polygonAmoy,
};

export interface DrainConfig {
  privateKey: `0x${string}`;
  chainId: number;
  rpcUrl: string;
  directoryUrl: string;
  marketplaceBaseUrl: string;
  drainAddress: Address;
  usdcAddress: Address;
  chain: Chain;
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): DrainConfig {
  const privateKey = process.env.DRAIN_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('DRAIN_PRIVATE_KEY environment variable is required');
  }
  
  if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
    throw new Error('DRAIN_PRIVATE_KEY must be a valid 32-byte hex string starting with 0x');
  }
  
  const chainId = parseInt(process.env.DRAIN_CHAIN_ID || '137');
  if (chainId !== 137 && chainId !== 80002) {
    throw new Error('DRAIN_CHAIN_ID must be 137 (Polygon) or 80002 (Amoy testnet)');
  }
  
  const rpcUrl = process.env.DRAIN_RPC_URL || DEFAULT_RPC_URLS[chainId];
  const directoryUrl = process.env.DRAIN_DIRECTORY_URL || 'https://handshake58.com/api/mcp/providers';
  
  // Derive marketplace base URL from directory URL (strip /api/... path)
  const defaultMarketplaceBase = new URL(directoryUrl).origin;
  const marketplaceBaseUrl = process.env.DRAIN_MARKETPLACE_URL || defaultMarketplaceBase;
  
  const drainAddress = DRAIN_ADDRESSES[chainId];
  const usdcAddress = USDC_ADDRESSES[chainId];
  const chain = CHAINS[chainId];
  
  return {
    privateKey: privateKey as `0x${string}`,
    chainId,
    rpcUrl,
    directoryUrl,
    marketplaceBaseUrl,
    drainAddress,
    usdcAddress,
    chain,
  };
}

/**
 * Create wallet and public clients from config
 */
export function createClients(config: DrainConfig) {
  const account = privateKeyToAccount(config.privateKey);
  
  const walletClient = createWalletClient({
    account,
    chain: config.chain,
    transport: http(config.rpcUrl),
  });
  
  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });
  
  return { account, walletClient, publicClient };
}
