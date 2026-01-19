# DRAIN

**Decentralized Runtime for AI Networks**

An open protocol for trustless, streaming micropayments between AI consumers and providers.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://claude.ai/chat/LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://claude.ai/chat/CONTRIBUTING.md)

---

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
│        │◄──────── Token Stream ─────────────────────│           │
│        │───────── Signed Voucher ──────────────────►│           │
│        │◄──────── Token Stream ─────────────────────│           │
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

Full specification: [`docs/SPECIFICATION.md`](https://claude.ai/chat/docs/SPECIFICATION.md)

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
| Smart Contracts         | 🚧 In Progress |
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

## Target Chains

| Chain    | Rationale                                |
| -------- | ---------------------------------------- |
| Base     | Low fees, growing ecosystem              |
| Arbitrum | Low fees, high liquidity                 |
| Polygon  | Low fees, established infrastructure     |
| Ethereum | Maximum security for high-value channels |

Contracts will be deployed to identical addresses across all chains via CREATE2.

## Contributing

DRAIN is seeking contributors with experience in:

* **Solidity** – Smart contract development and security
* **TypeScript** – SDK and tooling
* **Cryptography** – Payment channels and signature schemes
* **Protocol Design** – Distributed systems and game theory

See [`CONTRIBUTING.md`](https://claude.ai/chat/CONTRIBUTING.md) for guidelines.

## Security

This project has not yet been audited. Use at your own risk.

To report vulnerabilities, please email security@[tbd] or open a private security advisory.

## License

[MIT License](https://claude.ai/chat/LICENSE) – Attribution required.

---

<p align="center">
<i>Permissionless AI infrastructure for an open economy.</i>
</p>
