/**
 * DRAIN Protocol Constants
 */

// Chain IDs
export const CHAIN_IDS = {
  POLYGON_MAINNET: 137,
  POLYGON_AMOY: 80002,
} as const;

// Contract Addresses
export const DRAIN_ADDRESSES = {
  [CHAIN_IDS.POLYGON_MAINNET]: '0x1C1918C99b6DcE977392E4131C91654d8aB71e64',
  [CHAIN_IDS.POLYGON_AMOY]: '0x61f1C1E04d6Da1C92D0aF1a3d7Dc0fEFc8794d7C',
} as const;

// USDC Addresses
export const USDC_ADDRESSES = {
  [CHAIN_IDS.POLYGON_MAINNET]: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  [CHAIN_IDS.POLYGON_AMOY]: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
} as const;

// USDC has 6 decimals
export const USDC_DECIMALS = 6;

// EIP-712 Domain
export const EIP712_DOMAIN = {
  name: 'DrainChannel',
  version: '1',
} as const;

// Voucher TypeHash (must match contract)
export const VOUCHER_TYPEHASH = 'Voucher(bytes32 channelId,uint256 amount,uint256 nonce)';

// DrainChannel ABI (minimal for SDK)
export const DRAIN_CHANNEL_ABI = [
  // Read functions
  {
    inputs: [{ name: 'channelId', type: 'bytes32' }],
    name: 'channels',
    outputs: [
      { name: 'consumer', type: 'address' },
      { name: 'provider', type: 'address' },
      { name: 'deposit', type: 'uint256' },
      { name: 'claimed', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'channelId', type: 'bytes32' }],
    name: 'getChannel',
    outputs: [
      {
        components: [
          { name: 'consumer', type: 'address' },
          { name: 'provider', type: 'address' },
          { name: 'deposit', type: 'uint256' },
          { name: 'claimed', type: 'uint256' },
          { name: 'expiry', type: 'uint256' },
        ],
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'channelId', type: 'bytes32' }],
    name: 'getBalance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: '', type: 'address' }],
    name: 'nonces',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'DOMAIN_SEPARATOR',
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
  // Write functions
  {
    inputs: [
      { name: 'provider', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'duration', type: 'uint256' },
    ],
    name: 'open',
    outputs: [{ name: 'channelId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'channelId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    name: 'claim',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'channelId', type: 'bytes32' }],
    name: 'close',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'channelId', type: 'bytes32' },
      { indexed: true, name: 'consumer', type: 'address' },
      { indexed: true, name: 'provider', type: 'address' },
      { indexed: false, name: 'deposit', type: 'uint256' },
      { indexed: false, name: 'expiry', type: 'uint256' },
    ],
    name: 'ChannelOpened',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'channelId', type: 'bytes32' },
      { indexed: true, name: 'provider', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
    ],
    name: 'ChannelClaimed',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'channelId', type: 'bytes32' },
      { indexed: true, name: 'consumer', type: 'address' },
      { indexed: false, name: 'refund', type: 'uint256' },
    ],
    name: 'ChannelClosed',
    type: 'event',
  },
] as const;

// ERC20 ABI (minimal for USDC approval)
export const ERC20_ABI = [
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
