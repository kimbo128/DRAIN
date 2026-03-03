#!/usr/bin/env node
/**
 * DRAIN MCP Server
 *
 * Model Context Protocol server for the DRAIN payment protocol.
 * Agents discover providers, open USDC payment channels, and call any service.
 */

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
drain-mcp — MCP server for the DRAIN payment protocol

WHAT IS THIS?
  drain-mcp is a Model Context Protocol (MCP) server. It runs inside any
  MCP-compatible client and gives agents tools to discover service providers,
  open USDC payment channels on Polygon, and call any service — LLM, image
  generation, web scraping, VPN, and more. Pay per use, no API keys.

COMPATIBLE CLIENTS:
  Cursor, Claude Desktop, Cline, Windsurf, OpenAI Agents, or any MCP client.

CONFIGURATION:
  {
    "mcpServers": {
      "drain": {
        "command": "drain-mcp",
        "env": {
          "DRAIN_PRIVATE_KEY": "0x_your_polygon_wallet_private_key"
        }
      }
    }
  }

ENVIRONMENT VARIABLES:
  DRAIN_PRIVATE_KEY     (required) Polygon wallet private key
  DRAIN_CHAIN_ID        137 (Polygon, default) or 80002 (Amoy testnet)
  DRAIN_RPC_URL         Custom RPC endpoint
  DRAIN_DIRECTORY_URL   Provider directory URL
  DRAIN_MARKETPLACE_URL Marketplace base URL

MCP TOOLS PROVIDED:
  drain_providers       List service providers (filter by model, category)
  drain_provider_info   Provider details + usage instructions (docs)
  drain_balance         Check wallet USDC balance and allowance
  drain_approve         Approve USDC spending for the DRAIN contract
  drain_open_channel    Open a payment channel with a provider
  drain_close_channel       Close expired channel and reclaim funds
  drain_cooperative_close   Close channel immediately (provider co-signs)
  drain_channel_status      Check channel status and balance
  drain_channels            List all known channels with status
  drain_chat                Send a paid request to a provider

PROVIDER CATEGORIES:
  llm, image, audio, code, scraping, vpn, multi-modal, other
  Each provider has a docs endpoint explaining how to format requests.

LINKS:
  Marketplace:  https://handshake58.com
  Docs:         https://handshake58.com/skill.md
  Providers:    https://handshake58.com/api/mcp/providers
  npm:          https://www.npmjs.com/package/drain-mcp
  Source:       https://github.com/kimbo128/DRAIN
`);
  process.exit(0);
}

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { loadConfig, createClients, type DrainConfig } from './config.js';
import { WalletService } from './services/wallet.js';
import { ChannelService } from './services/channel.js';
import { ProviderService } from './services/provider.js';
import { InferenceService } from './services/inference.js';

import { providerTools, listProviders, getProvider } from './tools/providers.js';
import { balanceTools, getBalance, approveUsdc } from './tools/balance.js';
import { channelTools, openChannel, closeChannel, cooperativeClose, getChannelStatus, listChannels } from './tools/channel.js';
import { chatTools, chat } from './tools/chat.js';

// ============================================================================
// SERVER SETUP
// ============================================================================

class DrainMcpServer {
  private server: Server;
  private config: DrainConfig;
  private walletService: WalletService;
  private channelService: ChannelService;
  private providerService: ProviderService;
  private inferenceService: InferenceService;

  constructor() {
    // Load configuration
    this.config = loadConfig();
    
    // Create clients
    const { account, walletClient, publicClient } = createClients(this.config);
    
    // Initialize services
    this.walletService = new WalletService(publicClient, walletClient, account, this.config);
    this.channelService = new ChannelService(publicClient, walletClient, account, this.config);
    this.providerService = new ProviderService(this.config);
    this.inferenceService = new InferenceService(this.channelService);
    
    // Create MCP server
    this.server = new Server(
      {
        name: 'drain-mcp',
        version: '0.2.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );
    
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        ...providerTools,
        ...balanceTools,
        ...channelTools,
        ...chatTools,
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      try {
        let result: string;
        
        switch (name) {
          // Provider tools
          case 'drain_providers':
            result = await listProviders(this.providerService, args as { onlineOnly?: boolean; model?: string; category?: string });
            break;
          case 'drain_provider_info':
            result = await getProvider(this.providerService, args as { provider?: string; providerId?: string });
            break;
            
          // Balance tools
          case 'drain_balance':
            result = await getBalance(this.walletService, this.config);
            break;
          case 'drain_approve':
            result = await approveUsdc(this.walletService, args as { amount?: string });
            break;
            
          // Channel tools
          case 'drain_open_channel':
            result = await openChannel(
              this.channelService, 
              this.providerService,
              args as { provider: string; amount: string; duration: string }
            );
            break;
          case 'drain_close_channel':
            result = await closeChannel(this.channelService, args as { channelId: string });
            break;
          case 'drain_cooperative_close':
            result = await cooperativeClose(
              this.channelService,
              this.providerService,
              args as { channelId: string }
            );
            break;
          case 'drain_channel_status':
            result = await getChannelStatus(this.channelService, args as { channelId: string });
            break;
          case 'drain_channels':
            result = await listChannels(this.channelService);
            break;
            
          // Chat tools
          case 'drain_chat':
            result = await chat(
              this.channelService,
              this.providerService,
              this.inferenceService,
              args as {
                channelId: string;
                model: string;
                messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
                maxTokens?: number;
                temperature?: number;
              }
            );
            break;
            
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
        
        return {
          content: [{ type: 'text', text: result }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        };
      }
    });

    // List resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'drain://wallet',
          name: 'Wallet Status',
          description: 'Current wallet address, USDC balance, and allowance status',
          mimeType: 'text/markdown',
        },
        {
          uri: 'drain://providers',
          name: 'Service Providers',
          description: 'Available service providers with categories, pricing, and docs URLs',
          mimeType: 'text/markdown',
        },
      ],
    }));

    // Read resources
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      
      try {
        let content: string;
        
        switch (uri) {
          case 'drain://wallet':
            content = await getBalance(this.walletService, this.config);
            break;
          case 'drain://providers':
            content = await listProviders(this.providerService, {});
            break;
          default:
            throw new Error(`Unknown resource: ${uri}`);
        }
        
        return {
          contents: [{ uri, mimeType: 'text/markdown', text: content }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read resource: ${message}`);
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    // Log startup info to stderr (not stdout, which is for MCP protocol)
    console.error('DRAIN MCP Server started');
    console.error(`Wallet: ${this.walletService.getAddress()}`);
    console.error(`Network: ${this.config.chainId === 137 ? 'Polygon Mainnet' : 'Polygon Amoy'}`);
  }
}

// ============================================================================
// MAIN
// ============================================================================

try {
  const server = new DrainMcpServer();
  server.run().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('DRAIN_PRIVATE_KEY')) {
    console.error(`\n  drain-mcp: ${msg}\n`);
    console.error('  Setup:');
    console.error('    1. Create a Polygon wallet (MetaMask, Rabby, or any EVM wallet)');
    console.error('    2. Fund it with $5+ USDC (gas provided free via handshake58.com/api/gas-station)');
    console.error('    3. Add drain-mcp to your MCP client config:\n');
    console.error('       {');
    console.error('         "mcpServers": {');
    console.error('           "drain": {');
    console.error('             "command": "drain-mcp",');
    console.error('             "env": { "DRAIN_PRIVATE_KEY": "0x..." }');
    console.error('           }');
    console.error('         }');
    console.error('       }\n');
    console.error('  This is an MCP server, not a CLI tool. It runs inside AI clients');
    console.error('  like Cursor, Claude Desktop, Cline, Windsurf, or any MCP-compatible agent.\n');
    console.error('  Run drain-mcp --help for more information.\n');
  } else {
    console.error('Fatal error:', msg);
  }
  process.exit(1);
}
