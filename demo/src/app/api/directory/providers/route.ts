/**
 * DRAIN Directory API - Providers
 * 
 * GET /api/directory/providers - List approved providers (public)
 * POST /api/directory/providers - Submit new provider (public)
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  getApprovedProviders, 
  addProvider, 
  getProviderByAddress,
  testProviderConnection 
} from '@/lib/db';

// GET - List approved providers (public)
export async function GET() {
  try {
    const providers = getApprovedProviders();
    
    // Return public-safe data
    const publicProviders = providers.map(p => ({
      id: p.id,
      name: p.name,
      apiUrl: p.apiUrl,
      providerAddress: p.providerAddress,
      description: p.description,
      logoUrl: p.logoUrl,
      website: p.website,
      isOnline: p.isOnline,
      lastCheckedAt: p.lastCheckedAt,
      avgResponseTime: p.avgResponseTime,
      models: p.models,
      chainId: p.chainId,
    }));
    
    return NextResponse.json({
      success: true,
      providers: publicProviders,
      count: publicProviders.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// POST - Submit new provider
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate required fields
    const required = ['name', 'apiUrl', 'providerAddress', 'description', 'contactEmail'];
    for (const field of required) {
      if (!body[field]) {
        return NextResponse.json(
          { success: false, error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }
    
    // Validate provider address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(body.providerAddress)) {
      return NextResponse.json(
        { success: false, error: 'Invalid provider address format' },
        { status: 400 }
      );
    }
    
    // Validate URL format
    try {
      new URL(body.apiUrl);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid API URL format' },
        { status: 400 }
      );
    }
    
    // Check if provider address already exists
    const existing = getProviderByAddress(body.providerAddress);
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'Provider with this address already registered' },
        { status: 409 }
      );
    }
    
    // Run initial connection test
    const testResult = await testProviderConnection(body.apiUrl, body.providerAddress);
    
    if (!testResult.success) {
      return NextResponse.json({
        success: false,
        error: 'Connection test failed',
        testResult,
      }, { status: 400 });
    }
    
    // Add provider
    const provider = addProvider({
      name: body.name,
      apiUrl: body.apiUrl.replace(/\/$/, ''), // Remove trailing slash
      providerAddress: body.providerAddress,
      description: body.description,
      logoUrl: body.logoUrl || undefined,
      contactEmail: body.contactEmail,
      website: body.website || undefined,
    });
    
    return NextResponse.json({
      success: true,
      message: 'Provider submitted for review',
      provider: {
        id: provider.id,
        name: provider.name,
        status: provider.status,
      },
      testResult,
    });
    
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
