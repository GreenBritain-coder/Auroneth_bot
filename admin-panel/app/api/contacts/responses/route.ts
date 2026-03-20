import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { ContactResponse, Bot } from '../../../../lib/models';
import { getTokenFromRequest, verifyToken } from '../../../../lib/auth';

export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();

    const { searchParams } = new URL(request.url);
    const botId = searchParams.get('botId');
    const userId = searchParams.get('userId');

    // Build query
    const query: any = {};

    // Bot-owners only see responses for their own bots
    if (payload.role !== 'super-admin') {
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map((b) => b._id.toString());
      if (userBotIds.length === 0) {
        return NextResponse.json([]);
      }
      if (botId) {
        if (!userBotIds.includes(botId)) {
          return NextResponse.json([]);
        }
        query.botId = botId;
      } else {
        query.botId = { $in: userBotIds };
      }
    } else if (botId) {
      query.botId = botId;
    }

    if (userId) {
      query.userId = userId;
    }

    const responses = await ContactResponse.find(query)
      .sort({ timestamp: -1 })
      .limit(1000)
      .lean();

    return NextResponse.json(responses);
  } catch (error: any) {
    console.error('Error fetching contact responses:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch contact responses' },
      { status: 500 }
    );
  }
}
