# DRAIN MCP Server

Pay for AI inference with USDC. No API keys needed.

## When to Use DRAIN

Use DRAIN when you need to:
- Call AI models (GPT-4, Claude, etc.) without API keys
- Pay per-request with cryptocurrency
- Operate autonomously without human payment setup

Do NOT use DRAIN when:
- You already have API keys for the model you need
- The task doesn't require external AI inference
- Cost is not a concern (DRAIN adds ~$0.04 blockchain overhead per session)

---

## TL;DR - Minimum Viable Workflow

```
1. drain_balance()                    → Check if you have USDC
2. drain_providers()                  → Find a provider with your model  
3. drain_open_channel(...)            → Deposit USDC (one-time per session)
4. drain_chat(...)                    → Use AI (repeat as needed)
5. drain_close_channel(...)           → Get refund (after expiry)
```

---

## Tools Reference

### drain_providers
Find AI providers.

```json
{
  "model": "gpt-4o",        // optional: filter by model
  "onlineOnly": true        // optional: only online providers (default: true)
}
```

Returns: List of providers with `id`, `name`, `apiUrl`, `models[]`, `status.online`

### drain_provider_info  
Get details about one provider.

```json
{
  "providerId": "prov_initial_drain"   // required
}
```

Returns: Full provider details including all models and pricing

### drain_balance
Check your wallet.

```json
{}  // no parameters
```

Returns: `{ usdc: { balance, formatted }, native: { balance, formatted }, address }`

### drain_approve
Allow DRAIN contract to spend your USDC. **Required before first channel.**

```json
{
  "amount": "100"    // optional: USDC amount (default: unlimited)
}
```

Returns: Transaction hash

### drain_open_channel
Open a payment channel. Locks USDC for the duration.

```json
{
  "providerId": "prov_initial_drain",  // required: from drain_providers()
  "amount": "5.00",                     // required: USDC to deposit
  "duration": "24h"                     // required: "1h", "24h", "7d", etc.
}
```

Returns: `{ channelId, provider, amount, expiresAt }`

**Save the channelId** - you need it for all subsequent calls.

### drain_channel_status
Check a channel's state.

```json
{
  "channelId": "0x..."    // required
}
```

Returns: `{ deposit, spent, remaining, expiresAt, isExpired }`

### drain_chat
Send a chat completion request. Automatically handles payment.

```json
{
  "channelId": "0x...",                           // required
  "model": "gpt-4o",                              // required
  "messages": [                                   // required
    {"role": "user", "content": "Hello"}
  ],
  "maxTokens": 1000,                              // optional
  "temperature": 0.7                              // optional
}
```

Returns: `{ response, usage: { cost, totalSpent, remaining } }`

### drain_close_channel
Close an expired channel and get refund.

```json
{
  "channelId": "0x..."    // required
}
```

Returns: `{ refunded, txHash }`

**Note:** Can only close AFTER channel expires (duration ended).

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
    │       ├── drain_providers() → Find provider with my model
    │       │   ├── NO providers → Cannot proceed. No providers available.
    │       │   └── Found provider →
    │       │       ├── drain_approve() → First time only, if not already approved
    │       │       └── drain_open_channel() → Get channelId
    │       │           └── drain_chat() → Make requests
```

### Choosing Amount and Duration

| Use Case | Amount | Duration |
|----------|--------|----------|
| Quick test / single query | $0.50 - $1 | 1h |
| Short task (few queries) | $2 - $5 | 4h |
| Extended session | $5 - $20 | 24h |
| Long-running agent | $20 - $100 | 7d |

Rule of thumb: **$0.01-0.05 per message** depending on model.

### Handling Errors

```
"Insufficient balance"
→ Need more USDC. Check drain_balance() for current amount.

"Insufficient allowance" 
→ Run drain_approve() to allow DRAIN contract to use USDC.

"Channel not found"
→ channelId is wrong or channel was closed. Open new channel.

"Channel expired"
→ For drain_chat(): Channel ended. Open new channel.
→ For drain_close_channel(): This is expected. Proceed with close.

"Insufficient channel balance"
→ Channel deposit used up. Open new channel with more funds.

"Provider offline"
→ Try drain_providers() to find alternative provider.
```

---

## Example Session

```
TASK: Analyze code using GPT-4o

STEP 1: Check wallet
> drain_balance()
← { usdc: { formatted: "50.00" }, native: { formatted: "2.5" } }
✓ Have funds

STEP 2: Find provider  
> drain_providers({ model: "gpt-4o" })
← [{ id: "prov_initial_drain", name: "DRAIN Reference Provider", 
     models: [{ id: "gpt-4o", pricing: { input: "0.0075", output: "0.0225" }}] }]
✓ Found provider

STEP 3: Open channel ($5, 24 hours)
> drain_open_channel({ providerId: "prov_initial_drain", amount: "5.00", duration: "24h" })
← { channelId: "0x7f8a9b2c...", expiresAt: "2026-01-24T12:00:00Z" }
✓ Channel open - SAVE THIS CHANNEL ID

STEP 4: Make requests (repeat as needed)
> drain_chat({ 
    channelId: "0x7f8a9b2c...", 
    model: "gpt-4o", 
    messages: [{ role: "user", content: "Explain this code: ..." }] 
  })
← { response: "This code...", usage: { cost: "0.02", remaining: "4.98" } }
✓ Got response

STEP 5: Check status (optional)
> drain_channel_status({ channelId: "0x7f8a9b2c..." })
← { deposit: "5.00", spent: "0.15", remaining: "4.85", isExpired: false }

STEP 6: Close after expiry (24h later)
> drain_close_channel({ channelId: "0x7f8a9b2c..." })
← { refunded: "4.85", txHash: "0x..." }
✓ Got refund
```

---

## Pricing Reference

| Model | Input/1k tokens | Output/1k tokens | ~Cost/message |
|-------|-----------------|------------------|---------------|
| gpt-4o | $0.0075 | $0.0225 | $0.01-0.05 |
| gpt-4o-mini | $0.00015 | $0.0006 | $0.001-0.005 |

Blockchain overhead: ~$0.02 per transaction (open, close, approve).

---

## State Management

**Persist the channelId** between calls. If you lose it:
1. You cannot make more requests on that channel
2. You cannot close the channel (funds locked until provider claims or you find the ID)

Recommended: Store channelId with creation timestamp and expiry.

---

## Prerequisites (for humans setting up the agent)

The agent's wallet needs:
- **USDC** on Polygon (for payments)
- **POL** on Polygon (for gas, ~$0.10 worth)

### Installation

Add to MCP config:

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

Config locations:
- Cursor: `~/.cursor/mcp.json`
- Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json`

### Environment Variables

| Variable | Required | Default |
|----------|----------|---------|
| `DRAIN_PRIVATE_KEY` | ✅ | - |
| `DRAIN_CHAIN_ID` | No | 137 (Polygon) |
| `DRAIN_RPC_URL` | No | https://polygon-rpc.com |

**RPC Note:** Free RPCs have rate limits. If you get "rate limit" errors, try:
- `https://polygon-bor-rpc.publicnode.com` (PublicNode)
- `https://rpc.ankr.com/polygon` (requires free API key)
- Or use a paid RPC provider (Alchemy, Infura)

---

## Lessons Learned (E2E Testing)

### Cost Estimation is Conservative

The MCP server estimates costs based on message length and model pricing. Actual costs are usually **much lower** (often 10-100x less than estimate). This is intentional to prevent over-spending, but means:
- A $0.10 channel can handle **many more requests** than you might think
- Don't worry if estimate seems high - actual cost will be lower

**Example:** Estimated $0.01, actual cost $0.000005 (5 USDC wei)

### Channel "claimed" vs "spent"

When checking `drain_channel_status()`, you'll see:
- `claimed`: Amount provider has claimed **on-chain** (usually 0 until they claim)
- `remaining`: Deposit minus claimed (not minus spent)

**Important:** Vouchers are signed off-chain. The provider can claim anytime, but usually waits to accumulate multiple payments to save gas.

### RPC Rate Limits

Free public RPCs (like `polygon-rpc.com`) have rate limits. If you see errors:
1. Wait 10-15 seconds and retry
2. Switch to a different RPC (see Environment Variables above)
3. Use a paid RPC for production

### Channel ID is Critical

**Always persist the channelId!** If you lose it:
- You cannot make more requests
- You cannot close the channel (funds locked until expiry + provider claims)

**Best practice:** Store channelId immediately after `drain_open_channel()` with:
- Creation timestamp
- Expiry timestamp  
- Provider ID

### Actual Costs are Tiny

Real-world example from E2E test:
- Channel: $0.10 USDC
- Request: "What is 2+2?" → "Four."
- Actual cost: **$0.000005** (5 USDC wei)
- You could make **20,000 requests** with $0.10!

This means small channels ($0.10-$0.50) are perfect for testing and light usage.

---

## Links

- NPM: https://www.npmjs.com/package/drain-mcp
- GitHub: https://github.com/kimbo128/DRAIN
- Marketplace: https://believable-inspiration-production-b1c6.up.railway.app
- Contract: `0x1C1918C99b6DcE977392E4131C91654d8aB71e64` (Polygon)
