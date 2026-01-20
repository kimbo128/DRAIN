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

```
┌──────────────────────────────────────────────────────────────────┐
│                        Off-Chain (Fast)                          │
│                                                                  │
│    Consumer                                      Provider        │
│        │                                             │           │
│        │───────── Request ──────────────────────────►│           │
│        │◄──────── Token Stream ──────────────────────│           │
│        │───────── Signed Voucher ───────────────────►│           │
│        │◄──────── Token Stream ──────────────────────│           │
│        │                    ...                      │           │
│                                                                  │
└────────┼─────────────────────────────────────────────┼───────────┘
         │                                             │
         │              On-Chain (Rare)                │
         ▼                                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│                        DRAIN Contract                            │
│                                                                  │
│     open(provider, amount, duration)    →  Create channel        │
│     claim(channelId, amount, signature) →  Settle payment        │
│     close(channelId)                    →  Refund remainder      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

1. **Open** – Consumer deposits USDC into a payment channel
2. **Stream** – Provider delivers tokens, consumer signs incremental vouchers
3. **Settle** – Provider claims earnings on-chain, consumer withdraws remainder

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
├── contracts/
│   ├── src/DrainChannel.sol    # Core payment channel contract
│   ├── test/                   # 47 Foundry tests
│   └── script/                 # Deploy scripts
├── sdk/                        # TypeScript SDK
│   ├── src/consumer.ts         # Consumer: open, sign, close
│   └── src/provider.ts         # Provider: verify, claim
└── provider/                   # Reference AI Provider
    ├── src/index.ts            # Express server (OpenAI-compatible)
    ├── src/drain.ts            # Voucher validation
    └── src/config.ts           # Pricing configuration
```

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

OpenAI-compatible API server that accepts DRAIN payments:

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
