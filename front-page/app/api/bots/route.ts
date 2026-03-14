import { NextResponse } from 'next/server';
import connectDB from '../../../lib/db';
import { Bot } from '../../../lib/models';

export async function GET() {
  try {
    await connectDB();
    
    // Fetch only live bots with public_listing enabled
    const bots = await Bot.find({
      status: 'live',
      public_listing: true,
    }).select('name description status profile_picture_url categories featured telegram_username payment_methods cut_off_time');

    console.log('Front-page API - Bots found:', bots.length);
    bots.forEach(bot => {
      console.log(`Bot ${bot.name}: categories=${JSON.stringify(bot.categories)}, featured=${bot.featured}`);
    });

    // Sort: featured bots first, then by name
    const sortedBots = bots.sort((a, b) => {
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json(sortedBots);
  } catch (error) {
    console.error('Error fetching bots:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

