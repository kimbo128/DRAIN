# DRAIN MCP Server

> **For AI Agents:** This MCP server lets you pay for AI inference (GPT-4, Claude, etc.) using USDC on Polygon. No API keys needed - you pay per request through payment channels.

## What is DRAIN?

DRAIN is a protocol for AI-to-AI payments. Instead of API keys, you:
1. Open a **payment channel** with a provider (deposit USDC)
2. Make requests and **sign vouchers** for each payment
3. Close the channel when done (get unused funds back)

This MCP server handles all of this automatically.

---

## Quick Start for AI Agents

### Prerequisites
Your wallet needs:
- **USDC** on Polygon (for payments)
- **POL** on Polygon (for gas, ~0.1 POL is enough)

### Step-by-Step Workflow

```
1. CHECK PROVIDERS
   → drain_providers()
   Returns list of available AI providers with models and pricing

2. CHECK YOUR BALANCE  
   → drain_balance()
   Shows your USDC balance and wallet address

3. APPROVE USDC (first time only)
   → drain_approve(amount: "100")
   Allows DRAIN contract to use your USDC

4. OPEN A CHANNEL
   → drain_open_channel(
       providerId: "prov_initial_drain",
       amount: "5.00",      
       duration: "24h"       
     )
   Returns channelId - save this!

5. MAKE REQUESTS
   → drain_chat(
       channelId: "0x...",
       model: "gpt-4o",
       messages: [{"role": "user", "content": "Hello"}]
     )
   Automatically signs payment vouchers

6. CLOSE CHANNEL (after expiry)
   → drain_close_channel(channelId: "0x...")
   Returns unused USDC to your wallet
```

---

## Installation

### For Cursor IDE

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "drain": {
      "command": "npx",
      "args": ["-y", "drain-mcp"],
      "env": {
        "DRAIN_PRIVATE_KEY": "0x_YOUR_PRIVATE_KEY_HERE"
      }
    }
  }
}
```

### For Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "drain": {
      "command": "npx",
      "args": ["-y", "drain-mcp"],
      "env": {
        "DRAIN_PRIVATE_KEY": "0x_YOUR_PRIVATE_KEY_HERE"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DRAIN_PRIVATE_KEY` | ✅ Yes | - | Your wallet's private key |
| `DRAIN_CHAIN_ID` | No | `137` | Polygon Mainnet |
| `DRAIN_RPC_URL` | No | `https://polygon-rpc.com` | RPC endpoint |
| `DRAIN_DIRECTORY_URL` | No | Production URL | Provider directory |

---

## Available Tools

### 🔍 Discovery

| Tool | Parameters | Description |
|------|------------|-------------|
| `drain_providers` | `model?`, `onlineOnly?` | List available AI providers |
| `drain_provider_info` | `providerId` | Get provider details and pricing |

### 💰 Wallet

| Tool | Parameters | Description |
|------|------------|-------------|
| `drain_balance` | - | Check USDC and POL balance |
| `drain_approve` | `amount?` | Approve USDC for DRAIN contract |

### 📡 Channels

| Tool | Parameters | Description |
|------|------------|-------------|
| `drain_open_channel` | `providerId`, `amount`, `duration` | Open payment channel |
| `drain_close_channel` | `channelId` | Close expired channel, get refund |
| `drain_channel_status` | `channelId` | Check channel balance and expiry |

### 🤖 Inference

| Tool | Parameters | Description |
|------|------------|-------------|
| `drain_chat` | `channelId`, `model`, `messages`, `maxTokens?`, `temperature?` | Chat completion with auto-payment |

---

## Example: Complete Session

```
AI Agent wants to analyze code using GPT-4o

Step 1: Find a provider
> drain_providers(model: "gpt-4o")
→ Found: "DRAIN Reference Provider" - $0.0075/1k input, $0.0225/1k output

Step 2: Check funds
> drain_balance()
→ USDC: $50.00, POL: 2.5

Step 3: Open channel with $5 for 24 hours
> drain_open_channel(providerId: "prov_initial_drain", amount: "5.00", duration: "24h")
→ Channel opened: 0x7f8a...3b2c

Step 4: Use the AI
> drain_chat(channelId: "0x7f8a...3b2c", model: "gpt-4o", messages: [...])
→ Response received, paid $0.02

Step 5: Continue using...
> drain_chat(...)
→ Response received, paid $0.03

Step 6: After 24h, close and get refund
> drain_close_channel(channelId: "0x7f8a...3b2c")
→ Refunded: $4.95 USDC
```

---

## Pricing

Pricing is set by each provider. Typical rates:

| Model | Input/1k tokens | Output/1k tokens |
|-------|-----------------|------------------|
| gpt-4o | $0.0075 | $0.0225 |
| gpt-4o-mini | $0.00015 | $0.0006 |

Use `drain_providers()` to see current pricing.

---

## Funding Your Wallet

Your agent needs USDC and POL on Polygon:

### Get a Wallet
1. Generate a new private key for your agent
2. Save it securely - this wallet will hold funds

### Get USDC
- **Bridge from Ethereum:** [Polygon Bridge](https://wallet.polygon.technology/bridge)
- **Buy directly:** Coinbase, Binance support Polygon USDC
- **Circle:** [Circle Mint](https://www.circle.com/en/usdc)

### Get POL (for gas)
- Most exchanges support Polygon
- Minimal amount needed (~$0.10 worth)

---

## Security

⚠️ **Important:**
- Use a **dedicated wallet** for your agent
- Never share the private key
- Start with small amounts
- Monitor spending via `drain_balance()`

---

## Troubleshooting

### "Insufficient USDC balance"
→ Send USDC to your wallet on Polygon network

### "Insufficient gas"
→ Send POL to your wallet for transaction fees

### "Channel not found"
→ The channelId might be wrong, use `drain_channel_status()` to verify

### "Channel not expired"
→ You can only close channels after the duration ends

### "No providers found"
→ Check your internet connection, try `drain_providers(onlineOnly: false)`

---

## Links

- **NPM:** https://www.npmjs.com/package/drain-mcp
- **GitHub:** https://github.com/kimbo128/DRAIN
- **Marketplace:** https://believable-inspiration-production-b1c6.up.railway.app
- **Contract:** `0x1C1918C99b6DcE977392E4131C91654d8aB71e64` (Polygon)

---

## License

MIT
