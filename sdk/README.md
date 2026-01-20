# @drain-protocol/sdk

TypeScript SDK for DRAIN Protocol - Trustless AI micropayments on Polygon.

## Installation

```bash
npm install @drain-protocol/sdk viem
```

## Quick Start

### Consumer (Paying for AI services)

```typescript
import { createWalletClient, http } from 'viem';
import { polygon } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { createDrainConsumer, CHAIN_IDS } from '@drain-protocol/sdk';

// Setup wallet
const account = privateKeyToAccount('0x...');
const walletClient = createWalletClient({
  account,
  chain: polygon,
  transport: http(),
});

// Create consumer client
const consumer = createDrainConsumer(walletClient, account, {
  chainId: CHAIN_IDS.POLYGON_MAINNET,
});

// 1. Approve USDC spending (one-time)
await consumer.approveUsdc('100'); // Approve 100 USDC

// 2. Open a payment channel
const { channelId, channel } = await consumer.openChannel({
  provider: '0x...provider-address',
  amount: '10',      // 10 USDC deposit
  duration: '24h',   // Channel valid for 24 hours
});

// 3. Sign vouchers as you use the service
const voucher1 = await consumer.signVoucher(channelId, '0.50');  // Cumulative: $0.50
const voucher2 = await consumer.signVoucher(channelId, '1.00');  // Cumulative: $1.00
const voucher3 = await consumer.signVoucher(channelId, '1.50');  // Cumulative: $1.50

// Send vouchers to provider via API...

// 4. Close channel after expiry to get refund
await consumer.closeChannel(channelId);
```

### Provider (Accepting payments)

```typescript
import { createDrainProvider, CHAIN_IDS } from '@drain-protocol/sdk';

// Create provider client (read-only for verification)
const provider = createDrainProvider({
  chainId: CHAIN_IDS.POLYGON_MAINNET,
});

// Verify incoming voucher before delivering service
const verification = await provider.verifyVoucher(voucher);

if (verification.valid) {
  console.log('Voucher valid!');
  console.log('Payout:', verification.payoutFormatted, 'USDC');
  
  // Deliver your AI service...
  
} else {
  console.log('Invalid voucher:', verification.error);
}

// Claim payment (requires wallet)
import { createDrainProviderWithWallet } from '@drain-protocol/sdk';

const providerWithWallet = createDrainProviderWithWallet(
  { chainId: CHAIN_IDS.POLYGON_MAINNET },
  walletClient,
  account
);

const txHash = await providerWithWallet.claim(voucher);
```

## API Reference

### Consumer

| Method | Description |
|--------|-------------|
| `getUsdcBalance()` | Get USDC balance |
| `approveUsdc(amount)` | Approve USDC spending |
| `getAllowance()` | Check current allowance |
| `openChannel(options)` | Open a payment channel |
| `getChannel(channelId)` | Get channel details |
| `getChannelBalance(channelId)` | Get remaining balance |
| `signVoucher(channelId, amount)` | Sign a payment voucher |
| `closeChannel(channelId)` | Close channel (after expiry) |

### Provider

| Method | Description |
|--------|-------------|
| `verifyVoucher(voucher)` | Verify voucher signature & validity |
| `claim(voucher)` | Claim payment (requires wallet) |
| `getChannel(channelId)` | Get channel details |
| `getChannelBalance(channelId)` | Get remaining balance |
| `isChannelExpired(channelId)` | Check if channel expired |
| `getTimeUntilExpiry(channelId)` | Seconds until expiry |

## Contract Addresses

| Network | DrainChannel | USDC |
|---------|--------------|------|
| Polygon Mainnet | `0x1C1918C99b6DcE977392E4131C91654d8aB71e64` | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| Polygon Amoy | `0x61f1C1E04d6Da1C92D0aF1a3d7Dc0fEFc8794d7C` | `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582` |

## Voucher Format

Vouchers use EIP-712 typed data signatures:

```typescript
{
  channelId: bytes32,  // Unique channel identifier
  amount: uint256,     // CUMULATIVE amount (not incremental!)
  nonce: uint256,      // Monotonically increasing
}
```

**Important:** `amount` is cumulative! If you've spent $1.00 and want to spend $0.50 more, sign a voucher for $1.50.

## Duration Formats

The `duration` parameter accepts:
- Seconds: `3600`
- Minutes: `"30m"`
- Hours: `"24h"`
- Days: `"7d"`

## Error Handling

```typescript
try {
  await consumer.openChannel({ ... });
} catch (error) {
  if (error.message.includes('Insufficient USDC allowance')) {
    // Need to approve USDC first
    await consumer.approveUsdc('100');
  }
}
```

## License

MIT
