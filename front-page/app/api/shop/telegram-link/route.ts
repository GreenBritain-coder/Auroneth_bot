import { NextRequest, NextResponse } from 'next/server';
import { createHmac, createHash } from 'crypto';
import connectDB from '../../../../lib/db';
import { Bot, Cart, Order } from '../../../../lib/models';

export const dynamic = 'force-dynamic';

interface TelegramAuthPayload {
  id: number;
  first_name: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
  botId: string;
}

function verifyTelegramAuth(
  data: Omit<TelegramAuthPayload, 'botId'>,
  botToken: string
): boolean {
  const { hash, ...rest } = data;

  // Build data_check_string: alphabetically sorted key=value pairs joined by \n
  const dataCheckString = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key as keyof typeof rest]}`)
    .filter((entry) => !entry.endsWith('=undefined'))
    .join('\n');

  // secret_key = SHA256(bot_token)
  const secretKey = createHash('sha256').update(botToken).digest();

  // hash = HMAC-SHA256(data_check_string, secret_key)
  const computedHash = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  return computedHash === hash;
}

export async function POST(request: NextRequest) {
  try {
    const body: TelegramAuthPayload = await request.json();
    const { id, first_name, username, photo_url, auth_date, hash, botId } =
      body;

    if (!id || !auth_date || !hash || !botId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Reject auth data older than 1 day
    const now = Math.floor(Date.now() / 1000);
    if (now - auth_date > 86400) {
      return NextResponse.json(
        { error: 'Auth data is too old' },
        { status: 401 }
      );
    }

    await connectDB();

    // Fetch bot to get its token
    const bot = (await Bot.findById(botId).lean()) as Record<
      string,
      unknown
    > | null;
    if (!bot || !bot.token) {
      return NextResponse.json(
        { error: 'Bot not found or missing token' },
        { status: 404 }
      );
    }

    const botToken = bot.token as string;

    // Verify the Telegram auth hash
    const authData = { id, first_name, username, photo_url, auth_date, hash };
    if (!verifyTelegramAuth(authData, botToken)) {
      return NextResponse.json(
        { error: 'Invalid auth hash' },
        { status: 401 }
      );
    }

    // Get session ID from cookie
    const sessionId = request.cookies.get('shop_session_id')?.value;
    if (!sessionId) {
      return NextResponse.json({ error: 'No session' }, { status: 401 });
    }

    const botIdStr = String(bot._id);
    const telegramUserId = String(id);

    // Update the Cart document: set user_id to Telegram user ID
    await Cart.updateMany(
      { bot_id: botIdStr, session_id: sessionId },
      { $set: { user_id: telegramUserId } }
    );

    // Update all Orders with this web_session_id: set userId to Telegram user ID
    await Order.updateMany(
      { web_session_id: sessionId, botId: botIdStr },
      { $set: { userId: telegramUserId } }
    );

    // Build response with cookies for linked state
    const displayName = username ? `@${username}` : first_name;
    const response = NextResponse.json({
      success: true,
      telegram_user_id: telegramUserId,
      display_name: displayName,
    });

    // Set cookies to persist the linked state
    const cookieOptions = {
      httpOnly: false, // Needs to be readable client-side for UI
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict' as const,
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    };

    response.cookies.set(
      'telegram_user_id',
      telegramUserId,
      cookieOptions
    );
    response.cookies.set(
      'telegram_username',
      username || first_name,
      cookieOptions
    );

    return response;
  } catch (error) {
    console.error('[Telegram Link] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
