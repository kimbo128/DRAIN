/**
 * Channel Tools
 */

import type { Hash, Address } from 'viem';
import type { ChannelService } from '../services/channel.js';
import type { ProviderService } from '../services/provider.js';
import type { Provider } from '../services/provider.js';

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
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

export async function openChannel(
  channelService: ChannelService,
  providerService: ProviderService,
  args: {
    provider: string;
    amount: string;
    duration: string;
  }
): Promise<string> {
  let providerAddress: Address;
  let providerName: string;
  let resolvedProvider: Provider | null = null;

  if (args.provider.startsWith('0x')) {
    providerAddress = args.provider as Address;
    providerName = args.provider;
    const allProviders = await providerService.getProviders();
    const matched = allProviders.find(
      p => p.providerAddress.toLowerCase() === providerAddress.toLowerCase()
    );
    if (matched) {
      providerName = matched.name;
      resolvedProvider = matched;
    }
  } else {
    const provider = await providerService.getProvider(args.provider);
    if (!provider) {
      throw new Error(`Provider "${args.provider}" not found. Use drain_providers to list available providers.`);
    }
    providerAddress = provider.providerAddress as Address;
    providerName = provider.name;
    resolvedProvider = provider;
  }

  const durationSeconds = parseDuration(args.duration);

  if (resolvedProvider) {
    try {
      const pingUrl = `${resolvedProvider.apiUrl}/v1/models`;
      const ping = await fetch(pingUrl, { signal: AbortSignal.timeout(8000) });
      if (!ping.ok && ping.status !== 402) {
        throw new Error(`Provider returned HTTP ${ping.status}`);
      }
    } catch (err: any) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new Error(
          `Provider "${resolvedProvider.name}" is not responding (timeout). ` +
          `Do NOT open a channel — your funds would be locked until expiry. ` +
          `Use drain_providers to find an alternative.`
        );
      }
      throw new Error(
        `Provider "${resolvedProvider.name}" is unreachable: ${err.message}. ` +
        `Do NOT open a channel to a dead provider. Use drain_providers to find an alternative.`
      );
    }
  }

  const result = await channelService.openChannel(providerAddress, args.amount, durationSeconds);

  if (resolvedProvider) {
    channelService.setChannelMeta(result.channelId, {
      providerId: resolvedProvider.id,
      providerName: resolvedProvider.name,
      category: resolvedProvider.category || 'llm',
      deposit: args.amount,
      expiry: Math.floor(result.channel.expiry.getTime() / 1000),
      openedAt: Math.floor(Date.now() / 1000),
    });
  }

  const expiryDate = result.channel.expiry.toISOString();
  const hours = Math.floor(durationSeconds / 3600);

  let docsSection = '';
  if (resolvedProvider) {
    const docs = await providerService.fetchDocs(resolvedProvider);
    if (docs) {
      docsSection = `\n## Provider Instructions\n\n${docs}\n`;
    } else {
      const docsUrl = resolvedProvider.docsUrl || `${resolvedProvider.apiUrl}/v1/docs`;
      docsSection = `\n## Provider Documentation\nBefore sending requests, read the provider docs: ${docsUrl}\n`;
    }
  }

  return `# Channel Opened

**Channel ID:** \`${result.channelId}\`
**Transaction:** \`${result.txHash}\`

## Details
- **Provider:** ${providerName} (${resolvedProvider?.category || 'llm'})
- **Deposit:** $${args.amount} USDC
- **Duration:** ${hours} hours
- **Expires:** ${expiryDate}
${docsSection}
## Next Steps
Use \`drain_chat\` to send requests through this channel.

**FUND RECOVERY:** After expiry (${expiryDate}), call \`drain_close_channel\` to reclaim unspent USDC. Funds do NOT return automatically. If you have cron/scheduling, set a timer for the expiry time.`;
}

export async function closeChannel(
  channelService: ChannelService,
  args: { channelId: string }
): Promise<string> {
  const channelId = args.channelId as Hash;
  const result = await channelService.closeChannel(channelId);

  return `# Channel Closed

**Channel ID:** \`${channelId}\`
**Transaction:** \`${result.txHash}\`
**Refunded:** $${result.refundAmount} USDC

The remaining balance has been returned to your wallet.`;
}

export async function cooperativeClose(
  channelService: ChannelService,
  providerService: ProviderService,
  args: { channelId: string }
): Promise<string> {
  const channelId = args.channelId as Hash;

  const meta = channelService.getChannelMeta(channelId);
  let providerUrl: string | undefined;

  if (meta?.providerId) {
    const provider = await providerService.getProvider(meta.providerId);
    if (provider) providerUrl = provider.apiUrl;
  }

  if (!providerUrl) {
    const channel = await channelService.getChannel(channelId);
    const allProviders = await providerService.getProviders();
    const matched = allProviders.find(
      p => p.providerAddress.toLowerCase() === channel.provider.toLowerCase()
    );
    if (matched) providerUrl = matched.apiUrl;
  }

  if (!providerUrl) {
    throw new Error(
      'Could not resolve provider API URL for this channel. ' +
      'The channel may have been opened outside this session.'
    );
  }

  const result = await channelService.cooperativeCloseChannel(channelId, providerUrl);

  return `# Channel Cooperatively Closed

**Channel ID:** \`${channelId}\`
**Transaction:** \`${result.txHash}\`

## Settlement
- **Provider Payout:** $${result.payout} USDC
- **Protocol Fee (2%):** $${result.fee} USDC
- **Refunded to You:** $${result.refundAmount} USDC

Channel closed immediately without waiting for expiry.`;
}

export async function getChannelStatus(
  channelService: ChannelService,
  args: { channelId: string }
): Promise<string> {
  const channelId = args.channelId as Hash;
  const channel = await channelService.getChannel(channelId);
  const localSpending = channelService.getSpending(channelId);

  const hoursRemaining = Math.floor(channel.secondsRemaining / 3600);
  const minutesRemaining = Math.floor((channel.secondsRemaining % 3600) / 60);

  const statusLabel = channel.isExpired ? 'EXPIRED' : 'ACTIVE';

  return `# Channel Status

**Channel ID:** \`${channel.id}\`
**Status:** ${statusLabel}

## Balances
- **Deposit:** $${channel.deposit} USDC
- **Claimed by Provider:** $${channel.claimed} USDC
- **Remaining:** $${channel.remaining} USDC
- **Local Spending (this session):** $${localSpending} USDC

## Timing
- **Expires:** ${channel.expiry.toISOString()}
- **Time Remaining:** ${channel.isExpired ? 'EXPIRED' : `${hoursRemaining}h ${minutesRemaining}m`}

${channel.isExpired ? 'Channel has expired. Call drain_close_channel to reclaim remaining funds.' : ''}`;
}

export async function listChannels(
  channelService: ChannelService,
): Promise<string> {
  const ids = channelService.getKnownChannelIds();

  if (ids.length === 0) {
    return 'No known channels. Open a channel with drain_open_channel first.';
  }

  const lines: string[] = [];
  let expiredCount = 0;

  for (const id of ids) {
    const meta = channelService.getChannelMeta(id);
    try {
      const ch = await channelService.getChannel(id);
      const status = ch.isExpired ? 'EXPIRED' : 'ACTIVE';
      if (ch.isExpired) expiredCount++;
      const name = meta?.providerName || ch.provider;
      const cat = meta?.category || 'llm';
      lines.push(
        `- \`${id}\` | ${status} | ${name} (${cat}) | $${ch.remaining} remaining | expires ${ch.expiry.toISOString()}`
      );
    } catch {
      lines.push(`- \`${id}\` | CLOSED or UNKNOWN | ${meta?.providerName || 'N/A'}`);
    }
  }

  let header = `# Known Channels\n\n${ids.length} channel(s):\n\n`;
  if (expiredCount > 0) {
    header += `**${expiredCount} expired channel(s) with reclaimable funds.** Call drain_close_channel for each.\n\n`;
  }

  return header + lines.join('\n');
}

export const channelTools = [
  {
    name: 'drain_open_channel',
    description: `Open a payment channel with a provider. Deposits USDC into the smart contract.

Prerequisites:
1. Sufficient USDC (drain_balance to check)
2. USDC approved for contract (drain_approve, one-time)
3. Small amount of POL for gas (~$0.02)

The response includes the channel expiry time and provider usage instructions.

FUND RECOVERY: After expiry, you MUST call drain_close_channel to reclaim unspent USDC. Funds do NOT auto-return. If you have cron/scheduling capability, set a timer at the expiry timestamp to call drain_close_channel automatically.

You can have multiple channels to different providers simultaneously.`,
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
    description: `Close an expired channel and reclaim unspent USDC.

Only callable after the channel has expired. Returns remaining deposit to wallet.

Schedule this at channel-open time. If you have cron/timer capability, set it for the expiry timestamp from drain_open_channel. Unclosed expired channels = locked funds.

If "Channel not expired" -> wait until expiry, then retry.`,
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
    description: `Check current status and balance of a payment channel.

Returns: deposit, spent, remaining balance, expiry time, and whether expired.

Use this to:
- Estimate remaining budget
- Check if channel needs closing (expired)
- Decide whether to open a new channel (low balance)`,
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
  {
    name: 'drain_cooperative_close',
    description: `Close a payment channel IMMEDIATELY by requesting a cooperative close from the provider.

Unlike drain_close_channel (which requires waiting for expiry), this contacts the provider's API to get a close signature, then settles on-chain right away. The provider gets paid for actual usage, the 2% protocol fee is deducted, and the remaining deposit is refunded to your wallet.

Use this when you're done with a channel and want your funds back now.

Falls back to drain_close_channel if the provider is offline or refuses.`,
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
    name: 'drain_channels',
    description: `List all known payment channels with their current status.

Shows channels this wallet has opened: status (active/expired/closed), provider, category, remaining balance, and expiry.

Use this to find expired channels that need closing to recover funds. If any channel shows EXPIRED, call drain_close_channel immediately.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];
