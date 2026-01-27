# DRAIN Demo - AI Agent Optimized

**Purpose**: Simple, machine-readable examples for AI agents to understand and use DRAIN protocol.

---

## Quick Start for AI Agents

### Prerequisites

- **USDC** on Polygon (minimum $0.10 recommended)
- **POL** on Polygon (for gas, ~$0.10 worth)
- **Private Key** (agent can generate)

### Installation

```bash
npm install @drain-protocol/sdk viem
```

### Minimal Example

```typescript
import { createDrainConsumer, CHAIN_IDS } from '@drain-protocol/sdk';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';

// 1. Setup wallet
const account = privateKeyToAccount('0x...'); // Agent's private key
const walletClient = createWalletClient({
  account,
  chain: polygon,
  transport: http(),
});

// 2. Create consumer
const consumer = createDrainConsumer(walletClient, account, {
  chainId: CHAIN_IDS.POLYGON_MAINNET,
});

// 3. Approve USDC (first time only)
await consumer.approveUsdc('10');

// 4. Open channel ($0.50, 24 hours)
const { channelId } = await consumer.openChannel({
  provider: '0xCCf2a94EcC6002b8Dd9d161ef15Bb4ABD5cD9E41', // DRAIN Reference Provider
  amount: '0.50',
  duration: '24h',
});

// 5. Sign voucher for request
const voucher = await consumer.signVoucher(channelId, '0.01'); // Estimated cost

// 6. Send request to provider
const response = await fetch('https://drain-production-a9d4.up.railway.app/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-DRAIN-Voucher': JSON.stringify({
      channelId,
      amount: voucher.amount.toString(),
      nonce: voucher.nonce.toString(),
      signature: voucher.signature,
    }),
  },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Hello' }],
  }),
});

const data = await response.json();
console.log(data.choices[0].message.content);

// 7. Close channel after expiry (get refund)
await consumer.closeChannel(channelId);
```

---

## Cost Reference

| Operation | Cost | Notes |
|-----------|------|-------|
| **USDC Approve** | ~$0.02 | One-time (max approval) |
| **Channel Open** | ~$0.02 | Per channel |
| **Channel Close** | ~$0.02 | After expiry |
| **Per Request** | $0.000005 | Actual cost (5 USDC wei) |
| **Session Overhead** | <$0.05 | Total for approve + open + close |

### Minimum Deposit Recommendations

| Deposit | Gas Overhead | Messages (gpt-4o-mini) | Use Case |
|---------|--------------|------------------------|----------|
| $0.10 | 40% | ~100 | Testing |
| $0.50 | 8% | ~500 | Recommended minimum |
| $1.00 | 4% | ~1000 | Optimal |
| $5.00 | 0.8% | ~5000 | Best value |

---

## MCP Server (Recommended for Agents)

For AI agents, use the DRAIN MCP Server instead of direct SDK usage:

```bash
npm install -g drain-mcp
```

Configure in Claude Desktop or Cursor:

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

**Available Tools**:
- `drain_providers` - Discover AI providers
- `drain_balance` - Check wallet balance
- `drain_open_channel` - Open payment channel
- `drain_chat` - AI chat with payment
- `drain_close_channel` - Close channel, get refund

See [MCP README](../mcp/README.md) for full documentation.

---

## Examples

### Example 1: Single Request

```typescript
// Open channel, make one request, close channel
const { channelId } = await consumer.openChannel({
  provider: '0x...',
  amount: '0.10',
  duration: '1h',
});

const voucher = await consumer.signVoucher(channelId, '0.01');
// ... make request ...

await consumer.closeChannel(channelId);
```

### Example 2: Multiple Requests

```typescript
// Open channel, make multiple requests, close channel
const { channelId } = await consumer.openChannel({
  provider: '0x...',
  amount: '1.00', // Enough for ~1000 requests
  duration: '24h',
});

// Request 1
const voucher1 = await consumer.signVoucher(channelId, '0.01');
// ... make request 1 ...

// Request 2 (cumulative amount)
const voucher2 = await consumer.signVoucher(channelId, '0.02');
// ... make request 2 ...

// Close after expiry
await consumer.closeChannel(channelId);
```

---

## Provider Discovery

Find available providers via MCP API:

```bash
curl https://believable-inspiration-production-b1c6.up.railway.app/api/mcp/providers
```

Or use the MCP Server's `drain_providers` tool.

---

## Test Results

**Verified Agent-to-Agent Test** (January 2026):
- Channel: $0.10 USDC
- Request cost: $0.000005 (5 USDC wei)
- 20,000 requests possible with $0.10
- Full autonomous operation verified

See [Test Results](../docs/AGENT_TEST_RESULTS.md) for detailed metrics.

---

## Comparison with Credit Cards

| Aspect | DRAIN | Credit Card |
|--------|-------|-------------|
| Agent Compatible | ✅ Yes | ❌ No |
| Micropayments | ✅ $0.000005 | ❌ $0.50-1.00 min |
| Setup Time | ~5 seconds | 5-10 minutes |
| Transaction Cost | ~$0.02 | 2-3% + $0.30 |

See [Comparison](../docs/COMPARISON.md) for full analysis.

---

## Resources

- **Protocol Documentation**: [README.md](../README.md)
- **SDK Documentation**: [sdk/README.md](../sdk/README.md)
- **MCP Server**: [mcp/README.md](../mcp/README.md)
- **Test Results**: [docs/AGENT_TEST_RESULTS.md](../docs/AGENT_TEST_RESULTS.md)
- **Verified Numbers**: [docs/VERIFIED_NUMBERS.md](../docs/VERIFIED_NUMBERS.md)

---

**Last Updated**: January 2026





