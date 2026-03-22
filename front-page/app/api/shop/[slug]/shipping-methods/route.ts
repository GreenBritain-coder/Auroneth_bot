import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../../lib/db';
import { Bot } from '../../../../../lib/models';

export const dynamic = 'force-dynamic';

const DEFAULT_SHIPPING_METHODS = [
  { code: 'STD', name: 'Standard Delivery', cost: 0 },
  { code: 'EXP', name: 'Express Delivery', cost: 5 },
  { code: 'NXT', name: 'Next Day Delivery', cost: 10 },
];

async function getBotBySlug(slug: string) {
  await connectDB();
  return Bot.findOne({ web_shop_slug: slug, web_shop_enabled: true }).lean();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const bot = await getBotBySlug(slug);
    if (!bot) {
      return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
    }

    const methods = (bot as any).shipping_methods || DEFAULT_SHIPPING_METHODS;

    return NextResponse.json({
      methods,
      currency: 'GBP',
    });
  } catch (error) {
    console.error('Shipping methods error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
