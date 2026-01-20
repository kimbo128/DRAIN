# DRAIN Reference Provider

OpenAI-compatible AI provider that accepts DRAIN payments.

## Features

- ✅ 100% OpenAI API compatible (`/v1/chat/completions`)
- ✅ Streaming support (SSE)
- ✅ DRAIN voucher validation
- ✅ Configurable per-model pricing
- ✅ Automatic token counting
- ✅ Payment claiming

## Quick Start

### 1. Install Dependencies

```bash
cd provider
npm install
```

### 2. Configure Environment

```bash
cp env.example .env
```

Edit `.env`:

```env
OPENAI_API_KEY=sk-...
PROVIDER_PRIVATE_KEY=0x...
CHAIN_ID=137  # or 80002 for testnet
```

### 3. Run Server

```bash
npm run dev
```

## API Endpoints

### GET /v1/pricing

Get pricing for all models.

```bash
curl http://localhost:3000/v1/pricing
```

Response:
```json
{
  "provider": "0x...",
  "chainId": 137,
  "currency": "USDC",
  "decimals": 6,
  "models": {
    "gpt-4o": {
      "inputPer1kTokens": "0.0075",
      "outputPer1kTokens": "0.0225"
    }
  }
}
```

### POST /v1/chat/completions

OpenAI-compatible chat endpoint.

**Request Headers:**
```http
Content-Type: application/json
X-DRAIN-Voucher: {"channelId":"0x...","amount":"1000000","nonce":"1","signature":"0x..."}
```

**Request Body:** (identical to OpenAI)
```json
{
  "model": "gpt-4o",
  "messages": [
    {"role": "user", "content": "Hello!"}
  ],
  "stream": true
}
```

**Response Headers:**
```http
X-DRAIN-Cost: 52300
X-DRAIN-Total: 1240000
X-DRAIN-Remaining: 8760000
X-DRAIN-Channel: 0x...
```

**Response Body:** (identical to OpenAI)

### GET /v1/models

List available models.

### POST /v1/admin/claim

Trigger payment claims for all channels above threshold.

### GET /v1/admin/stats

Get provider statistics.

## Pricing Configuration

Set prices via environment variables (in USDC wei per 1000 tokens):

```env
# $0.0075 per 1K input tokens
PRICE_GPT4O_INPUT=7500

# $0.0225 per 1K output tokens  
PRICE_GPT4O_OUTPUT=22500
```

### Price Calculation Example

```
Request: 500 input tokens, 200 output tokens
Model: gpt-4o

Cost = (500 * 7500 / 1000) + (200 * 22500 / 1000)
     = 3750 + 4500
     = 8250 USDC wei
     = $0.00825
```

## DRAIN Headers

### Request

| Header | Description |
|--------|-------------|
| `X-DRAIN-Voucher` | JSON-encoded voucher with signature |

### Response

| Header | Description |
|--------|-------------|
| `X-DRAIN-Cost` | Cost of this request (USDC wei) |
| `X-DRAIN-Total` | Cumulative total charged (USDC wei) |
| `X-DRAIN-Remaining` | Remaining in channel (USDC wei) |
| `X-DRAIN-Channel` | Channel ID |

### Error Response

| Header | Description |
|--------|-------------|
| `X-DRAIN-Error` | Error code |
| `X-DRAIN-Required` | Required amount (if insufficient) |
| `X-DRAIN-Provided` | Provided amount (if insufficient) |

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `voucher_required` | 402 | Missing X-DRAIN-Voucher header |
| `invalid_voucher_format` | 402 | Malformed voucher JSON |
| `insufficient_funds` | 402 | Voucher amount too low |
| `invalid_signature` | 402 | Signature verification failed |
| `channel_not_found` | 402 | Channel doesn't exist |
| `wrong_provider` | 402 | Channel is for different provider |
| `model_not_supported` | 400 | Requested model not available |

## Claiming Payments

The provider stores vouchers and can claim payments:

```bash
# Manual claim
curl -X POST http://localhost:3000/v1/admin/claim

# Check stats
curl http://localhost:3000/v1/admin/stats
```

Configure claim threshold in `.env`:

```env
# Claim when earned >= $10
CLAIM_THRESHOLD=10000000
```

## Production Considerations

1. **Storage**: Replace file-based storage with a database
2. **Auth**: Protect `/v1/admin/*` endpoints
3. **Rate Limiting**: Add rate limiting
4. **Monitoring**: Add logging and metrics
5. **Claiming**: Set up automated claiming (cron job)

## License

MIT
