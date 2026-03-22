import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectDB from '../../../../../../../lib/db';
import { Bot, Product } from '../../../../../../../lib/models';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; productId: string }> }
) {
  try {
    await connectDB();
    const { slug, productId } = await params;

    const bot = await Bot.findOne({ web_shop_slug: slug, web_shop_enabled: true }).lean();
    if (!bot) {
      return NextResponse.json({ error: 'Shop not found or disabled' }, { status: 404 });
    }

    const botId = String(bot._id);

    const product = await Product.findOne({ _id: productId, bot_ids: botId }).lean();
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get('cursor');
    const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10), 50);

    const db = mongoose.connection.db!;
    const filter: Record<string, unknown> = { bot_id: botId };
    if (cursor) {
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const reviews = await db
      .collection('reviews')
      .find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .toArray();

    const hasMore = reviews.length > limit;
    const page = hasMore ? reviews.slice(0, limit) : reviews;

    // Strip user identifiers
    const sanitized = page.map((r) => ({
      _id: r._id,
      rating: r.rating,
      text: r.text || r.review_text || '',
      created_at: r.created_at || r._id.getTimestamp(),
    }));

    // Calculate average rating
    const stats = await db.collection('reviews').aggregate([
      { $match: { bot_id: botId } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]).toArray();

    const avgRating = stats.length > 0 ? Math.round(stats[0].avg * 10) / 10 : 0;
    const totalReviews = stats.length > 0 ? stats[0].count : 0;

    return NextResponse.json({
      reviews: sanitized,
      average_rating: avgRating,
      total_reviews: totalReviews,
      next_cursor: hasMore ? String(page[page.length - 1]._id) : null,
    });
  } catch (error) {
    console.error('Error fetching reviews:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
