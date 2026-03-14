import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../lib/db';
import { Bot, Product } from '../../../lib/models';
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
    
    // Super-admins see all bots, bot-owners only see their own
    const query = payload.role === 'super-admin' 
      ? {} 
      : { owner: payload.userId };
    
    const bots = await Bot.find(query).lean();
    
    // Get product counts for each bot (products are linked via bot_ids array)
    const botIds = bots.map(bot => bot._id.toString());
    const products = await Product.find({
      bot_ids: { $in: botIds }
    }).lean();
    
    // Count products per bot
    const productCounts: Record<string, number> = {};
    products.forEach(product => {
      if (product.bot_ids && Array.isArray(product.bot_ids)) {
        product.bot_ids.forEach(botId => {
          const botIdStr = botId.toString();
          productCounts[botIdStr] = (productCounts[botIdStr] || 0) + 1;
        });
      }
    });
    
    // Add product counts to bot objects
    const botsWithProductCounts = bots.map(bot => ({
      ...bot,
      products: Array(productCounts[bot._id.toString()] || 0).fill('') // Keep products array for backward compatibility, but with correct count
    }));
    
    return NextResponse.json(botsWithProductCounts);
  } catch (error) {
    console.error('Error fetching bots:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
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
    const data = await request.json();

    // Set owner: super-admins can set any owner, bot-owners are assigned as owner
    const owner = payload.role === 'super-admin' && data.owner 
      ? data.owner 
      : payload.userId;

    // Check if bot-owner already has a bot (super-admins can create unlimited bots)
    if (payload.role !== 'super-admin') {
      const existingBots = await Bot.find({ owner: payload.userId });
      if (existingBots.length > 0) {
        return NextResponse.json(
          { error: 'You can only have one bot. Please delete your existing bot before creating a new one.' },
          { status: 400 }
        );
      }
    }

    const bot = new Bot({
      token: data.token,
      name: data.name,
      telegram_username: data.telegram_username || '',
      description: data.description || '',
      main_buttons: data.main_buttons || [],
      inline_buttons: data.inline_buttons || {},
      messages: data.messages || {},
      products: data.products || [],
      status: data.status || 'live',
      owner: owner,
      public_listing: data.public_listing !== undefined ? data.public_listing : true,
      profile_picture_url: data.profile_picture_url || '',
    });

    await bot.save();
    return NextResponse.json(bot, { status: 201 });
  } catch (error: any) {
    console.error('Error creating bot:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

