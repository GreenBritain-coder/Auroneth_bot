import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../../../../lib/db';
import { Bot, Order } from '../../../../../../../lib/models';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; token: string }> }
) {
  const { slug, token } = await params;

  await connectDB();

  const bot = await Bot.findOne({
    web_shop_slug: slug,
    web_shop_enabled: true,
  }).lean();

  if (!bot) {
    return NextResponse.json({ error: 'Shop not found or disabled' }, { status: 404 });
  }

  const order = await Order.findOne({
    order_token: token,
    botId: String(bot._id),
  })
    .select('status paymentStatus paymentDetails updated_at')
    .lean() as Record<string, unknown> | null;

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  const paymentDetails = (order.paymentDetails || {}) as Record<string, unknown>;

  return NextResponse.json({
    status: order.status,
    payment_received: order.status !== 'pending' && order.status !== 'pending_payment_setup',
    confirmations: (paymentDetails.confirmations as number) ?? 0,
    updated_at: order.updated_at,
  });
}
