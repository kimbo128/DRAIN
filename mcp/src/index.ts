#!/usr/bin/env node
/**
 * DRAIN MCP Server
 * 
 * Model Context Protocol server for autonomous AI payments.
 * Enables AI agents to pay for AI inference using DRAIN protocol.
 */

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
        version: '0.1.0',
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

const server = new DrainMcpServer();
server.run().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
