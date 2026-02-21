/**
 * Channel Tools
 * 
 * Manage payment channels: open, close, status.
 */

import type { Hash, Address } from 'viem';
import type { ChannelService } from '../services/channel.js';
import type { ProviderService } from '../services/provider.js';
import type { WalletService } from '../services/wallet.js';
import { SESSION_FEE, USDC_DECIMALS } from '../constants.js';
import { formatUnits } from 'viem';

/**
 * Parse duration string to seconds
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    // Try parsing as raw seconds
    const seconds = parseInt(duration);
    if (!isNaN(seconds)) return seconds;
    throw new Error(`Invalid duration format: ${duration}. Use formats like "1h", "24h", "7d", or seconds.`);
  }
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: throw new Error(`Unknown duration unit: ${unit}`);
  }
}

/**
 * Open a payment channel
 */
export async function openChannel(
  channelService: ChannelService,
  providerService: ProviderService,
  walletService: WalletService,
  feeWallet: Address | null,
  args: { 
    provider: string;  // Provider ID or address
    amount: string;    // USDC amount
    duration: string;  // Duration like "24h", "7d"
  }
): Promise<string> {
  // Resolve provider address and ID
  let providerAddress: Address;
  let providerName: string;
  let providerId: string | undefined;
  
  if (args.provider.startsWith('0x')) {
    providerAddress = args.provider as Address;
    providerName = args.provider;
  } else {
    const provider = await providerService.getProvider(args.provider);
    if (!provider) {
      throw new Error(`Provider "${args.provider}" not found. Use drain_providers to list available providers.`);
    }
    providerAddress = provider.providerAddress as Address;
    providerName = provider.name;
    providerId = provider.id;
  }
  
  const durationSeconds = parseDuration(args.duration);
  
  // Pay marketplace session fee ($0.01 USDC)
  let feeTxHash: string | null = null;
  if (feeWallet) {
    try {
      feeTxHash = await walletService.transferUsdc(feeWallet, SESSION_FEE);
    } catch (err) {
      console.error('Session fee payment failed:', err instanceof Error ? err.message : err);
    }
  }
  
  const result = await channelService.openChannel(providerAddress, args.amount, durationSeconds);
  
  if (providerId) {
    channelService.setProviderId(result.channelId, providerId);
  }
  
  const expiryDate = result.channel.expiry.toISOString();
  const hours = Math.floor(durationSeconds / 3600);
  const feeAmount = formatUnits(SESSION_FEE, USDC_DECIMALS);
  
  const feeSection = feeTxHash
    ? `- **Session Fee:** $${feeAmount} USDC (tx: \`${feeTxHash}\`)`
    : feeWallet
      ? `- **Session Fee:** ⚠️ Payment failed (channel opened anyway)`
      : '';
  
  return `# ✅ Channel Opened

**Channel ID:** \`${result.channelId}\`
**Transaction:** \`${result.txHash}\`

## Details
- **Provider:** ${providerName} (\`${providerAddress}\`)
- **Deposit:** $${args.amount} USDC
${feeSection ? feeSection + '\n' : ''}- **Duration:** ${hours} hours
- **Expires:** ${expiryDate}

## Next Steps
Use \`drain_chat\` to make AI requests through this channel.
The channel ID will be used automatically, or you can specify it explicitly.

When finished, wait for expiry and use \`drain_close_channel\` to reclaim unused funds.`;
}

/**
 * Close an expired channel
 */
export async function closeChannel(
  channelService: ChannelService,
  args: { channelId: string }
): Promise<string> {
  const channelId = args.channelId as Hash;
  
  const result = await channelService.closeChannel(channelId);
  
  return `# ✅ Channel Closed

**Channel ID:** \`${channelId}\`
**Transaction:** \`${result.txHash}\`
**Refunded:** $${result.refundAmount} USDC

The remaining balance has been returned to your wallet.`;
}

/**
 * Get channel status
 */
export async function getChannelStatus(
  channelService: ChannelService,
  args: { channelId: string }
): Promise<string> {
  const channelId = args.channelId as Hash;
  const channel = await channelService.getChannel(channelId);
  const localSpending = channelService.getSpending(channelId);
  
  const hoursRemaining = Math.floor(channel.secondsRemaining / 3600);
  const minutesRemaining = Math.floor((channel.secondsRemaining % 3600) / 60);
  
  const statusEmoji = channel.isExpired ? '⏰ EXPIRED' : '🟢 ACTIVE';
  
  return `# Channel Status

**Channel ID:** \`${channel.id}\`
**Status:** ${statusEmoji}

## Balances
- **Deposit:** $${channel.deposit} USDC
- **Claimed by Provider:** $${channel.claimed} USDC
- **Remaining:** $${channel.remaining} USDC
- **Local Spending (this session):** $${localSpending} USDC

## Timing
- **Expires:** ${channel.expiry.toISOString()}
- **Time Remaining:** ${channel.isExpired ? 'EXPIRED' : `${hoursRemaining}h ${minutesRemaining}m`}

${channel.isExpired ? '⚠️ Channel has expired. You can now close it to reclaim remaining funds using `drain_close_channel`.' : ''}`;
}

// Tool definitions for MCP
export const channelTools = [
  {
    name: 'drain_open_channel',
    description: `Open a DRAIN payment channel with an AI provider.

This deposits USDC into a smart contract, creating a payment channel.
You can then use the channel to pay for AI inference requests.

IMPORTANT: You must have:
1. Sufficient USDC balance
2. USDC approved for the DRAIN contract (use drain_approve if needed)
3. POL for gas fees

The channel will expire after the specified duration. After expiry, you can close it to reclaim unused funds.`,
    inputSchema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          description: 'Provider ID (from drain_providers) or provider wallet address (0x...)',
        },
        amount: {
          type: 'string',
          description: 'Amount of USDC to deposit (e.g., "5.00" for $5)',
        },
        duration: {
          type: 'string',
          description: 'Channel duration. Examples: "1h", "24h", "7d", or seconds like "3600"',
        },
      },
      required: ['provider', 'amount', 'duration'],
    },
  },
  {
    name: 'drain_close_channel',
    description: `Close an expired DRAIN payment channel and reclaim remaining funds.

Can only be called after the channel has expired.
Any unused deposit will be returned to your wallet.`,
    inputSchema: {
      type: 'object',
      properties: {
        channelId: {
          type: 'string',
          description: 'The channel ID to close (0x...)',
        },
      },
      required: ['channelId'],
    },
  },
  {
    name: 'drain_channel_status',
    description: `Get the current status of a DRAIN payment channel.

Shows deposit, spending, remaining balance, and expiry time.`,
    inputSchema: {
      type: 'object',
      properties: {
        channelId: {
          type: 'string',
          description: 'The channel ID to check (0x...)',
        },
      },
      required: ['channelId'],
    },
  },
];
