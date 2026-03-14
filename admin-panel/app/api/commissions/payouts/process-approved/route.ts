import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { CommissionPayout } from '../../../../lib/models';
import { getTokenFromRequest, verifyToken } from '../../../../lib/auth';
import { processOnePayout } from '../../../../lib/processPayout';

/**
 * POST: Process all approved payouts (batch).
 * Auth: super-admin JWT or CRON_SECRET header (for cron jobs).
 * Only marks payout as 'paid' when the provider returns a txid.
 */
export async function POST(request: NextRequest) {
  try {
    const cronSecret = request.headers.get('x-cron-secret');
    const expectedSecret = process.env.CRON_SECRET;

    if (expectedSecret && cronSecret === expectedSecret) {
      // Cron auth
    } else {
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
    }

    await connectDB();

    const approved = await CommissionPayout.find({ status: 'approved' }).lean();
    if (approved.length === 0) {
      return NextResponse.json({ processed: 0, paid: 0, message: 'No approved payouts' });
    }

    const results: { id: string; paid: boolean; error?: string }[] = [];
    let paidCount = 0;

    for (const p of approved) {
      const payout = await CommissionPayout.findById(p._id);
      if (!payout || payout.status !== 'approved') continue;
      const result = await processOnePayout(payout, 'system');
      results.push({
        id: payout._id.toString(),
        paid: result.paid,
        error: result.error,
      });
      if (result.paid) paidCount++;
    }

    return NextResponse.json({
      processed: results.length,
      paid: paidCount,
      results,
    });
  } catch (error: unknown) {
    console.error('Error processing approved payouts:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
