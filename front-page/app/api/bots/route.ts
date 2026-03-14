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

    // Get order counts per bot (paid orders only)
    const ordersCollection = mongoose.connection.db?.collection('orders');
    const orderCounts: Record<string, number> = {};
    if (ordersCollection) {
      const counts = await ordersCollection.aggregate([
        { $match: { paymentStatus: 'paid' } },
        { $group: { _id: '$botId', count: { $sum: 1 } } }
      ]).toArray() as Array<{ _id: string | { toString?: () => string }; count: number }>;
      counts.forEach((c) => {
        const id = typeof c._id === 'string' ? c._id : (c._id as { toString?: () => string })?.toString?.() ?? '';
        orderCounts[id] = c.count;
      });
    }

    // Attach sales count and ensure rating is formatted
    const botsWithStats = bots.map((bot: Record<string, unknown>) => {
      const botId = typeof bot._id === 'string' ? bot._id : (bot._id as { toString?: () => string })?.toString?.() ?? '';
      const sales = orderCounts[botId] ?? 0;
      let rating = bot.rating;
      if (rating && typeof rating === 'string' && !rating.endsWith('%')) {
        rating = `${rating}%`;
      }
      return {
        ...bot,
        sales,
        rating: rating || null,
        rating_count: bot.rating_count || null,
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

