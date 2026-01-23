# DRAIN MCP Server

Model Context Protocol (MCP) server for autonomous AI payments using the DRAIN protocol.

Enables AI agents to pay for AI inference without human intervention.

## Installation

```bash
npm install -g drain-mcp
```

Or run directly with npx:

```bash
npx drain-mcp
```

## Configuration

Set the following environment variables:

```bash
# REQUIRED: Your agent's wallet private key
export DRAIN_PRIVATE_KEY="0x..."

# OPTIONAL: Network (default: 137 = Polygon Mainnet)
export DRAIN_CHAIN_ID="137"

# OPTIONAL: Custom RPC URL
export DRAIN_RPC_URL="https://polygon-rpc.com"

# OPTIONAL: Provider directory URL
export DRAIN_DIRECTORY_URL="https://drain-marketplace.railway.app/api/mcp/providers"
```

## Usage with Cursor

Add to your Cursor settings (`~/.cursor/mcp.json`):

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

## Usage with Claude Desktop

Add to your Claude config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

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

## Available Tools

### Discovery

| Tool | Description |
|------|-------------|
| `drain_providers` | List available AI providers and their models |
| `drain_provider_info` | Get details about a specific provider |

### Wallet

| Tool | Description |
|------|-------------|
| `drain_balance` | Check USDC balance and wallet status |
| `drain_approve` | Approve USDC spending for DRAIN contract |

### Channels

| Tool | Description |
|------|-------------|
| `drain_open_channel` | Open a payment channel with a provider |
| `drain_close_channel` | Close an expired channel and get refund |
| `drain_channel_status` | Check channel balance and expiry |

### Inference

| Tool | Description |
|------|-------------|
| `drain_chat` | Send chat completion request with automatic payment |

## Example Workflow

```
Agent: "I need to use GPT-4 for analysis"

1. Check providers:
   → drain_providers(model: "gpt-4o")
   
2. Check balance:
   → drain_balance()
   
3. Approve USDC (if needed):
   → drain_approve()
   
4. Open channel:
   → drain_open_channel(provider: "drain-official", amount: "5.00", duration: "24h")
   
5. Make requests:
   → drain_chat(channelId: "0x...", model: "gpt-4o", messages: [...])
   
6. When done (after expiry):
   → drain_close_channel(channelId: "0x...")
```

## Resources

The server also exposes MCP resources:

| URI | Description |
|-----|-------------|
| `drain://wallet` | Current wallet status |
| `drain://providers` | List of available providers |

## Funding Your Agent

Before your agent can pay for services, it needs:

1. **USDC** - For paying AI providers
2. **POL** - For gas fees on Polygon

Send these tokens to your agent's wallet address (shown when the server starts).

### Getting USDC on Polygon

- Bridge from Ethereum: [Polygon Bridge](https://wallet.polygon.technology/bridge)
- Buy directly: Various exchanges support Polygon USDC
- Testnet: Use Amoy faucet for testing

## Security

- **Never share your private key**
- Use a dedicated wallet for your agent
- Consider using spending limits in production
- Monitor your agent's spending

## Development

```bash
# Clone the repo
git clone https://github.com/kimbo128/DRAIN.git
cd DRAIN/mcp

# Install dependencies
npm install

# Build
npm run build

# Run locally
DRAIN_PRIVATE_KEY="0x..." node dist/index.js
```

## License

MIT
