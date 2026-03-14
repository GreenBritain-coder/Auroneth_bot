import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../lib/db';
import { Product } from '../../../lib/models';
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
    
    // Super-admins see all products, bot-owners only see products for their bots
    let products;
    if (payload.role === 'super-admin') {
      products = await Product.find({});
    } else {
      // Get user's bots
      const { Bot } = await import('../../../lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());
      
      // Get products that belong to user's bots
      products = await Product.find({
        bot_ids: { $in: userBotIds }
      });
    }
    
    return NextResponse.json(products);
  } catch (error) {
    console.error('Error fetching products:', error);
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

    // Bot-owners can only assign products to their own bots
    let bot_ids = data.bot_ids || [];
    if (payload.role !== 'super-admin' && bot_ids.length > 0) {
      const { Bot } = await import('../../../lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());
      
      // Filter to only include user's bots
      bot_ids = bot_ids.filter((id: string) => userBotIds.includes(id));
    }

    const product = new Product({
      name: data.name,
      base_price: data.base_price || data.price || 0,
      price: data.price || data.base_price || 0, // Keep for backward compatibility
      currency: data.currency,
      description: data.description,
      image_url: data.image_url || '',
      subcategory_id: data.subcategory_id || '',
      category_id: data.category_id || '',
      bot_ids: bot_ids,
      unit: data.unit || 'pcs',
      increment_amount: data.increment_amount,
      variations: data.variations || [],
    });

    await product.save();
    return NextResponse.json(product, { status: 201 });
  } catch (error: any) {
    console.error('Error creating product:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

