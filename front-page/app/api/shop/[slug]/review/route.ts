import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectDB from '../../../../../lib/db';
import { Bot, Order } from '../../../../../lib/models';

export const dynamic = 'force-dynamic';

function getSessionId(request: NextRequest): string | null {
  return request.cookies.get('shop_session_id')?.value || null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    await connectDB();

    const bot = await Bot.findOne({ web_shop_slug: slug, web_shop_enabled: true }).lean();
    if (!bot) {
      return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
    }

    const botId = String(bot._id);
    const sessionId = getSessionId(request);
    if (!sessionId) {
      return NextResponse.json({ error: 'No session' }, { status: 401 });
    }

    const body = await request.json();
    const { order_token, rating, comment } = body;

    if (!order_token || typeof order_token !== 'string') {
      return NextResponse.json({ error: 'order_token required' }, { status: 400 });
    }
    if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'rating must be 1-5' }, { status: 400 });
    }

    const db = mongoose.connection.db!;

    // Find the order
    const order = await db.collection('orders').findOne({ order_token, botId });
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Verify the session owns this order
    if (order.web_session_id !== sessionId) {
      return NextResponse.json({ error: 'Not your order' }, { status: 403 });
    }

    // Only allow reviews for paid+ orders
    const allowedStatuses = ['paid', 'confirmed', 'shipped', 'delivered', 'completed'];
    const orderStatus = (order.paymentStatus || order.status || '').toLowerCase();
    if (!allowedStatuses.includes(orderStatus)) {
      return NextResponse.json({ error: 'Can only review paid orders' }, { status: 400 });
    }

    // Check for existing review
    const existingReview = await db.collection('reviews').findOne({ order_id: String(order._id) });
    if (existingReview) {
      return NextResponse.json({ error: 'Already reviewed' }, { status: 409 });
    }

    // Build product_ids from items
    const productIds: string[] = [];
    const items = order.items_snapshot || order.items || [];
    for (const item of items) {
      if (item.product_id) productIds.push(String(item.product_id));
    }

    // Save review
    const reviewDoc = {
      order_id: String(order._id),
      user_id: order.userId || `web_${sessionId}`,
      bot_id: botId,
      rating,
      comment: (comment || '').trim().substring(0, 500),
      product_ids: productIds,
      source: 'web',
      created_at: new Date(),
    };

    await db.collection('reviews').insertOne(reviewDoc);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Review submission error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
