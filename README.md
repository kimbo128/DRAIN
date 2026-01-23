# DRAIN

**Decentralized Runtime for AI Networks**

An open protocol for trustless, streaming micropayments between AI consumers and providers.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

---

## Why DRAIN?

Existing decentralized AI protocols require holding volatile tokens, creating speculation dynamics that overwhelm utility. Meanwhile, **78% of the world lacks credit cards**, and AI agents can't have bank accounts.

DRAIN fills this gap: **stablecoin micropayments without tokens, complexity, or intermediaries.**

| Problem | DRAIN Solution |
|---------|----------------|
| Token volatility | USDC-only, predictable pricing |
| High fees | $0.02 per tx on Polygon |
| AI agents can't pay | First-class programmatic support |
| Credit card barriers | Permissionless crypto access |

## Overview

DRAIN enables permissionless, pay-per-token AI inference without intermediaries. Users open payment channels with USDC, stream requests to any compatible provider, and settle on-chain only when needed.

**Core Principles:**

* **Minimal** – The protocol defines only what's necessary
* **Permissionless** – Anyone can be a provider or consumer
* **Trustless** – Cryptography replaces trust
* **Immutable** – No admin keys, no upgrades, no fees

## How It Works

DRAIN is like a **prepaid card for AI**: deposit USDC, use it across requests, withdraw the remainder.

```
┌──────────────────────────────────────────────────────────────────┐
│                        Off-Chain (Fast & Free)                   │
│                                                                  │
│    Consumer                                      Provider        │
│        │                                             │           │
│        │───────── Request + Voucher ────────────────►│           │
│        │◄──────── AI Response ───────────────────────│           │
│        │───────── Request + Voucher ────────────────►│           │
│        │◄──────── AI Response ───────────────────────│           │
│        │                    ...                      │           │
│                                                                  │
└────────┼─────────────────────────────────────────────┼───────────┘
         │                                             │
         │              On-Chain (Rare)                │
         ▼                                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                        DRAIN Contract                            │
│                                                                  │
│     open(provider, amount, duration)    →  Lock USDC             │
│     claim(channelId, amount, signature) →  Pay provider          │
│     close(channelId)                    →  Refund remainder      │
└──────────────────────────────────────────────────────────────────┘
```

### The Two Roles

| Role | What They Do | On-Chain Actions |
|------|--------------|------------------|
| **Consumer** | Pays for AI services | `open` (deposit), `close` (refund) |
| **Provider** | Delivers AI responses | `claim` (withdraw earnings) |

### Consumer Flow

1. **Open Channel**: Deposit USDC for a specific provider and duration (~$0.02 gas)
2. **Use Service**: Send requests with signed vouchers (free, off-chain)
3. **Close Channel**: Withdraw unused USDC after expiry (~$0.02 gas)

### Provider Flow

1. **Receive Request**: Validate voucher signature and amount
2. **Deliver Service**: Return AI response
3. **Claim Payment**: Submit highest voucher to get paid (~$0.02 gas)

### Channel Duration & Provider Protection

The **consumer sets the channel duration** when opening (e.g., 24h). But providers control their requirements:

| Provider Can... | How |
|-----------------|-----|
| **Require minimum duration** | Reject vouchers from channels < X hours |
| **Recommend duration** | Document in API: "We recommend 24h channels" |
| **Claim anytime** | No deadline until consumer calls `close()` |

**Key insight:** Even after channel expiry, the provider can claim as long as the consumer hasn't closed. The consumer must actively call `close()` – it's not automatic.

### Vouchers Are Cumulative

Each voucher contains the **total** amount spent, not the increment:

```
Request 1: voucher.amount = $0.10  (total spent so far)
Request 2: voucher.amount = $0.25  (total, not $0.15 increment)
Request 3: voucher.amount = $0.40  (total, not $0.15 increment)
```

Provider only needs to claim the **last** voucher to receive full payment.

### Payment Currency

| Asset | Network | Why |
|-------|---------|-----|
| **USDC** | Polygon | Stable ($1), liquid ($500M+), low fees ($0.02/tx) |

USDC on Polygon can be bridged from Ethereum, Base, Arbitrum via [Circle CCTP](https://www.circle.com/en/cross-chain-transfer-protocol).

## Protocol Specification

DRAIN defines three components:

| Component                | Description                                      |
| ------------------------ | ------------------------------------------------ |
| **Smart Contract** | Immutable escrow and settlement logic            |
| **Voucher Format** | EIP-712 typed signatures for off-chain payments  |
| **API Standard**   | OpenAI-compatible interface with payment headers |

The protocol intentionally excludes provider discovery, reputation systems, dispute resolution, and governance. These layers can be built independently.

Full specification: See `contracts/` for implementation details.

## Security Model

| Party | Protected Against | How |
|-------|-------------------|-----|
| **Consumer** | Overcharging | Only signs amounts they agree to |
| **Consumer** | Non-delivery | Stops signing, refunds after expiry |
| **Provider** | Overspending | `amount ≤ deposit` enforced on-chain |
| **Provider** | Double-spend | USDC locked in contract, not wallet |

EIP-712 signatures with `chainId` and `verifyingContract` prevent replay attacks. OpenZeppelin ECDSA provides malleability protection.

## Voucher Format

```solidity
// EIP-712 typed data
struct Voucher {
    bytes32 channelId;
    uint256 amount;  // Cumulative total spent
    uint256 nonce;   // Incrementing per voucher
}
```

Consumer signs vouchers off-chain. Provider submits latest voucher to claim payment.

## Economics

| Role | Cost |
|------|------|
| **Consumer** | ~$0.02 open + provider rate + ~$0.02 close |
| **Provider** | ~$0.02 claim gas, keeps 100% of fees |
| **Protocol** | Zero fees |

Total overhead: **<$0.05** per session regardless of usage.

## What DRAIN Is NOT

| ❌ | Why |
|----|-----|
| Token | No speculation, no governance drama |
| Marketplace | Discovery is separate, built on top |
| Reputation system | Out of scope, can be layered |
| Upgradeable | Immutable contracts, no admin keys |

## Project Structure

```
drain/
├── contracts/                  # Solidity smart contracts
│   ├── src/DrainChannel.sol    # Core payment channel contract
│   ├── test/                   # 47 Foundry tests
│   └── script/                 # Deploy scripts
├── sdk/                        # TypeScript SDK
│   ├── src/consumer.ts         # Consumer: open, sign, close
│   └── src/provider.ts         # Provider: verify, claim
├── provider/                   # Reference AI Provider
│   ├── src/index.ts            # Express server (OpenAI-compatible)
│   └── src/drain.ts            # Voucher validation
├── mcp/                        # MCP Server for AI Agents
│   ├── src/index.ts            # MCP server entry point
│   └── src/tools/              # drain_chat, drain_balance, etc.
└── demo/                       # Marketplace & Demo
    └── src/app/page.tsx        # Next.js frontend
```

## MCP Server (Agent-to-Agent)

DRAIN includes an MCP (Model Context Protocol) server that enables AI agents to autonomously pay for AI services.

```bash
npm install -g drain-mcp
```

Configure in Cursor or Claude:

```json
{
  "mcpServers": {
    "drain": {
      "command": "npx",
      "args": ["-y", "drain-mcp"],
      "env": {
        "DRAIN_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

**Available Tools:**

| Tool | Description |
|------|-------------|
| `drain_providers` | Discover AI providers |
| `drain_balance` | Check wallet balance |
| `drain_open_channel` | Open payment channel |
| `drain_chat` | AI chat with payment |
| `drain_close_channel` | Close channel, get refund |

See [`mcp/README.md`](./mcp/README.md) for full documentation.

## SDK Quick Start

```bash
npm install @drain-protocol/sdk viem
```

```typescript
import { createDrainConsumer, CHAIN_IDS } from '@drain-protocol/sdk';

// Open channel, sign vouchers, close when done
const consumer = createDrainConsumer(walletClient, account, {
  chainId: CHAIN_IDS.POLYGON_MAINNET,
});

await consumer.approveUsdc('10');
const { channelId } = await consumer.openChannel({
  provider: '0x...',
  amount: '10',
  duration: '24h',
});

const voucher = await consumer.signVoucher(channelId, '0.50');
// Send voucher to provider...
```

See [`sdk/README.md`](./sdk/README.md) for full documentation.

## Reference Provider

OpenAI-compatible API server that accepts DRAIN payments.

**🟢 Live Provider:** https://drain-production-a9d4.up.railway.app/v1/pricing

### Available Models & Pricing

| Model | Input/1K Tokens | Output/1K Tokens | ~Cost/Message |
|-------|-----------------|------------------|---------------|
| **gpt-4o-mini** | $0.000225 | $0.0009 | ~$0.001 ✨ |
| gpt-4o | $0.00375 | $0.015 | ~$0.01 |
| gpt-4-turbo | $0.015 | $0.045 | ~$0.03 |
| gpt-3.5-turbo | $0.00075 | $0.00225 | ~$0.002 |

*Prices include 50% margin over OpenAI base rates*

**Run your own:**

```bash
cd provider
cp env.example .env  # Configure OPENAI_API_KEY, PROVIDER_PRIVATE_KEY
npm install
npm run dev
```

**Endpoints:**
```
GET  /v1/pricing          → View pricing per model
GET  /v1/models           → List available models  
POST /v1/chat/completions → Chat (with X-DRAIN-Voucher header)
```

**DRAIN Headers:**
```http
# Request
X-DRAIN-Voucher: {"channelId":"0x...","amount":"1000000","nonce":"1","signature":"0x..."}

# Response
X-DRAIN-Cost: 8250
X-DRAIN-Total: 158250
X-DRAIN-Remaining: 9841750
```

See [`provider/README.md`](./provider/README.md) for full documentation.

## Provider Directory

**🟢 Live Directory:** https://believable-inspiration-production-b1c6.up.railway.app/directory

Discover and register DRAIN-compatible AI providers:

- **Marketplace** – Browse approved providers with live status
- **Register** – Submit your provider for review
- **Admin** – Approve/reject providers (admin only)

### API for MCP Integration

```bash
# Get all approved providers (MCP-friendly format)
curl https://your-demo.railway.app/api/mcp/providers
```

Response includes provider info, models, pricing, and live status for the DRAIN MCP Server.

## Demo Application

**🟢 Live Demo:** https://believable-inspiration-production-b1c6.up.railway.app

Try DRAIN without writing code:

1. **Connect Wallet** – MetaMask on Polygon Mainnet
2. **Choose Provider & Model** – Select from available AI models
3. **Open Channel** – Deposit USDC ($0.50 - $100)
4. **Chat** – Each message signs a voucher and calls the real AI
5. **Close Channel** – Get unused USDC refunded

Features:
- Real blockchain transactions (USDC approval, channel open/close)
- EIP-712 voucher signing with MetaMask
- Live API calls to the DRAIN provider
- Real-time cost tracking per message

**Demo Mode** available for testing without real funds.

## Development Status

| Component               | Status         |
| ----------------------- | -------------- |
| Smart Contract          | ✅ Complete    |
| Test Suite (47 tests)   | ✅ Complete    |
| OpenZeppelin ECDSA      | ✅ Integrated  |
| Testnet Deployment      | ✅ Live on Amoy |
| **Mainnet Deployment**  | ✅ **LIVE** |
| **TypeScript SDK**      | ✅ **Available** |
| **Reference Provider**  | ✅ **Available** |
| **Demo Website**        | ✅ **[Live Demo](https://believable-inspiration-production-b1c6.up.railway.app/)** |
| **Provider Directory**  | ✅ **[Live](https://believable-inspiration-production-b1c6.up.railway.app/directory)** |
| **Live Provider**       | ✅ **[Online](https://drain-production-a9d4.up.railway.app/v1/pricing)** |
| **MCP Server**          | ✅ **[npm](https://www.npmjs.com/package/drain-mcp)** |
| Security Audit          | 📋 Planned     |

### Deployed Contracts

| Network | Contract | Address |
|---------|----------|---------|
| **Polygon Mainnet** | DrainChannel | [`0x1C1918C99b6DcE977392E4131C91654d8aB71e64`](https://polygonscan.com/address/0x1C1918C99b6DcE977392E4131C91654d8aB71e64) |
| Polygon Amoy (Testnet) | DrainChannel | [`0x61f1C1E04d6Da1C92D0aF1a3d7Dc0fEFc8794d7C`](https://amoy.polygonscan.com/address/0x61f1C1E04d6Da1C92D0aF1a3d7Dc0fEFc8794d7C) |

> ⚠️ **Note:** This contract has not been audited. Use at your own risk with small amounts.

## Getting Started

```bash
git clone https://github.com/kimbo128/DRAIN.git
cd DRAIN/contracts

# Install Foundry if needed: https://book.getfoundry.sh
forge build
forge test -vvv
```

### Test Coverage

```bash
forge test --gas-report  # Gas optimization
forge coverage           # Line coverage
```

## Target Chain

| Chain   | Tx Cost | Finality | USDC Liquidity |
| ------- | ------- | -------- | -------------- |
| Polygon | ~$0.02  | 5 sec    | $500M+ native  |

**Why Polygon?**
- Native USDC with Circle CCTP bridging
- 5-second finality enables 10-minute challenge periods
- Proven infrastructure, no reorgs

Future chains via CREATE2 for identical addresses.

## FAQ

<details>
<summary><strong>What if the provider doesn't deliver?</strong></summary>

Stop signing vouchers. Your USDC stays locked until expiry, then you can close the channel and get a full refund. The provider can only claim what you've signed.
</details>

<details>
<summary><strong>What if the consumer stops paying?</strong></summary>

Provider stops delivering service and claims the last valid voucher. The consumer's deposit covers all signed vouchers.
</details>

<details>
<summary><strong>Can I use ETH/MATIC instead of USDC?</strong></summary>

No. DRAIN v1 supports only USDC on Polygon. This keeps the protocol simple and prices predictable.
</details>

<details>
<summary><strong>Can I close a channel early?</strong></summary>

No. Channels have a fixed duration (e.g., 24h) to protect providers. After expiry, unused funds are refundable.
</details>

<details>
<summary><strong>When should providers claim?</strong></summary>

Recommended: when accumulated earnings exceed ~$10 (to amortize $0.02 gas). Providers can claim **at any time** – before, during, or after channel expiry.
</details>

<details>
<summary><strong>What happens to unclaimed vouchers after expiry?</strong></summary>

**Providers are protected by the channel duration.** Here's the timeline:

```
Channel Open → Provider can claim (anytime) → Channel Expiry → Consumer can close
     │                    │                        │                  │
     └────────────────────┴────────────────────────┴──────────────────┘
                    Provider can claim throughout this entire period
```

- **Provider can claim**: From channel open until consumer calls `close()`
- **Consumer can close**: Only AFTER channel expiry
- **The gap is your protection**: Even after expiry, if the consumer doesn't immediately close, you can still claim

**Example with 24h channel:**
1. Consumer opens channel at 10:00 AM
2. Consumer uses service, signs vouchers worth $5
3. Channel expires at 10:00 AM next day
4. Consumer might close at 2:00 PM (4 hours later)
5. Provider can claim anytime from 10:00 AM Day 1 until 2:00 PM Day 2 (28 hours!)

**Best practice:** Set up monitoring to claim before expiry, but know you have a buffer.
</details>

<details>
<summary><strong>Can I top up a channel?</strong></summary>

No. Open a new channel instead. This keeps the protocol simple and avoids edge cases.
</details>

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for guidelines.

## Security

This project has not yet been audited. Use at your own risk.

## License

[MIT License](./LICENSE) – Attribution required.

---

<p align="center">
<i>Permissionless AI infrastructure for an open economy.</i>
</p>
