import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../lib/db';
import { ContactMessage, ContactResponse, Bot } from '../../../lib/models';
import { getTokenFromRequest, verifyToken } from '../../../lib/auth';

/**
 * Helper: build the base botId filter for the current user.
 * Returns null if the user has no bots (bot-owner with 0 bots).
 */
async function buildBotFilter(payload: { role: string; userId: string }, botId: string | null) {
  const query: Record<string, unknown> = {};

  if (payload.role !== 'super-admin') {
    const userBots = await Bot.find({ owner: payload.userId });
    const userBotIds = userBots.map((b) => b._id.toString());
    if (userBotIds.length === 0) return null; // no access
    if (botId) {
      if (!userBotIds.includes(botId)) return null;
      query.botId = botId;
    } else {
      query.botId = { $in: userBotIds };
    }
  } else if (botId) {
    query.botId = botId;
  }

  return query;
}

// ─── GET ────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await connectDB();

    const { searchParams } = new URL(request.url);
    const view = searchParams.get('view'); // "conversations" | null
    const botId = searchParams.get('botId');
    const userId = searchParams.get('userId');
    const unreadOnly = searchParams.get('unreadOnly') === 'true';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));

    const baseFilter = await buildBotFilter(payload as { role: string; userId: string }, botId);
    if (baseFilter === null) {
      // No access — return appropriate empty shape
      if (view === 'conversations') {
        return NextResponse.json({ conversations: [], page, limit, totalCount: 0, hasMore: false });
      }
      if (userId && botId) {
        return NextResponse.json({ messages: [], page, limit, totalCount: 0, hasMore: false });
      }
      return NextResponse.json([]);
    }

    // ── MODE 1: Conversation list (sidebar) ──────────────────────────────
    if (view === 'conversations') {
      const matchStage: Record<string, unknown> = { ...baseFilter };
      // We always aggregate from contact_messages; unreadOnly filters later

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pipeline: any[] = [
        { $match: matchStage },
        // Group by botId + userId
        {
          $group: {
            _id: { botId: '$botId', userId: '$userId' },
            lastMessageAt: { $max: '$timestamp' },
            unreadCount: { $sum: { $cond: [{ $eq: ['$read', false] }, 1, 0] } },
            lastUserMessage: { $last: '$message' },
          },
        },
      ];

      // Now we need the last response per conversation too, so we can show
      // whichever is newest. We'll do a $lookup on contact_responses.
      pipeline.push(
        {
          $lookup: {
            from: 'contact_responses',
            let: { bId: '$_id.botId', uId: '$_id.userId' },
            pipeline: [
              { $match: { $expr: { $and: [{ $eq: ['$botId', '$$bId'] }, { $eq: ['$userId', '$$uId'] }] } } },
              { $sort: { timestamp: -1 } },
              { $limit: 1 },
            ],
            as: 'lastResp',
          },
        },
        {
          $addFields: {
            lastRespEntry: { $arrayElemAt: ['$lastResp', 0] },
          },
        },
        {
          $addFields: {
            // Determine the actual last message (user msg or response)
            lastMessage: {
              $cond: {
                if: {
                  $and: [
                    { $ne: ['$lastRespEntry', null] },
                    { $gt: ['$lastRespEntry.timestamp', '$lastMessageAt'] },
                  ],
                },
                then: { $concat: ['You: ', '$lastRespEntry.message'] },
                else: '$lastUserMessage',
              },
            },
            lastMessageAt: {
              $cond: {
                if: {
                  $and: [
                    { $ne: ['$lastRespEntry', null] },
                    { $gt: ['$lastRespEntry.timestamp', '$lastMessageAt'] },
                  ],
                },
                then: '$lastRespEntry.timestamp',
                else: '$lastMessageAt',
              },
            },
          },
        },
        // Drop temp fields
        { $project: { lastResp: 0, lastRespEntry: 0, lastUserMessage: 0 } },
      );

      // unreadOnly filter
      if (unreadOnly) {
        pipeline.push({ $match: { unreadCount: { $gt: 0 } } });
      }

      // Sort: unread first, then by lastMessageAt desc
      pipeline.push({ $sort: { unreadCount: -1, lastMessageAt: -1 } });

      // Count total before pagination
      const countPipeline = [...pipeline, { $count: 'total' }];
      const countResult = await ContactMessage.aggregate(countPipeline);
      const totalCount = countResult.length > 0 ? (countResult[0] as { total: number }).total : 0;

      // Paginate
      pipeline.push({ $skip: (page - 1) * limit }, { $limit: limit });

      const raw = await ContactMessage.aggregate(pipeline);

      const conversations = raw.map((r: Record<string, unknown>) => {
        const id = r._id as { botId: string; userId: string };
        return {
          botId: id.botId,
          userId: id.userId,
          lastMessage: (r.lastMessage as string) || '',
          lastMessageAt: r.lastMessageAt as string,
          unreadCount: (r.unreadCount as number) || 0,
        };
      });

      return NextResponse.json({
        conversations,
        page,
        limit,
        totalCount,
        hasMore: page * limit < totalCount,
      });
    }

    // ── MODE 2: Single conversation messages (paginated, merged) ─────────
    if (userId && botId) {
      const msgFilter = { ...baseFilter, userId };
      const respFilter = { botId, userId };

      // Count totals
      const [msgCount, respCount] = await Promise.all([
        ContactMessage.countDocuments(msgFilter),
        ContactResponse.countDocuments(respFilter),
      ]);
      const totalCount = msgCount + respCount;

      // Fetch ALL from both collections for this conversation then merge & paginate in-memory.
      // For a single conversation the total message count is manageable (hundreds at most).
      // We fetch all to merge chronologically, then slice the page.
      const [msgs, resps] = await Promise.all([
        ContactMessage.find(msgFilter).sort({ timestamp: 1 }).lean(),
        ContactResponse.find(respFilter).sort({ timestamp: 1 }).lean(),
      ]);

      type MergedEntry = {
        _id: string;
        type: 'user' | 'vendor';
        message: string;
        timestamp: string;
        read?: boolean;
        repliedBy?: string;
      };

      const merged: MergedEntry[] = [];
      for (const m of msgs) {
        merged.push({
          _id: (m as Record<string, unknown>)._id as string,
          type: 'user',
          message: (m as Record<string, unknown>).message as string,
          timestamp: ((m as Record<string, unknown>).timestamp as Date).toISOString(),
          read: (m as Record<string, unknown>).read as boolean,
        });
      }
      for (const r of resps) {
        merged.push({
          _id: (r as Record<string, unknown>)._id as string,
          type: 'vendor',
          message: (r as Record<string, unknown>).message as string,
          timestamp: ((r as Record<string, unknown>).timestamp as Date).toISOString(),
          repliedBy: (r as Record<string, unknown>).repliedBy as string,
        });
      }

      // Sort ascending (oldest first)
      merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      // Paginate from the END (most recent messages first page, load-older goes to earlier pages).
      // page=1 means the latest slice.
      const totalPages = Math.ceil(merged.length / limit) || 1;
      const startIdx = Math.max(0, merged.length - page * limit);
      const endIdx = merged.length - (page - 1) * limit;
      const pageMessages = merged.slice(startIdx, endIdx);

      return NextResponse.json({
        messages: pageMessages,
        page,
        limit,
        totalCount: merged.length,
        hasMore: page < totalPages,
      });
    }

    // ── MODE 3: Legacy — return flat array of messages (backward compat) ──
    const query: Record<string, unknown> = { ...baseFilter };
    if (unreadOnly) query.read = false;

    const messages = await ContactMessage.find(query)
      .sort({ timestamp: -1 })
      .limit(1000)
      .lean();

    return NextResponse.json(messages);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch contact messages';
    console.error('Error fetching contact messages:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── PATCH (mark as read) ───────────────────────────────────────────────────
export async function PATCH(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await connectDB();

    const body = await request.json();
    const { messageId, botId, userId, read } = body;

    // Bulk mark-read for a conversation
    if (botId && userId) {
      if (payload.role !== 'super-admin') {
        const bot = await Bot.findById(botId);
        if (!bot || bot.owner !== payload.userId) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
      }
      const result = await ContactMessage.updateMany(
        { botId, userId, read: false },
        { $set: { read: true } },
      );
      return NextResponse.json({ success: true, modifiedCount: result.modifiedCount });
    }

    // Single message mark-read (legacy)
    if (!messageId) {
      return NextResponse.json({ error: 'Message ID required' }, { status: 400 });
    }

    if (payload.role !== 'super-admin') {
      const existing = await ContactMessage.findById(messageId).lean() as { botId: string } | null;
      if (!existing) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
      const bot = await Bot.findById(existing.botId);
      if (!bot || bot.owner !== payload.userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const message = await ContactMessage.findByIdAndUpdate(
      messageId,
      { read: read !== undefined ? read : true },
      { new: true },
    );

    if (!message) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    return NextResponse.json(message);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update contact message';
    console.error('Error updating contact message:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST handler moved to /api/contacts/reply/route.ts for cleaner separation
