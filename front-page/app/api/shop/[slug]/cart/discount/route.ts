import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectDB from '../../../../../../lib/db';
import { Bot, Cart } from '../../../../../../lib/models';
import { getValidatedCart } from '../../../../../../lib/shop-utils';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    await connectDB();
    const { slug } = await params;

    const bot = await Bot.findOne({ web_shop_slug: slug, web_shop_enabled: true }).lean();
    if (!bot) {
      return NextResponse.json({ error: 'Shop not found or disabled' }, { status: 404 });
    }

    const botId = String(bot._id);
    const sessionId = request.cookies.get('shop_session_id')?.value;
    if (!sessionId) {
      return NextResponse.json({ error: 'No session' }, { status: 401 });
    }

    const body = await request.json();
    const { code } = body;

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Discount code required' }, { status: 400 });
    }

    const cart = await Cart.findOne({ bot_id: botId, session_id: sessionId });
    if (!cart || cart.items.length === 0) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    }

    const db = mongoose.connection.db!;
    const now = new Date();
    const discount = await db.collection('discounts').findOne({
      code: code.toUpperCase(),
      bot_id: botId,
      active: true,
      $and: [
        { $or: [{ valid_from: { $exists: false } }, { valid_from: { $lte: now } }] },
        { $or: [{ valid_until: { $exists: false } }, { valid_until: { $gte: now } }] },
      ],
    });

    if (!discount) {
      return NextResponse.json({ error: 'Invalid or expired discount code' }, { status: 400 });
    }

    // Calculate discount amount
    const subtotal = cart.items.reduce((sum: number, item: { price_snapshot: number; quantity: number }) => sum + item.price_snapshot * item.quantity, 0);
    let discountAmount = 0;

    if (discount.type === 'percentage') {
      discountAmount = Math.round(subtotal * (discount.value / 100) * 100) / 100;
    } else {
      discountAmount = Math.min(discount.value, subtotal);
    }

    cart.discount_code = code.toUpperCase();
    cart.discount_amount = discountAmount;
    await cart.save();

    const validated = await getValidatedCart(botId, sessionId);
    const { cart: _cart, ...cartResponse } = validated;
    return NextResponse.json({ cart: cartResponse });
  } catch (error) {
    console.error('Error applying discount:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
