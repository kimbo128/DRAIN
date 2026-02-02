/**
 * DRAIN Protocol Constants (inline for standalone deployment)
 */

// Contract Addresses
export const DRAIN_ADDRESSES: Record<number, string> = {
  137: '0x1C1918C99b6DcE977392E4131C91654d8aB71e64',
  80002: '0x61f1C1E04d6Da1C92D0aF1a3d7Dc0fEFc8794d7C',
};

// USDC has 6 decimals
export const USDC_DECIMALS = 6;

// EIP-712 Domain
export const EIP712_DOMAIN = {
  name: 'DrainChannel',
  version: '1',
} as const;

// DrainChannel ABI (minimal)
export const DRAIN_CHANNEL_ABI = [
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
] as const;
