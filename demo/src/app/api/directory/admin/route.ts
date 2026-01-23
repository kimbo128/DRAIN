/**
 * DRAIN Directory API - Admin
 * 
 * GET /api/directory/admin - Get all providers (requires auth)
 * POST /api/directory/admin - Admin actions (approve, reject, test, delete)
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getAllProviders,
  getPendingProviders,
  getProviderById,
  approveProvider,
  rejectProvider,
  deleteProvider,
  updateProvider,
  testProviderConnection,
  runHealthChecks,
  verifyAdminPassword,
} from '@/lib/db';

// Verify admin auth from header
function verifyAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('x-admin-password');
  if (!authHeader) return false;
  return verifyAdminPassword(authHeader);
}

// GET - List all providers (admin only)
export async function GET(request: NextRequest) {
  if (!verifyAuth(request)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }
  
  try {
    const filter = request.nextUrl.searchParams.get('filter');
    
    let providers;
    if (filter === 'pending') {
      providers = getPendingProviders();
    } else {
      providers = getAllProviders();
    }
    
    return NextResponse.json({
      success: true,
      providers,
      counts: {
        total: getAllProviders().length,
        pending: getPendingProviders().length,
        approved: getAllProviders().filter(p => p.status === 'approved').length,
        rejected: getAllProviders().filter(p => p.status === 'rejected').length,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// POST - Admin actions
export async function POST(request: NextRequest) {
  if (!verifyAuth(request)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }
  
  try {
    const body = await request.json();
    const { action, providerId, reason } = body;
    
    switch (action) {
      case 'approve': {
        if (!providerId) {
          return NextResponse.json(
            { success: false, error: 'Missing providerId' },
            { status: 400 }
          );
        }
        
        const provider = getProviderById(providerId);
        if (!provider) {
          return NextResponse.json(
            { success: false, error: 'Provider not found' },
            { status: 404 }
          );
        }
        
        // Run connection test before approval
        const testResult = await testProviderConnection(
          provider.apiUrl,
          provider.providerAddress
        );
        
        if (!testResult.success) {
          return NextResponse.json({
            success: false,
            error: 'Connection test failed - cannot approve',
            testResult,
          }, { status: 400 });
        }
        
        // Update provider with pricing data
        updateProvider(providerId, {
          models: Object.entries(testResult.pricing?.models || {}).map(([id, pricing]: [string, any]) => ({
            id,
            name: id,
            inputCostPer1k: pricing.inputPer1kTokens,
            outputCostPer1k: pricing.outputPer1kTokens,
          })),
          chainId: testResult.pricing?.chainId,
          isOnline: true,
          lastCheckedAt: Date.now(),
          avgResponseTime: testResult.checks.responseTime,
        });
        
        const approved = approveProvider(providerId);
        
        return NextResponse.json({
          success: true,
          message: 'Provider approved',
          provider: approved,
          testResult,
        });
      }
      
      case 'reject': {
        if (!providerId) {
          return NextResponse.json(
            { success: false, error: 'Missing providerId' },
            { status: 400 }
          );
        }
        
        const rejected = rejectProvider(providerId, reason || 'No reason provided');
        if (!rejected) {
          return NextResponse.json(
            { success: false, error: 'Provider not found' },
            { status: 404 }
          );
        }
        
        return NextResponse.json({
          success: true,
          message: 'Provider rejected',
          provider: rejected,
        });
      }
      
      case 'delete': {
        if (!providerId) {
          return NextResponse.json(
            { success: false, error: 'Missing providerId' },
            { status: 400 }
          );
        }
        
        const deleted = deleteProvider(providerId);
        if (!deleted) {
          return NextResponse.json(
            { success: false, error: 'Provider not found' },
            { status: 404 }
          );
        }
        
        return NextResponse.json({
          success: true,
          message: 'Provider deleted',
        });
      }
      
      case 'test': {
        if (!providerId) {
          return NextResponse.json(
            { success: false, error: 'Missing providerId' },
            { status: 400 }
          );
        }
        
        const provider = getProviderById(providerId);
        if (!provider) {
          return NextResponse.json(
            { success: false, error: 'Provider not found' },
            { status: 404 }
          );
        }
        
        const testResult = await testProviderConnection(
          provider.apiUrl,
          provider.providerAddress
        );
        
        // Update provider stats
        updateProvider(providerId, {
          isOnline: testResult.success,
          lastCheckedAt: Date.now(),
          avgResponseTime: testResult.checks.responseTime,
        });
        
        return NextResponse.json({
          success: true,
          testResult,
        });
      }
      
      case 'health-check-all': {
        await runHealthChecks();
        return NextResponse.json({
          success: true,
          message: 'Health checks completed',
        });
      }
      
      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
