import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../../lib/db';
import { CommissionPayout } from '../../../../../lib/models';
import { getTokenFromRequest, verifyToken } from '../../../../../lib/auth';

// PATCH: Update payout status (super-admin only)
export async function PATCH(
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

    const data = await request.json();
    const { status, notes } = data;

    if (!['approved', 'rejected', 'paid'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const payout = await CommissionPayout.findById(params.id);
    if (!payout) {
      return NextResponse.json({ error: 'Payout not found' }, { status: 404 });
    }

    payout.status = status;
    if (notes) {
      payout.notes = notes;
    }
    if (status === 'paid' || status === 'rejected') {
      payout.processedAt = new Date();
      payout.processedBy = payload.userId;
    }

    await payout.save();

    return NextResponse.json(payout);
  } catch (error: any) {
    console.error('Error updating payout:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE: Delete payout (super-admin only, for cleaning up test data)
export async function DELETE(
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

    // Only super-admins can delete payouts
    if (payload.role !== 'super-admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await connectDB();

    const payout = await CommissionPayout.findById(params.id);
    if (!payout) {
      return NextResponse.json({ error: 'Payout not found' }, { status: 404 });
    }

    // Only allow deleting pending payouts (safety measure)
    if (payout.status !== 'pending') {
      return NextResponse.json(
        { error: 'Can only delete pending payouts' },
        { status: 400 }
      );
    }

    await CommissionPayout.findByIdAndDelete(params.id);

    return NextResponse.json({ message: 'Payout deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting payout:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}



