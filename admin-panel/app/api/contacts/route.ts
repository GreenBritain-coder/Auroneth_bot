import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../lib/db';
import { ContactMessage, Bot } from '../../../lib/models';
import { getTokenFromRequest, verifyToken } from '../../../lib/auth';

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

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const botId = searchParams.get('botId');
    const unreadOnly = searchParams.get('unreadOnly') === 'true';

    // Build query
    const query: any = {};

    // Bot-owners only see messages for their own bots
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

    if (unreadOnly) {
      query.read = false;
    }

    // Fetch contact messages
    const messages = await ContactMessage.find(query)
      .sort({ timestamp: -1 })
      .limit(1000)
      .lean();

    return NextResponse.json(messages);
  } catch (error: any) {
    console.error('Error fetching contact messages:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch contact messages' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
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

    const body = await request.json();
    const { messageId, read } = body;

    if (!messageId) {
      return NextResponse.json({ error: 'Message ID required' }, { status: 400 });
    }

    // Bot-owners can only update messages for their own bots
    if (payload.role !== 'super-admin') {
      const existing = await ContactMessage.findById(messageId).lean() as { botId: string } | null;
      if (!existing) {
        return NextResponse.json({ error: 'Message not found' }, { status: 404 });
      }
      const bot = await Bot.findById(existing.botId);
      if (!bot || bot.owner !== payload.userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Update message
    const message = await ContactMessage.findByIdAndUpdate(
      messageId,
      { read: read !== undefined ? read : true },
      { new: true }
    );

    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    return NextResponse.json(message);
  } catch (error: any) {
    console.error('Error updating contact message:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update contact message' },
      { status: 500 }
    );
  }
}

// POST handler moved to /api/contacts/reply/route.ts for cleaner separation