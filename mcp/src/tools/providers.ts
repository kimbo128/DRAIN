/**
 * Provider Discovery Tools
 */

import type { ProviderService, Provider } from '../services/provider.js';

function formatPricing(m: Provider['models'][0]): string {
  const input = parseFloat(m.pricing.inputPer1kTokens);
  const output = parseFloat(m.pricing.outputPer1kTokens);
  if (output === 0 && input > 0) {
    return `$${m.pricing.inputPer1kTokens} per run (flat rate)`;
  }
  return `$${m.pricing.inputPer1kTokens} in / $${m.pricing.outputPer1kTokens} out per 1k tokens`;
}

function formatProvider(p: Provider): string {
  const status = p.status.online ? '🟢 ONLINE' : '🔴 OFFLINE';
  const latency = p.status.latencyMs ? `${p.status.latencyMs}ms` : 'N/A';
  const docsUrl = p.docsUrl || `${p.apiUrl}/v1/docs`;
  const models = p.models.map(m => `  - ${m.name} (${formatPricing(m)})`).join('\n');
  const protocol = p.protocol || 'drain';
  const quality = p.qualityScore && p.qualityScore > 0 ? ` | Q: ${p.qualityScore.toFixed(2)}` : '';
  const tool = protocol === 'mpp' ? 'mpp_chat' : 'drain_chat';

  return `
## ${p.name}
- **ID:** \`${p.id}\`  ← use this with drain_provider_info / ${protocol === 'mpp' ? 'mpp_chat' : 'drain_open_channel'}
- **Protocol:** ${protocol.toUpperCase()}${quality}
- **Category:** ${p.category || 'llm'}
- **Status:** ${status}
- **Latency:** ${latency}
- **Docs:** ${docsUrl}
- **Tool:** ${tool}
${p.mppEndpoint ? `- **MPP Endpoint:** ${p.mppEndpoint}` : `- **Chain:** ${p.chainId === 137 ? 'Polygon Mainnet' : 'Polygon Amoy'}`}

**Description:** ${p.description}

**Models / Services:**
${models}
`.trim();
}

export async function listProviders(
  providerService: ProviderService,
  args: { onlineOnly?: boolean; model?: string; category?: string; protocol?: string }
): Promise<string> {
  let providers: Provider[];

  if (args.model) {
    providers = await providerService.findByModel(args.model);
  } else if (args.onlineOnly) {
    providers = await providerService.getOnlineProviders();
  } else {
    providers = await providerService.getProviders();
  }

  if (args.category) {
    providers = providers.filter(p => (p.category || 'llm') === args.category);
  }

  if (args.protocol) {
    providers = providers.filter(p => (p.protocol || 'drain') === args.protocol);
  }

  if (providers.length === 0) {
    if (args.model) {
      return `No providers found supporting model "${args.model}".`;
    }
    if (args.category) {
      return `No providers found in category "${args.category}".`;
    }
    if (args.protocol) {
      return `No providers found with protocol "${args.protocol}".`;
    }
    return 'No providers available in the directory.';
  }

  const formatted = providers.map(formatProvider).join('\n\n---\n\n');

  return `# Providers\n\nFound ${providers.length} provider(s).\n\n**DRAIN providers:** Use \`drain_open_channel\` → \`drain_chat\` → \`drain_cooperative_close\`\n**MPP providers:** Use \`mpp_chat\` directly (no channel needed)\n\n${formatted}`;
}

export async function getProvider(
  providerService: ProviderService,
  args: { provider?: string; providerId?: string }
): Promise<string> {
  const id = args.provider || args.providerId;
  if (!id) return 'Missing provider ID. Pass the provider ID from drain_providers output.';
  const provider = await providerService.getProvider(id);

  if (!provider) {
    return `Provider "${args.providerId}" not found.`;
  }

  let result = formatProvider(provider);

  const docs = await providerService.fetchDocs(provider);
  if (docs) {
    result += `\n\n## Usage Instructions\n\n${docs}`;
  } else {
    const docsUrl = provider.docsUrl || `${provider.apiUrl}/v1/docs`;
    result += `\n\n## Usage Instructions\nFetch docs before sending requests: ${docsUrl}`;
  }

  return result;
}

export const providerTools = [
  {
    name: 'drain_providers',
    description: `List available service providers on the Handshake58 marketplace.

Supports two payment protocols:
- DRAIN: Payment channels on Polygon. Use drain_open_channel → drain_chat → drain_cooperative_close.
- MPP: Per-request HTTP 402 payments. Use mpp_chat directly (no channel needed).

Providers offer diverse services by category: llm, image, audio, code, scraping, vpn, multi-modal, other. Each provider has a docs endpoint with usage instructions for that service.

For any provider that is not category "llm", read its docs (via drain_provider_info) before sending requests to learn the expected message format.

Returns: Providers with protocol, category, quality score, pricing, and online status.`,
    inputSchema: {
      type: 'object',
      properties: {
        onlineOnly: {
          type: 'boolean',
          description: 'If true, only return providers that are currently online',
        },
        model: {
          type: 'string',
          description: 'Filter by model or service name (e.g. "gpt-4o", "web-scraper")',
        },
        category: {
          type: 'string',
          description: 'Filter by service category: llm, image, audio, code, scraping, vpn, multi-modal, other',
        },
        protocol: {
          type: 'string',
          enum: ['drain', 'mpp'],
          description: 'Filter by payment protocol: "drain" (channels) or "mpp" (per-request)',
        },
      },
    },
  },
  {
    name: 'drain_provider_info',
    description: `Get detailed information about a provider including usage instructions.

Returns provider details, available models/services, pricing, and docs content.
The docs explain how to format the messages parameter in drain_chat for this provider.
For non-LLM providers this is essential — the docs specify the expected JSON payload.`,
    inputSchema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          description: 'The provider ID to look up (from drain_providers output)',
        },
      },
      required: ['provider'],
    },
  },
];
