import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { CommissionPayout } from '@/lib/models';
import { getTokenFromRequest, verifyToken } from '@/lib/auth';

// POST: Process payout (super-admin only) - This will call the Python service to send BTC
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

    // Only super-admins can process payouts
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

    // Call Python service to send BTC
    // The Python service will handle the actual Bitcoin transaction
    const pythonServiceUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';
    
    try {
      const sendResponse = await fetch(`${pythonServiceUrl}/api/payout/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Add authentication if needed
        },
        body: JSON.stringify({
          payout_id: params.id,
          to_address: payout.walletAddress,
          amount_btc: payout.amount,
          currency: payout.currency || 'BTC',
        }),
      });

      if (!sendResponse.ok) {
        const errorData = await sendResponse.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to process payout');
      }

      const sendResult = await sendResponse.json();

      if (sendResult.success) {
        // Update payout status
        payout.status = 'paid';
        payout.processedAt = new Date();
        payout.processedBy = payload.userId;
        if (sendResult.txid) {
          payout.notes = `Transaction ID: ${sendResult.txid}`;
        }
        await payout.save();

        return NextResponse.json({
          success: true,
          payout,
          txid: sendResult.txid,
          message: 'Payout processed successfully',
        });
      } else {
        // Update payout with error
        payout.notes = `Error: ${sendResult.error || 'Unknown error'}`;
        await payout.save();

        return NextResponse.json(
          { error: sendResult.error || 'Failed to process payout' },
          { status: 500 }
        );
      }
    } catch (error: any) {
      // If Python service is not available, return instructions for manual processing
      if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch')) {
        return NextResponse.json({
          success: false,
          error: 'Python payout service not available',
          instructions: [
            'To process payouts, you need to:',
            '1. Set up a Bitcoin wallet with API access',
            '2. Configure the Python service with wallet credentials',
            '3. Or manually send the BTC and update the payout status',
            '',
            `Send ${payout.amount} BTC to: ${payout.walletAddress}`,
          ],
          payout: {
            id: payout._id,
            amount: payout.amount,
            walletAddress: payout.walletAddress,
          },
        });
      }

      throw error;
    }
  } catch (error: any) {
    console.error('Error processing payout:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}



