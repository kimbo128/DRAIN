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

  return `
## ${p.name}
- **ID:** \`${p.id}\`  ← use this with drain_provider_info / drain_open_channel
- **Category:** ${p.category || 'llm'}
- **Status:** ${status}
- **Latency:** ${latency}
- **Docs:** ${docsUrl}
- **Chain:** ${p.chainId === 137 ? 'Polygon Mainnet' : 'Polygon Amoy'}

**Description:** ${p.description}

**Models / Services:**
${models}
`.trim();
}

export async function listProviders(
  providerService: ProviderService,
  args: { onlineOnly?: boolean; model?: string; category?: string }
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

  if (providers.length === 0) {
    if (args.model) {
      return `No providers found supporting model "${args.model}".`;
    }
    if (args.category) {
      return `No providers found in category "${args.category}".`;
    }
    return 'No providers available in the directory.';
  }

  const formatted = providers.map(formatProvider).join('\n\n---\n\n');

  return `# DRAIN Providers\n\nFound ${providers.length} provider(s).\n\n**Usage:** Pass the provider **ID** to \`drain_provider_info(provider: "<ID>")\` for docs, or to \`drain_open_channel(provider: "<ID>", ...)\` to open a channel.\n\n${formatted}`;
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
    description: `List available service providers on the DRAIN marketplace.

Providers offer diverse services by category: llm, image, audio, code, scraping, vpn, multi-modal, other. Each provider has a docs endpoint with usage instructions for that service.

For any provider that is not category "llm", read its docs (via drain_provider_info) before sending requests to learn the expected message format.

You can open channels to multiple providers simultaneously for multi-service workflows.

Returns: Providers with category, models/services, pricing, docs URL, and online status.`,
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
