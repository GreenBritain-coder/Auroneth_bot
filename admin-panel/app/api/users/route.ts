import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../lib/db';

export const dynamic = 'force-dynamic';
import { User, Bot } from '../../../lib/models';
import { getTokenFromRequest, verifyToken } from '../../../lib/auth';

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

    // Pagination
    const page = Math.max(1, parseInt(request.nextUrl.searchParams.get('page') || '1'));
    const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '50'), 100); // Max 100 per page
    const skip = (page - 1) * limit;

    let query: any = {};
    if (payload.role !== 'super-admin') {
      // Bot-owners and demo users only see users that belong to their bots
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());

      if (userBotIds.length === 0) {
        return NextResponse.json({
          data: [],
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 0
          }
        });
      }

      query.botId = { $in: userBotIds };
    }

    // Get total count for pagination
    const total = await User.countDocuments(query);

    // Get paginated users
    const users = await User.find(query)
      .sort({ last_seen: -1, created_at: -1 })
      .skip(skip)
      .limit(limit);

    return NextResponse.json({
      data: users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

