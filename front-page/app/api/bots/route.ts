import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectDB from '../../../lib/db';
import { Bot } from '../../../lib/models';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await connectDB();
    
    // Fetch only live bots with public_listing enabled (include rating fields)
    const bots = await Bot.find({
      status: 'live',
      public_listing: true,
    }).select('name description status profile_picture_url categories featured telegram_username payment_methods cut_off_time rating rating_count').lean();

    // Get order counts per bot (any order that was paid, shipped, or completed)
    const ordersCollection = mongoose.connection.db?.collection('orders');
    const orderCounts: Record<string, number> = {};
    if (ordersCollection) {
      const counts = await ordersCollection.aggregate([
        { $match: { paymentStatus: { $in: ['paid', 'shipped', 'completed'] } } },
        { $group: { _id: '$botId', count: { $sum: 1 } } }
      ]).toArray() as Array<{ _id: string | { toString?: () => string }; count: number }>;
      counts.forEach((c) => {
        const id = typeof c._id === 'string' ? c._id : (c._id as { toString?: () => string })?.toString?.() ?? '';
        orderCounts[id] = c.count;
      });
    }

    // Compute rating from reviews for each bot (dynamic)
    const reviewsCollection = mongoose.connection.db?.collection('reviews');
    const ratingByBot: Record<string, { avg: number; count: number }> = {};
    if (reviewsCollection) {
      const reviewDocs = await reviewsCollection.find({}).toArray();
      reviewDocs.forEach((r: Record<string, unknown>) => {
        const bid = String(r.bot_id ?? '');
        if (!bid) return;
        if (!ratingByBot[bid]) ratingByBot[bid] = { avg: 0, count: 0 };
        ratingByBot[bid].avg += Number(r.rating) || 0;
        ratingByBot[bid].count += 1;
      });
      Object.keys(ratingByBot).forEach((bid) => {
        const n = ratingByBot[bid].count;
        if (n > 0) ratingByBot[bid].avg = ratingByBot[bid].avg / n;
      });
    }

    // Attach sales count and ensure rating is formatted (dynamic from reviews when available)
    const botsWithStats = bots.map((bot: Record<string, unknown>) => {
      const botId = typeof bot._id === 'string' ? bot._id : (bot._id as { toString?: () => string })?.toString?.() ?? '';
      const sales = orderCounts[botId] ?? 0;
      const computed = ratingByBot[botId];
      let rating: string | null = null;
      let rating_count: string | null = null;
      if (computed && computed.count > 0) {
        rating = (computed.avg / 5 * 100).toFixed(2);
        if (rating && !rating.endsWith('%')) rating = `${rating}%`;
        rating_count = String(computed.count);
      } else {
        rating = (bot.rating as string) || null;
        if (rating && typeof rating === 'string' && !rating.endsWith('%')) rating = `${rating}%`;
        rating_count = (bot.rating_count as string) || null;
      }
      return {
        ...bot,
        sales,
        rating,
        rating_count,
      };
    });

    console.log('Front-page API - Bots found:', botsWithStats.length);

    // Sort: featured bots first, then by name
    const sortedBots = botsWithStats.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;
      return String(a.name).localeCompare(String(b.name));
    });

    return NextResponse.json(sortedBots, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (error) {
    console.error('Error fetching bots:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

