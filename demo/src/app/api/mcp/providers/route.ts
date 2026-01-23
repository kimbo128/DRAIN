/**
 * DRAIN Directory API - MCP Integration
 * 
 * GET /api/mcp/providers - Get providers in MCP-friendly format
 * 
 * This endpoint is designed for the DRAIN MCP Server to discover providers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getApprovedProviders } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const providers = getApprovedProviders();
    
    // Filter to only online providers by default
    const onlineOnly = request.nextUrl.searchParams.get('online') !== 'false';
    const filtered = onlineOnly ? providers.filter(p => p.isOnline) : providers;
    
    // Transform to MCP-friendly format
    const mcpProviders = filtered.map(p => ({
      // Basic info
      id: p.id,
      name: p.name,
      description: p.description,
      
      // Connection info
      apiUrl: p.apiUrl,
      providerAddress: p.providerAddress,
      chainId: p.chainId || 137,
      
      // Status
      status: {
        online: p.isOnline,
        lastChecked: p.lastCheckedAt,
        latencyMs: p.avgResponseTime,
      },
      
      // Models with pricing
      models: p.models.map(m => ({
        id: m.id,
        name: m.name,
        pricing: {
          inputPer1kTokens: m.inputCostPer1k,
          outputPer1kTokens: m.outputCostPer1k,
          currency: 'USDC',
          decimals: 6,
        },
      })),
    }));
    
    return NextResponse.json({
      version: '1.0',
      providers: mcpProviders,
      count: mcpProviders.length,
      timestamp: new Date().toISOString(),
      
      // Info for MCP clients
      _meta: {
        protocol: 'DRAIN',
        network: 'polygon',
        contract: '0x1C1918C99b6DcE977392E4131C91654d8aB71e64',
        directoryUrl: 'https://believable-inspiration-production-b1c6.up.railway.app/directory',
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
