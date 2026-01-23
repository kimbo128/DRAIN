/**
 * DRAIN Directory API - Health Check
 * 
 * GET /api/directory/health - Run health checks on all approved providers
 * 
 * This endpoint can be called by:
 * - Vercel Cron (vercel.json)
 * - External cron services
 * - Manual trigger
 */

import { NextRequest, NextResponse } from 'next/server';
import { runHealthChecks, getApprovedProviders } from '@/lib/db';

// Optional: Protect with secret for cron jobs
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  // Verify cron secret if set
  if (CRON_SECRET) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
  }
  
  try {
    const beforeCount = getApprovedProviders().length;
    
    await runHealthChecks();
    
    const afterProviders = getApprovedProviders();
    const onlineCount = afterProviders.filter(p => p.isOnline).length;
    
    return NextResponse.json({
      success: true,
      message: 'Health checks completed',
      stats: {
        total: afterProviders.length,
        online: onlineCount,
        offline: afterProviders.length - onlineCount,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
