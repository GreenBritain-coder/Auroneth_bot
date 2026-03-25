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

    if (payload.role === 'super-admin') {
      const users = await User.find({}).sort({ last_seen: -1, created_at: -1 });
      return NextResponse.json(users);
    }

    // Bot-owners and demo users only see users that belong to their bots
    const userBots = await Bot.find({ owner: payload.userId });
    const userBotIds = userBots.map(b => b._id.toString());

    if (userBotIds.length === 0) {
      return NextResponse.json([]);
    }

    const users = await User.find({ botId: { $in: userBotIds } }).sort({ last_seen: -1, created_at: -1 });
    return NextResponse.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

