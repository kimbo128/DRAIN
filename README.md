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

Full specification: [`docs/SPECIFICATION.md`](./docs/SPECIFICATION.md)

Research & design rationale: [`LEARNINGS.md`](./LEARNINGS.md)

## Project Structure

```
drain/
├── contracts/          # Solidity smart contracts (Foundry)
├── sdk/                # TypeScript client SDK
├── provider/           # Reference provider implementation
├── docs/               # Protocol specification
└── examples/           # Integration examples
```

## Development Status

| Component               | Status         |
| ----------------------- | -------------- |
| Protocol Specification  | ✅ Complete    |
| Smart Contract          | 🚧 In Progress |
| Client SDK              | 📋 Planned     |
| Provider Implementation | 📋 Planned     |
| Testnet Deployment      | 📋 Planned     |
| Security Audit          | 📋 Planned     |

## Getting Started

```bash
git clone https://github.com/kimbo128/DRAIN.git
cd DRAIN
```

### Contracts

```bash
cd contracts
forge install
forge build
forge test
```

### SDK

```bash
cd sdk
pnpm install
pnpm build
pnpm test
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
