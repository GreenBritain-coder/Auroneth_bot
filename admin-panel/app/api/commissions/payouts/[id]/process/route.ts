import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { CommissionPayout } from '@/lib/models';
import { getTokenFromRequest, verifyToken } from '@/lib/auth';
import { processOnePayout } from '@/lib/processPayout';

// POST: Process payout (super-admin only) – calls Python; marks paid only when txid is returned
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    if (payload.role !== 'super-admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await connectDB();

    const payout = await CommissionPayout.findById(params.id);
    if (!payout) {
      return NextResponse.json({ error: 'Payout not found' }, { status: 404 });
    }

    if (payout.status !== 'approved') {
      return NextResponse.json(
        { error: 'Payout must be approved before processing' },
        { status: 400 }
      );
    }

    if (!payout.walletAddress) {
      return NextResponse.json(
        { error: 'Wallet address is required' },
        { status: 400 }
      );
    }

    const result = await processOnePayout(payout, payload.userId);

    if (result.success) {
      return NextResponse.json({
        success: true,
        payout,
        txid: result.txid,
        paid: result.paid,
        message: result.paid ? 'Payout sent successfully' : (result.message || 'Instructions generated; send manually then mark paid.'),
      });
    }

    return NextResponse.json(
      { error: result.error || 'Failed to process payout' },
      { status: 500 }
    );
  } catch (error: unknown) {
    console.error('Error processing payout:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}



