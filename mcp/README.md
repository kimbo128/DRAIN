# DRAIN MCP Server

MCP server for the DRAIN payment protocol. Agents discover service providers, open USDC payment channels on Polygon, and call any service — LLM inference, web scraping, image generation, VPN, and more. No API keys, no subscriptions.

## When to Use DRAIN

Use DRAIN when you need to:
- Call any service (LLM, scraping, image generation, etc.) without API keys
- Pay per-request with USDC on Polygon
- Access multiple service types through one protocol

Do NOT use DRAIN when:
- You already have API keys for the service you need
- The task doesn't require external services
- Cost is not a concern (DRAIN adds ~$0.04 blockchain overhead per session)

---

## TL;DR - Minimum Viable Workflow

```
1. drain_providers()            → Find providers (filter by model or category)
2. drain_provider_info(id)      → Get provider details + usage docs
3. drain_balance()              → Check USDC + POL
4. drain_approve()              → Approve USDC spending (once)
5. drain_open_channel(...)      → Deposit USDC, get channelId
6. drain_chat(...)              → Send requests (repeat as needed)
7. drain_channels()             → Check all channels
8. drain_close_channel(...)     → Reclaim funds (after expiry)
```

---

## Tools Reference

### drain_providers
Find service providers. Filter by model name, category, or online status.

```json
{
  "model": "gpt-4o",
  "category": "scraping",
  "onlineOnly": true
}
```

Categories: `llm`, `image`, `audio`, `code`, `scraping`, `vpn`, `multi-modal`, `other`

### drain_provider_info
Get details about a provider including usage instructions (docs). The docs explain how to format requests for that provider.

```json
{ "providerId": "hs58-openai" }
```

### drain_balance
Check wallet USDC balance, POL for gas, and DRAIN contract allowance.

### drain_approve
Approve USDC spending for the DRAIN contract. Required once before opening channels.

```json
{ "amount": "100" }
```

### drain_open_channel
Open a payment channel. Locks USDC for the specified duration.

```json
{
  "provider": "hs58-openai",
  "amount": "5.00",
  "duration": "24h"
}
```

Returns channelId, expiry time, and provider usage docs. **Set a cron/timer for the expiry time to call drain_close_channel and recover funds.**

### drain_chat
Send a paid request through a channel. Works for ALL provider types:

- **LLM providers:** Standard chat messages
- **Non-LLM providers:** JSON payload in the user message content (check provider docs)

```json
{
  "channelId": "0x...",
  "model": "gpt-4o",
  "messages": [{"role": "user", "content": "Hello"}]
}
```

### drain_channel_status
Check a channel's deposit, spending, remaining balance, and expiry.

### drain_channels
List all known channels with status (active/expired/closed). Find expired channels that need closing.

### drain_close_channel
Close an expired channel and reclaim unspent USDC.

---

## Provider Categories

Providers are not limited to LLM chat. Each provider has a `category` field and a docs endpoint explaining how to format requests.

| Category | Description | Message Format |
|----------|-------------|----------------|
| llm | Language models | Standard chat messages |
| image | Image generation | JSON in user content (see docs) |
| audio | Audio/TTS/STT | JSON in user content (see docs) |
| code | Code generation | Standard chat or JSON (see docs) |
| scraping | Web scraping | JSON in user content (see docs) |
| vpn | VPN services | JSON in user content (see docs) |
| multi-modal | Multi-modal models | Standard chat messages |
| other | Everything else | Always check docs |

**Rule: For any category other than `llm`, call `drain_provider_info` first to read the docs.**

---

## Decision Trees

### Starting a Session

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

### Agent Can Do

1. **Install** — `npm install -g drain-mcp`
2. **Create wallet** — `require('viem').generatePrivateKey()` or ask user for existing key
3. **Configure** — Add to MCP client config (see below)

### Requires Human

4. **Fund wallet** — Send $1-5 USDC + $0.10 POL on Polygon to the wallet address

### MCP Config

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

| Variable | Required | Default |
|----------|----------|---------|
| `DRAIN_PRIVATE_KEY` | Yes | — |
| `DRAIN_CHAIN_ID` | No | 137 (Polygon) |
| `DRAIN_RPC_URL` | No | polygon-rpc.com |

---

## Security & Privacy

### Key Handling
`DRAIN_PRIVATE_KEY` is loaded into memory by the local MCP process. It is used for:
1. EIP-712 voucher signing (off-chain, no network call)
2. On-chain transaction signing (signed locally, only the signature is broadcast)

The key is never transmitted to any server. Providers verify signatures against on-chain state.

### Spending Limits
Exposure is capped by the smart contract:
- Maximum spend = channel deposit (you choose the amount)
- Channel has a fixed duration (you choose)
- After expiry, unspent funds are reclaimable via drain_close_channel
- No recurring charges, no stored payment methods

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
| Provider apiUrl /v1/docs | GET | Nothing (fetches usage docs) | No |
| Provider apiUrl /v1/chat/completions | POST | Request messages + signed voucher | No |
| Polygon RPC (on-chain tx) | POST | Signed transactions | No |

### Safeguards
- Use a **dedicated wallet** with $1-5 USDC. Never reuse your main wallet.
- **Audit the source**: https://github.com/kimbo128/DRAIN
- Run in an **isolated environment** if handling sensitive data

---

## Links

- NPM: https://www.npmjs.com/package/drain-mcp
- GitHub: https://github.com/kimbo128/DRAIN
- Marketplace: https://handshake58.com
- Contract: `0x1C1918C99b6DcE977392E4131C91654d8aB71e64` (Polygon)
