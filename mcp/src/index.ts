#!/usr/bin/env node
/**
 * DRAIN MCP Server
 * 
 * Model Context Protocol server for autonomous AI payments.
 * Enables AI agents to pay for AI inference using DRAIN protocol.
 */

// Handle --help before any imports that require configuration
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
drain-mcp — MCP server for AI agent payments via Handshake58

WHAT IS THIS?
  drain-mcp is a Model Context Protocol (MCP) server. It is NOT a standalone
  CLI tool. It runs inside any MCP-compatible AI client and gives the AI
  agent tools to discover providers, open payment channels, and call AI
  services — all paid with USDC micropayments on Polygon.

COMPATIBLE CLIENTS (any MCP-compatible agent):
  - Cursor          Add to .cursor/mcp.json
  - Claude Desktop  Add to claude_desktop_config.json
  - Cline           Add to MCP settings
  - Windsurf        Add to MCP config
  - OpenAI Agents   Via MCP bridge
  - Any agent that speaks Model Context Protocol

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
  DRAIN_PRIVATE_KEY     (required) Polygon wallet private key (0x + 64 hex chars)
                        Use a dedicated wallet with minimal funds ($1-5 USDC)
  DRAIN_CHAIN_ID        Chain ID: 137 (Polygon, default) or 80002 (Amoy testnet)
  DRAIN_RPC_URL         Custom RPC endpoint (default: polygon-rpc.com)
  DRAIN_DIRECTORY_URL   Provider directory URL
  DRAIN_MARKETPLACE_URL Marketplace base URL

MCP TOOLS PROVIDED:
  drain_providers       List available AI providers and models
  drain_provider_info   Get details for a specific provider
  drain_balance         Check wallet USDC balance and allowance
  drain_approve         Approve USDC spending for the DRAIN contract
  drain_open_channel    Open a payment channel with a provider
  drain_close_channel   Close an expired channel and reclaim funds
  drain_channel_status  Check the status of a payment channel
  drain_chat            Send a chat completion request to a provider

SETUP (agent can do most of this autonomously):
  AGENT CAN DO:
    1. Install drain-mcp (ask user to approve if needed)
    2. Create a Polygon wallet key programmatically:
         JavaScript: require('viem').generatePrivateKey()
         Or ask user for an existing wallet key
    3. Configure MCP client with the key

  REQUIRES HUMAN (the one thing agents cannot do):
    4. Fund the wallet on Polygon: $1-5 USDC + $0.10 POL for gas
       Give the user the wallet address and ask them to send funds

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

import type { Address } from 'viem';
import { loadConfig, createClients, type DrainConfig } from './config.js';
import { WalletService } from './services/wallet.js';
import { ChannelService } from './services/channel.js';
import { ProviderService } from './services/provider.js';
import { InferenceService } from './services/inference.js';

import { providerTools, listProviders, getProvider } from './tools/providers.js';
import { balanceTools, getBalance, approveUsdc } from './tools/balance.js';
import { channelTools, openChannel, closeChannel, getChannelStatus } from './tools/channel.js';
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
  private feeWallet: Address | null = null;

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
        version: '0.1.10',
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
            result = await listProviders(this.providerService, args as { onlineOnly?: boolean; model?: string });
            break;
          case 'drain_provider_info':
            result = await getProvider(this.providerService, args as { providerId: string });
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
              this.walletService,
              this.feeWallet,
              args as { provider: string; amount: string; duration: string }
            );
            break;
          case 'drain_close_channel':
            result = await closeChannel(this.channelService, args as { channelId: string });
            break;
          case 'drain_channel_status':
            result = await getChannelStatus(this.channelService, args as { channelId: string });
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
          name: 'AI Providers',
          description: 'List of available DRAIN AI providers',
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

  /**
   * Fetch marketplace fee wallet (cached for server lifetime)
   */
  private async loadFeeWallet(): Promise<void> {
    try {
      const url = `${this.config.marketplaceBaseUrl}/api/directory/config`;
      const res = await fetch(url);
      if (res.ok) {
        const cfg = await res.json() as { feeWallet?: string };
        if (cfg.feeWallet && /^0x[a-fA-F0-9]{40}$/.test(cfg.feeWallet)) {
          this.feeWallet = cfg.feeWallet as Address;
          console.error(`Fee wallet: ${this.feeWallet}`);
        }
      }
    } catch {
      console.error('Could not load marketplace config — session fees disabled');
    }
  }

  async run(): Promise<void> {
    // Load marketplace fee wallet before accepting requests
    await this.loadFeeWallet();
    
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
    console.error('    2. Fund it with $1-5 USDC + $0.10 POL for gas');
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
