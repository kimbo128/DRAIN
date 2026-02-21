/**
 * Provider Discovery Tools
 * 
 * Tools for discovering and inspecting DRAIN AI providers.
 */

import type { ProviderService, Provider } from '../services/provider.js';

/**
 * Format provider for display
 */
function formatProvider(p: Provider): string {
  const status = p.status.online ? '🟢 ONLINE' : '🔴 OFFLINE';
  const latency = p.status.latencyMs ? `${p.status.latencyMs}ms` : 'N/A';
  const models = p.models.map(m => `  - ${m.name} ($${m.pricing.inputPer1kTokens}/$${m.pricing.outputPer1kTokens} per 1k tokens)`).join('\n');
  
  return `
## ${p.name}
- **ID:** ${p.id}
- **Status:** ${status}
- **Latency:** ${latency}
- **Address:** ${p.providerAddress}
- **API:** ${p.apiUrl}
- **Docs:** ${p.docsUrl ?? 'N/A'}
- **Chain:** ${p.chainId === 137 ? 'Polygon Mainnet' : 'Polygon Amoy'}

**Description:** ${p.description}

**Models:**
${models}
`.trim();
}

/**
 * List all available providers
 */
export async function listProviders(
  providerService: ProviderService,
  args: { onlineOnly?: boolean; model?: string }
): Promise<string> {
  let providers: Provider[];
  
  if (args.model) {
    providers = await providerService.findByModel(args.model);
  } else if (args.onlineOnly) {
    providers = await providerService.getOnlineProviders();
  } else {
    providers = await providerService.getProviders();
  }
  
  if (providers.length === 0) {
    if (args.model) {
      return `No providers found supporting model "${args.model}".`;
    }
    return 'No providers available in the directory.';
  }
  
  const formatted = providers.map(formatProvider).join('\n\n---\n\n');
  
  return `# DRAIN AI Providers\n\nFound ${providers.length} provider(s):\n\n${formatted}`;
}

/**
 * Get details for a specific provider
 */
export async function getProvider(
  providerService: ProviderService,
  args: { providerId: string }
): Promise<string> {
  const provider = await providerService.getProvider(args.providerId);
  
  if (!provider) {
    return `Provider "${args.providerId}" not found.`;
  }
  
  return formatProvider(provider);
}

// Tool definitions for MCP
export const providerTools = [
  {
    name: 'drain_providers',
    description: `List available DRAIN AI providers. 
    
These are AI services that accept DRAIN micropayments for inference.
Use this to discover which providers and models are available before opening a channel.

Returns: List of providers with their models, pricing, and status.`,
    inputSchema: {
      type: 'object',
      properties: {
        onlineOnly: {
          type: 'boolean',
          description: 'If true, only return providers that are currently online',
        },
        model: {
          type: 'string',
          description: 'Filter providers by model name (e.g., "gpt-4o", "gpt-3.5-turbo")',
        },
      },
    },
  },
  {
    name: 'drain_provider_info',
    description: `Get detailed information about a specific DRAIN provider.
    
Returns: Provider details including all available models and their pricing.`,
    inputSchema: {
      type: 'object',
      properties: {
        providerId: {
          type: 'string',
          description: 'The provider ID to look up',
        },
      },
      required: ['providerId'],
    },
  },
];
