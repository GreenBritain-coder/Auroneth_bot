import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { Discount } from '@/lib/models';
import { getTokenFromRequest, verifyToken } from '@/lib/auth';

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
    
    // Super-admins see all discounts, bot-owners only see discounts for their bots
    let discounts;
    if (payload.role === 'super-admin') {
      discounts = await Discount.find({}).sort({ created_at: -1 });
    } else {
      // Get user's bots
      const { Bot } = await import('@/lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());
      
      // Get discounts that belong to user's bots or have no bot_ids (global)
      discounts = await Discount.find({
        $or: [
          { bot_ids: { $in: userBotIds } },
          { bot_ids: { $size: 0 } } // Global discounts
        ]
      }).sort({ created_at: -1 });
    }
    
    return NextResponse.json(discounts);
  } catch (error) {
    console.error('Error fetching discounts:', error);
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

    // Bot-owners can only assign discounts to their own bots
    let bot_ids = data.bot_ids || [];
    if (payload.role !== 'super-admin' && bot_ids.length > 0) {
      const { Bot } = await import('@/lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());
      
      // Filter to only include user's bots
      bot_ids = bot_ids.filter((id: string) => userBotIds.includes(id));
    }

    // Validate discount code is unique
    const existingDiscount = await Discount.findOne({ code: data.code.toUpperCase() });
    if (existingDiscount) {
      return NextResponse.json(
        { error: 'Discount code already exists' },
        { status: 400 }
      );
    }

    const discount = new Discount({
      code: data.code.toUpperCase(),
      description: data.description || '',
      discount_type: data.discount_type,
      discount_value: data.discount_value,
      bot_ids: bot_ids,
      min_order_amount: data.min_order_amount || 0,
      max_discount_amount: data.max_discount_amount,
      usage_limit: data.usage_limit,
      used_count: 0,
      valid_from: data.valid_from ? new Date(data.valid_from) : new Date(),
      valid_until: new Date(data.valid_until),
      active: data.active !== undefined ? data.active : true,
      created_by: payload.userId,
    });

    await discount.save();
    return NextResponse.json(discount, { status: 201 });
  } catch (error: any) {
    console.error('Error creating discount:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

