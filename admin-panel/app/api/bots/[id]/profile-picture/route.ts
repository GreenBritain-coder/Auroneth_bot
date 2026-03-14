import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { Bot } from '../../../../lib/models';
import { getTokenFromRequest, verifyToken } from '../../../../lib/auth';

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

    await connectDB();

    // Check ownership
    const bot = await Bot.findById(params.id);
    if (!bot) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }

    if (payload.role !== 'super-admin' && bot.owner !== payload.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { profile_picture_url, token: botToken } = await request.json();

    if (!profile_picture_url || !botToken) {
      return NextResponse.json(
        { error: 'Profile picture URL and bot token are required' },
        { status: 400 }
      );
    }

    // Update profile picture URL in database
    await Bot.findByIdAndUpdate(params.id, {
      $set: { profile_picture_url },
    });

    // Try to set profile picture on Telegram using Bot API
    try {
      // Download the image from URL
      const imageResponse = await fetch(profile_picture_url);
      if (!imageResponse.ok) {
        throw new Error('Failed to download image');
      }

      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

      // Set profile picture using Telegram Bot API
      // Note: setChatPhoto requires the bot to be in a chat with itself
      // We'll use the bot's own chat ID (which is the bot's user ID)
      const botInfoResponse = await fetch(
        `https://api.telegram.org/bot${botToken}/getMe`
      );
      const botInfo = await botInfoResponse.json();

      if (!botInfo.ok) {
        throw new Error('Invalid bot token');
      }

      // For bots, we need to set the profile picture via setChatPhoto
      // But this requires the bot to be in a chat. A workaround is to use
      // the bot's own user ID as the chat ID (works for private chats)
      const botUserId = botInfo.result.id;
      
      // Convert image to a format Telegram can use
      // Telegram Bot API requires multipart/form-data with file upload
      // We'll use form-data package for Node.js
      
      // Note: setChatPhoto requires the bot to have admin permissions in a chat
      // For most cases, bots can't set their own profile picture directly
      // The profile picture is typically set via @BotFather or when the bot is added to a group/channel
      
      // For now, we'll attempt to use the setChatPhoto method
      // This may fail for most bots, but we'll provide a helpful error message
      
      const FormData = require('form-data');
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      
      // Create a temporary file
      const tempPath = path.join(os.tmpdir(), `profile_${Date.now()}.jpg`);
      fs.writeFileSync(tempPath, imageBuffer);
      
      const telegramFormData = new FormData();
      telegramFormData.append('chat_id', botUserId.toString());
      telegramFormData.append('photo', fs.createReadStream(tempPath));
      
      // Try to set via API (may fail if bot doesn't have permission)
      const setPhotoResponse = await fetch(
        `https://api.telegram.org/bot${botToken}/setChatPhoto`,
        {
          method: 'POST',
          body: telegramFormData as any,
          headers: telegramFormData.getHeaders(),
        }
      );
      
      // Clean up temp file
      try {
        fs.unlinkSync(tempPath);
      } catch (e) {
        // Ignore cleanup errors
      }

      const result = await setPhotoResponse.json();

      if (result.ok) {
        return NextResponse.json({
          message: 'Profile picture updated successfully on Telegram!',
        });
      } else {
        // Profile picture URL saved, but Telegram update failed
        // This is expected - bots can't set their own profile picture via API
        return NextResponse.json({
          message:
            'Profile picture URL saved to database. However, bots cannot set their own profile picture via the Telegram Bot API.',
          warning: result.description || 'Telegram API limitation',
          instructions: [
            '1. Open Telegram and message @BotFather',
            '2. Send /mybots',
            '3. Select your bot',
            '4. Choose "Bot Settings" → "Edit Botpic"',
            '5. Upload your image from the URL: ' + profile_picture_url,
          ],
        });
      }
    } catch (telegramError: any) {
      // Profile picture URL saved, but Telegram update failed
      console.error('Telegram API error:', telegramError);
      return NextResponse.json({
        message:
          'Profile picture URL saved to database. However, bots cannot set their own profile picture via the Telegram Bot API.',
        warning: telegramError.message || 'Telegram API limitation',
        instructions: [
          '1. Open Telegram and message @BotFather',
          '2. Send /mybots',
          '3. Select your bot',
          '4. Choose "Bot Settings" → "Edit Botpic"',
          '5. Upload your image from the URL: ' + profile_picture_url,
        ],
      });
    }
  } catch (error: any) {
    console.error('Error updating profile picture:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

