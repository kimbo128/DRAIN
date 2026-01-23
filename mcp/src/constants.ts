/**
 * DRAIN Protocol Constants
 */

// USDC has 6 decimals
export const USDC_DECIMALS = 6;

// EIP-712 Domain
export const EIP712_DOMAIN = {
  name: 'DrainChannel',
  version: '1',
} as const;

// ABIs
export const DRAIN_CHANNEL_ABI = [
  {
    name: 'open',
    type: 'function',
    inputs: [
      { name: 'provider', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'duration', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'close',
    type: 'function',
    inputs: [{ name: 'channelId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'claim',
    type: 'function',
    inputs: [
      { name: 'channelId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'getChannel',
    type: 'function',
    inputs: [{ name: 'channelId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'consumer', type: 'address' },
          { name: 'provider', type: 'address' },
          { name: 'deposit', type: 'uint256' },
          { name: 'claimed', type: 'uint256' },
          { name: 'expiry', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'getBalance',
    type: 'function',
    inputs: [{ name: 'channelId', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    anonymous: false,
    name: 'ChannelOpened',
    type: 'event',
    inputs: [
      { name: 'channelId', type: 'bytes32', indexed: true },
      { name: 'consumer', type: 'address', indexed: true },
      { name: 'provider', type: 'address', indexed: true },
      { name: 'deposit', type: 'uint256', indexed: false },
      { name: 'expiry', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'allowance',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

// Voucher EIP-712 types
export const VOUCHER_TYPES = {
  Voucher: [
    { name: 'channelId', type: 'bytes32' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;
