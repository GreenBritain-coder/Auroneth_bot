import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../../lib/db';
import { Bot } from '../../../../../lib/models';

export const dynamic = 'force-dynamic';

// Bridge URL now read from bot document per-request
const BRIDGE_KEY = process.env.BRIDGE_API_KEY || '';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    await connectDB();

    const bot = await Bot.findOne({ web_shop_slug: slug, web_shop_enabled: true }).lean();
    if (!bot) {
      return NextResponse.json({ error: 'Shop not found or disabled' }, { status: 404 });
    }

    const botId = String(bot._id);
    const bridgeUrl = (bot as any).webhook_url || process.env.BRIDGE_API_URL || "http://localhost:8000";

    // Call Python bridge to get payment methods from SHKeeper
    const res = await fetch(`${bridgeUrl}/api/web/${botId}/payment-methods`, {
      headers: { 'X-Bridge-Key': BRIDGE_KEY },
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Bridge unavailable' }));
      console.error('[PaymentMethods] Bridge error:', err);
      return NextResponse.json(
        { error: 'Unable to fetch payment methods' },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching payment methods:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
