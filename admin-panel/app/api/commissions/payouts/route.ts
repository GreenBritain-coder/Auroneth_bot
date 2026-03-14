import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { CommissionPayout, Admin } from '../../../../lib/models';
import { getTokenFromRequest, verifyToken } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

// GET: Get payout history for the logged-in user (or all for super-admin)
export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    await connectDB();

    // Super-admins see all payouts, bot-owners only see their own
    const query = payload.role === 'super-admin'
      ? {}
      : { userId: payload.userId };

    const payouts = await CommissionPayout.find(query)
      .sort({ requestedAt: -1 })
      .lean();

    // If super-admin, enrich payouts with bot owner usernames
    if (payload.role === 'super-admin' && payouts.length > 0) {
      // Get unique user IDs
      const userIds = [...new Set(payouts.map(p => p.userId).filter(Boolean))];
      
      // Fetch admin users
      const admins = await Admin.find({ _id: { $in: userIds } })
        .select('username')
        .lean();
      
      // Create a map of userId -> username
      const adminMap = new Map(admins.map(a => [String(a._id), a.username]));
      
      // Add owner username to each payout
      const enrichedPayouts = payouts.map(payout => ({
        ...payout,
        ownerUsername: payout.userId ? adminMap.get(payout.userId) || null : null
      }));
      
      return NextResponse.json(enrichedPayouts);
    }

    return NextResponse.json(payouts);
  } catch (error: any) {
    console.error('Error fetching payouts:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}



