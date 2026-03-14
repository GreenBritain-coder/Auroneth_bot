import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { CommissionPayment, Bot } from '@/lib/models';
import { getTokenFromRequest, verifyToken } from '@/lib/auth';

// POST: Mark commission as paid (super-admin only)
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

    // Only super-admins can mark commissions as paid
    if (payload.role !== 'super-admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await connectDB();

    const data = await request.json();
    const { botId, amount, currency = 'BTC', notes, orderIds } = data;

    if (!botId) {
      return NextResponse.json({ error: 'Bot ID is required' }, { status: 400 });
    }

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 400 });
    }

    // Verify bot exists
    const bot = await Bot.findById(botId);
    if (!bot) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }

    // Create commission payment record
    const commissionPayment = new CommissionPayment({
      botId,
      amount: parseFloat(amount),
      currency: currency.toUpperCase(),
      paidBy: payload.userId,
      notes: notes || undefined,
      orderIds: orderIds || [],
      paidAt: new Date(),
    });

    await commissionPayment.save();

    return NextResponse.json({
      success: true,
      payment: commissionPayment,
      message: 'Commission marked as paid successfully',
    }, { status: 201 });
  } catch (error: any) {
    console.error('Error marking commission as paid:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET: Get commission payment history (super-admin only)
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

    // Only super-admins can view payment history
    if (payload.role !== 'super-admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await connectDB();

    const payments = await CommissionPayment.find({})
      .sort({ paidAt: -1 })
      .lean();

    // Get bot names
    const botIds = [...new Set(payments.map(p => p.botId))];
    const bots = await Bot.find({ _id: { $in: botIds } }).lean();
    const botMap: Record<string, string> = {};
    bots.forEach(bot => {
      botMap[bot._id.toString()] = bot.name || 'Unknown Bot';
    });

    const paymentsWithBotNames = payments.map(payment => ({
      ...payment,
      botName: botMap[payment.botId] || 'Unknown Bot',
    }));

    return NextResponse.json(paymentsWithBotNames);
  } catch (error: any) {
    console.error('Error fetching commission payments:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
