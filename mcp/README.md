# DRAIN MCP Server

**Payments for AI Agents** — No API keys, no credit cards, no subscriptions.

MCP server for the [Handshake58 AI Marketplace](https://handshake58.com). Agents discover service providers, pay automatically, and call any service — LLM inference, web scraping, image generation, search, and more.

Supports two payment protocols:
- **DRAIN** — Payment channels on Polygon. Open once, send many requests, close when done.
- **MPP** — Per-request payments via Tempo. Each request is paid individually. No channel needed.

| | DRAIN | MPP |
|---|---|---|
| Setup | Open channel ($0.02 gas) | None |
| Per request | $0.0001–$0.01 | Varies by provider |
| Best for | High-volume sessions | Single requests, REST APIs |
| Payment | USDC on Polygon | USDC on Tempo chain |

## When to Use

Use drain-mcp when you need to:
- Call any service (LLM, search, scraping, image gen, etc.) without API keys
- Pay per-request with USDC — no subscriptions, no credit cards
- Access 30+ providers through one unified interface

Do NOT use drain-mcp when:
- You already have API keys for the service you need
- The task doesn't require external services

---

## TL;DR - Minimum Viable Workflow

### MPP Providers (per-request, no channel)

```
1. drain_providers(protocol: "mpp")  → Find MPP providers
2. drain_provider_info(id)           → Read docs (essential for REST APIs)
3. mpp_chat(provider, messages)      → LLM providers (auto-pay via Tempo)
   — OR —
   mpp_request(url, body)            → REST API providers (auto-pay via Tempo)
4. drain_feedback(providerId, outcome) → Optional: report success/failure
```

### DRAIN Providers (payment channels)

```
1. drain_providers(protocol: "drain") → Find DRAIN providers
2. drain_provider_info(id)            → Get provider details + usage docs
3. drain_balance()                    → Check USDC + POL
4. drain_approve()                    → Approve USDC spending (once)
5. drain_open_channel(...)            → Deposit USDC, get channelId
6. drain_chat(...)                    → Send requests (repeat as needed)
7. drain_cooperative_close(...)       → Close early, instant refund (when done)
   — OR after expiry —
8. drain_close_channel(...)           → Reclaim funds (after expiry)
```

---

## When to Close a Channel

- **Done with your task?** → Use `drain_cooperative_close(channelId)`.
  Instant refund of unspent deposit. Always do this when finished.

- **Planning more requests soon?** → Keep the channel open.
  No need to close and reopen — saves $0.04 in gas fees.

- **Channel expired?** → Use `drain_close_channel(channelId)`.
  Reclaims unspent USDC after the expiry timestamp.
  Funds do NOT return automatically.

**Rule of thumb:** Close when the task is done. Keep open while working.

---

## Already Hit a 402?

**MPP providers:** drain-mcp handles 402 automatically via mppx/Tempo. Just use `mpp_chat` or `mpp_request` — payment is resolved transparently.

**DRAIN providers** return `402 Payment Required` with headers when no payment voucher is sent:

| Header | Value |
|---|---|
| `X-Payment-Protocol` | `drain-v2` |
| `X-Payment-Provider` | Provider wallet address (open channel to this) |
| `X-Payment-Contract` | DRAIN contract address |
| `X-Payment-Chain` | `137` (Polygon Mainnet) |
| `X-Payment-Signing` | URL for EIP-712 signing parameters |
| `X-Payment-Docs` | Provider docs endpoint |

**DRAIN Flow:**
1. Call a provider endpoint (no voucher) → get `402` with headers
2. Install `drain-mcp` or use the signing API at the `X-Payment-Signing` URL
3. Open a channel to the `X-Payment-Provider` address
4. Retry the request with an `X-DRAIN-Voucher` header

Everything you need is in the 402 response. No prior registration required.

---

## Tools Reference

### Discovery

#### drain_providers
Find service providers. Filter by model name, category, or online status.

```json
{
  "model": "gpt-4o",
  "category": "scraping",
  "onlineOnly": true
}
```

Categories: `llm`, `image`, `audio`, `code`, `scraping`, `vpn`, `multi-modal`, `other`

#### drain_provider_info
Get details about a provider including usage instructions (docs). The docs explain how to format requests for that provider.

```json
{ "provider": "hs58-openai" }
```

### Wallet

#### drain_balance
Check wallet USDC balance, POL for gas, and DRAIN contract allowance.

#### drain_approve
Approve USDC spending for the DRAIN contract. Required once before opening channels.

```json
{ "amount": "100" }
```

### Channels

#### drain_open_channel
Open a payment channel. Locks USDC for the specified duration.

```json
{
  "provider": "hs58-openai",
  "amount": "5.00",
  "duration": "24h"
}
```

Returns channelId, expiry time, and provider usage docs.

#### drain_channel_status
Check a channel's deposit, spending, remaining balance, and expiry.

#### drain_channels
List all known channels with status (active/expired/closed). Find expired channels that need closing.

### Usage (DRAIN)

#### drain_chat
Send a paid request through a DRAIN channel. Works for ALL DRAIN provider types:

- **LLM providers:** Standard chat messages
- **Non-LLM providers:** JSON payload in the user message content (check provider docs)

```json
{
  "channelId": "0x...",
  "model": "gpt-4o",
  "messages": [{"role": "user", "content": "Hello"}]
}
```

### Usage (MPP)

#### mpp_chat
Send a chat request to an MPP LLM provider. Payment is automatic via Tempo — no channel, no setup.

```json
{
  "provider": "provider-id-or-url",
  "messages": [{"role": "user", "content": "Hello"}],
  "model": "optional-model-id"
}
```

#### mpp_request
Send a request to an MPP REST API service (Tavily, Brave, Wolfram, etc.). Payment is automatic via Tempo.

```json
{
  "url": "https://tavily.mpp.paywithlocus.com/tavily/search",
  "body": {"query": "AI agents", "max_results": 5}
}
```

Read the provider's docs first (`drain_provider_info`) to find the correct endpoint paths and request format.

### Quality Feedback

#### drain_feedback
Report success or failure after using any provider (DRAIN or MPP). Feeds the marketplace quality scoring system.

```json
{
  "providerId": "provider-id",
  "outcome": "success",
  "reason": "accurate_result"
}
```

### Settlement

#### drain_cooperative_close
Close a channel early with provider consent. **Use this when your task is done** — instant refund of unspent deposit. No need to wait for expiry.

```json
{ "channelId": "0x..." }
```

#### drain_close_channel
Close an expired channel and reclaim unspent USDC. Use when the channel has passed its expiry timestamp.

```json
{ "channelId": "0x..." }
```

---

## Economics Example

Opening a GPT-4o channel:

```
Gas to open channel:     $0.02   (one-time)
Deposit:                 $0.50   (refundable remainder)
Per request:            ~$0.001755
Requests possible:      ~285

Cost for 10 requests:    $0.02 gas + $0.01755 usage = $0.04
Refund after close:      $0.50 - $0.01755 = $0.48
Gas to close:            $0.02
```

- Protocol fee: 2% on provider claims (on-chain)
- Session fee: none
- Live pricing: `GET https://handshake58.com/api/mcp/providers`

---

## Provider Categories

Providers are not limited to LLM chat. Each provider has a `category` field and a docs endpoint explaining how to format requests.

| Category | Description | Message Format |
|----------|-------------|----------------|
| llm | Language models (GPT-4o, Claude, Grok, Gemini) | Standard chat messages |
| image | Image generation | JSON in user content (see docs) |
| audio | Audio/TTS/STT | JSON in user content (see docs) |
| code | Code generation | Standard chat or JSON (see docs) |
| scraping | Web scraping, data extraction | JSON in user content (see docs) |
| vpn | VPN services | JSON in user content (see docs) |
| multi-modal | Multi-modal models | Standard chat messages |
| other | Everything else | Always check docs |

**Rule: For any category other than `llm`, call `drain_provider_info` first to read the docs.**

---

## Decision Trees

### Choosing a Protocol

```
What provider do I want?
├── MPP provider (protocol="mpp")
│   ├── mppType="llm" → mpp_chat(provider, messages)
│   └── mppType="rest" → mpp_request(url, body)
│   └── Done. Payment was automatic.
│
└── DRAIN provider (protocol="drain")
    └── See DRAIN flow below
```

### Starting a DRAIN Session

```
Do I have an active channel?
├── YES → Use drain_chat() with existing channelId
└── NO →
    ├── drain_balance() → Do I have USDC?
    │   ├── NO → Cannot proceed. Need USDC on Polygon.
    │   └── YES →
    │       ├── drain_providers() → Find provider
    │       │   ├── NO providers → Cannot proceed.
    │       │   └── Found provider →
    │       │       ├── drain_approve() → First time only
    │       │       └── drain_open_channel() → Get channelId
    │       │           └── drain_chat() → Send requests
```

### Ending a DRAIN Session

```
Am I done with this task?
├── YES → drain_cooperative_close(channelId) → Instant refund
└── NO →
    ├── More requests soon? → Keep channel open
    └── Channel expired? → drain_close_channel(channelId) → Reclaim funds
```

### Choosing Amount and Duration

| Use Case | Amount | Duration |
|----------|--------|----------|
| Quick test / single query | $0.50 - $1 | 1h |
| Short task (few queries) | $2 - $5 | 4h |
| Extended session | $5 - $20 | 24h |
| Long-running agent | $20 - $100 | 7d |

### Handling Errors

```
"Insufficient balance"
→ Need more USDC. Check drain_balance().

"Insufficient allowance"
→ Run drain_approve().

"Channel not found"
→ channelId is wrong or channel was closed. Open new channel.

"Channel expired"
→ For drain_chat: Open a new channel.
→ For drain_close_channel: Expected. Proceed with close.

"Insufficient channel balance"
→ Channel deposit used up. Open new channel with more funds.

"Provider offline"
→ Use drain_providers() to find alternative provider.
```

---

## Setup

### 1. Install

```bash
npm install -g drain-mcp
```

### 2. Create a Wallet (locally)

Generate a key on your own machine — nothing is sent over the network:

```bash
node -e "const w=require('ethers').Wallet.createRandom();console.log('Address:', w.address, '\nKey:', w.privateKey)"
```

### 3. Fund the Wallet

Send **$1–5 USDC** on **Polygon Mainnet** to your wallet address.
Use a dedicated low-value wallet — never your main wallet.

**No POL needed** — if your wallet holds $5+ USDC, free gas is provided:

```bash
curl -X POST https://handshake58.com/api/gas-station \
  -H "Content-Type: application/json" \
  -d '{"address": "0x_your_wallet_address"}'
```

Returns 0.1 POL (~10K transactions). Sends only your public address.

### 4. Configure MCP Client

```json
{
  "mcpServers": {
    "drain": {
      "command": "drain-mcp",
      "env": { "DRAIN_PRIVATE_KEY": "0x..." }
    }
  }
}
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DRAIN_PRIVATE_KEY` | Yes | — | Polygon wallet private key (also used for MPP/Tempo) |
| `DRAIN_CHAIN_ID` | No | 137 | 137 (Polygon) or 80002 (Amoy testnet) |
| `DRAIN_RPC_URL` | No | Public RPC | Custom Polygon RPC endpoint |
| `DRAIN_MPP_MAX_DEPOSIT` | No | 1 | Max USDC per MPP session deposit |

---

## Security & Privacy

### Key Handling
`DRAIN_PRIVATE_KEY` is loaded into memory by the local MCP process. It is used for:
1. EIP-712 voucher signing for DRAIN channels (off-chain, no network call)
2. On-chain transaction signing (signed locally, only the signature is broadcast)
3. Tempo payment signing for MPP requests (handled by mppx, signed locally)

The key is never transmitted to any server. Providers verify signatures against on-chain state.

### Spending Limits
**DRAIN:** Exposure is capped by the smart contract:
- Maximum spend = channel deposit (you choose the amount)
- Channel has a fixed duration (you choose)
- After expiry, unspent funds are reclaimable via `drain_close_channel`

**MPP:** Each request is paid individually at the provider's advertised price. No pre-deposit required.

Both protocols: No recurring charges, no stored payment methods.

### What Leaves Your Machine
- Public API queries to handshake58.com (provider list, config, channel status)
- Request messages to providers (sent to the provider's apiUrl, NOT to Handshake58)
- Signed payment vouchers (contain a cryptographic signature, not the key)
- Signed on-chain transactions (broadcast to Polygon RPC)

### What Stays Local
- Private key (never transmitted)
- All cryptographic operations (signing happens in-process)

### External Endpoints

Every network request the MCP server makes:

| Endpoint | Method | Data Sent | Key Transmitted? |
|---|---|---|---|
| handshake58.com/api/mcp/providers | GET | Nothing (public catalog) | No |
| handshake58.com/api/directory/config | GET | Nothing (reads fee wallet) | No |
| handshake58.com/api/channels/status | GET | channelId (public on-chain data) | No |
| handshake58.com/api/gas-station | POST | Wallet address | No |
| handshake58.com/api/telemetry | POST | Provider ID, latency, status, cost | No |
| handshake58.com/api/feedback | POST | Provider ID, outcome | No |
| Provider apiUrl /v1/docs | GET | Nothing (fetches usage docs) | No |
| Provider apiUrl /v1/chat/completions | POST | Request messages + signed voucher (DRAIN) | No |
| Provider apiUrl /v1/close-channel | POST | channelId + close signature | No |
| MPP provider endpoint | POST | Request body + Tempo payment (via mppx) | No |
| Polygon RPC (on-chain tx) | POST | Signed transactions | No |

### Safeguards
- Use a **dedicated wallet** with $1–5 USDC. Never reuse your main wallet.
- Always generate keys **locally**. The key stays on your machine.
- **Open source**: [github.com/kimbo128/DRAIN](https://github.com/kimbo128/DRAIN) (MIT licensed)
- Open channels with small deposits. Close promptly when done.

---

## Links

- NPM: https://www.npmjs.com/package/drain-mcp
- GitHub: https://github.com/kimbo128/DRAIN
- Marketplace: https://handshake58.com
- Provider Directory: https://handshake58.com/directory
- Contract: `0x0C2B3aA1e80629D572b1f200e6DF3586B3946A8A` (Polygon Mainnet)
