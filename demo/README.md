# DRAIN Demo

Interactive demo for the DRAIN payment channel protocol.

## Features

- 🔗 Wallet connection (RainbowKit)
- 💰 USDC balance display
- 📺 Payment channel opening
- 💬 Mock chat interface
- 📊 Real-time balance tracking

## Quick Start

```bash
cd demo
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## How It Works

1. **Connect Wallet** - Connect with MetaMask or WalletConnect
2. **Open Channel** - Deposit USDC into a payment channel
3. **Chat** - Send messages (each signs a voucher off-chain)
4. **Watch Balance** - See your channel balance decrease per message

## Configuration

The demo uses these contract addresses:

| Network | DRAIN Contract | USDC |
|---------|---------------|------|
| Polygon Mainnet | `0x1C1918C99b6DcE977392E4131C91654d8aB71e64` | Native USDC |
| Polygon Amoy | `0x61f1C1E04d6Da1C92D0aF1a3d7Dc0fEFc8794d7C` | Test USDC |

## Connecting to a Real Provider

To connect to a real DRAIN provider, update `sendMessage()` in `page.tsx`:

```typescript
// 1. Sign voucher
const signature = await walletClient.signTypedData({
  domain: { name: 'DRAIN', version: '1', chainId, verifyingContract: DRAIN_ADDRESS },
  types: { Voucher: [...] },
  primaryType: 'Voucher',
  message: { channelId, amount, nonce },
});

// 2. Send to provider
const response = await fetch('https://provider.example.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-DRAIN-Voucher': JSON.stringify({ channelId, amount, nonce, signature }),
  },
  body: JSON.stringify({ model: 'gpt-4o', messages: [...] }),
});

// 3. Parse cost from headers
const cost = response.headers.get('X-DRAIN-Cost');
```

## Tech Stack

- Next.js 15
- TypeScript
- Tailwind CSS
- wagmi + viem
- RainbowKit

## License

MIT
