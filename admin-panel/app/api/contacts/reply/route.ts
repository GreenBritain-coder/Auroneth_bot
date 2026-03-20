import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { ContactMessage, ContactResponse, Bot } from '../../../../lib/models';
import { getTokenFromRequest, verifyToken } from '../../../../lib/auth';
import mongoose from 'mongoose';

export async function POST(request: NextRequest) {
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
    const { userId, botId, message } = body;

    if (!userId || !botId || !message) {
      return NextResponse.json(
        { error: 'userId, botId, and message are required' },
        { status: 400 }
      );
    }

    // Get bot token from database
    const bot = await Bot.findById(botId);
    if (!bot) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }

    // Bot-owners can only reply to messages for their own bots
    if (payload.role !== 'super-admin' && bot.owner !== payload.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Send message via Telegram Bot API (direct HTTP call, no library needed)
    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${bot.token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: userId,
          text: `\u{1F4E8} *Reply from Vendor:*\n\n${message}`,
          parse_mode: 'Markdown',
        }),
      }
    );

    if (!telegramResponse.ok) {
      const telegramError = await telegramResponse.json();
      console.error('Telegram API error:', telegramError);
      return NextResponse.json(
        { error: `Failed to send Telegram message: ${telegramError.description || 'Unknown error'}` },
        { status: 500 }
      );
    }

    // Store reply in contact_responses collection
    const responseId = new mongoose.Types.ObjectId().toString();
    const contactResponse = await ContactResponse.create({
      _id: responseId,
      botId,
      userId,
      message,
      timestamp: new Date(),
      repliedBy: payload.username || 'admin',
    });

    // Mark all unread contact messages from this user for this bot as read
    await ContactMessage.updateMany(
      { botId, userId, read: false },
      { $set: { read: true } }
    );

    return NextResponse.json({
      success: true,
      message: 'Reply sent successfully',
      response: contactResponse,
    });
  } catch (error: any) {
    console.error('Error sending reply:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to send reply' },
      { status: 500 }
    );
  }
}
