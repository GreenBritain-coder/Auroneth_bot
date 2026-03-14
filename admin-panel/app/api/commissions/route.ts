import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { Order, Bot, CommissionPayout } from '@/lib/models';
import { getTokenFromRequest, verifyToken } from '@/lib/auth';
import { processOnePayout } from '@/lib/processPayout';

// GET: Get earnings summary for the logged-in user (bot owners earn order amount - commission)
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

    await connectDB();

    if (payload.role === 'super-admin') {
      // Super-admin: Show total platform commission collected from all bot owners
      const allOrders = await Order.find({
        paymentStatus: 'paid'
      }).lean();

      // Calculate total platform commission collected
      const totalCommission = allOrders.reduce((sum, order) => {
        return sum + (order.commission || 0);
      }, 0);

      // Get all bots to map botId to bot name
      const allBots = await Bot.find({}).lean();
      const botMap: Record<string, { name: string; owner?: string }> = {};
      allBots.forEach(bot => {
        botMap[bot._id.toString()] = {
          name: bot.name || 'Unknown Bot',
          owner: bot.owner || undefined
        };
      });

      // Group commissions by bot
      const commissionsByBot: Record<string, {
        botId: string;
        botName: string;
        owner?: string;
        totalCommission: number;
        orderCount: number;
        totalOrderAmount: number;
        commissionsByCurrency: Record<string, { commission: number; orderCount: number; totalAmount: number }>;
      }> = {};

      allOrders.forEach(order => {
        const botId = order.botId?.toString() || 'unknown';
        const botInfo = botMap[botId] || { name: 'Unknown Bot' };
        const commission = order.commission || 0;
        const orderAmount = order.amount || 0;
        const currency = (order.currency || 'BTC').toUpperCase();

        if (!commissionsByBot[botId]) {
          commissionsByBot[botId] = {
            botId,
            botName: botInfo.name,
            owner: botInfo.owner,
            totalCommission: 0,
            orderCount: 0,
            totalOrderAmount: 0,
            commissionsByCurrency: {}
          };
        }

        commissionsByBot[botId].totalCommission += commission;
        commissionsByBot[botId].orderCount += 1;
        commissionsByBot[botId].totalOrderAmount += orderAmount;

        // Per-currency breakdown
        if (!commissionsByBot[botId].commissionsByCurrency[currency]) {
          commissionsByBot[botId].commissionsByCurrency[currency] = {
            commission: 0,
            orderCount: 0,
            totalAmount: 0
          };
        }
        commissionsByBot[botId].commissionsByCurrency[currency].commission += commission;
        commissionsByBot[botId].commissionsByCurrency[currency].orderCount += 1;
        commissionsByBot[botId].commissionsByCurrency[currency].totalAmount += orderAmount;
      });

      // Get all pending payout requests (bot owner payouts)
      const { CommissionPayout } = await import('@/lib/models');
      const allPendingPayouts = await CommissionPayout.find({
        status: 'pending'
      }).lean();

      const totalPendingPayout = allPendingPayouts.reduce((sum, p) => sum + (p.amount || 0), 0);
      
      // Platform commission = total commission collected (all commissions are automatically collected)
      // Since payments go to platform wallet, commissions are immediately available
      const availableCommission = totalCommission;

      // Get commission rate from environment (default 2%)
      const commissionRate = parseFloat(process.env.COMMISSION_RATE || '0.02') * 100; // Convert to percentage

      return NextResponse.json({
        totalEarned: totalCommission, // Total platform commission collected
        totalPendingPayout,
        availableForPayout: availableCommission, // All commissions are available (automatically collected)
        orderCount: allOrders.length,
        pendingPayoutCount: allPendingPayouts.length,
        isSuperAdmin: true,
        commissionRate, // Commission rate percentage (e.g., 2 for 2%)
        commissionsByBot: Object.values(commissionsByBot), // Per-bot breakdown
        recentOrders: allOrders.slice(0, 10).map(order => ({
          orderId: order._id,
          amount: order.amount || 0,
          commission: order.commission || 0,
          botEarnings: (order.amount || 0) - (order.commission || 0),
          timestamp: order.timestamp
        })),
      });
    } else {
      // Bot owner: Show earnings (order amount - commission already deducted)
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());

      // Get all paid orders for user's bots
      const orders = await Order.find({
        botId: { $in: userBotIds },
        paymentStatus: 'paid'
      }).lean();

      // Calculate earnings per currency: order amount - commission (automatically deducted)
      // Bot owners see their net earnings (commission already deducted)
      const earningsByCurrency: Record<string, { totalEarned: number; orderCount: number }> = {};
      
      orders.forEach(order => {
        const orderAmount = order.amount || 0;
        const commission = order.commission || 0;
        const earning = orderAmount - commission; // Commission automatically deducted
        const currency = (order.currency || 'BTC').toUpperCase();
        
        if (!earningsByCurrency[currency]) {
          earningsByCurrency[currency] = { totalEarned: 0, orderCount: 0 };
        }
        earningsByCurrency[currency].totalEarned += earning;
        earningsByCurrency[currency].orderCount += 1;
      });

      // Get pending payout requests grouped by currency
      const { CommissionPayout } = await import('@/lib/models');
      const pendingPayouts = await CommissionPayout.find({
        userId: payload.userId,
        status: 'pending'
      }).lean();

      const pendingPayoutsByCurrency: Record<string, number> = {};
      pendingPayouts.forEach(payout => {
        const currency = (payout.currency || 'BTC').toUpperCase();
        pendingPayoutsByCurrency[currency] = (pendingPayoutsByCurrency[currency] || 0) + (payout.amount || 0);
      });

      // Calculate available for payout per currency
      // Available = net earnings (after unpaid commissions) - pending payouts
      const availableByCurrency: Record<string, number> = {};
      Object.keys(earningsByCurrency).forEach(currency => {
        const earned = earningsByCurrency[currency].totalEarned;
        const pending = pendingPayoutsByCurrency[currency] || 0;
        availableByCurrency[currency] = Math.max(0, earned - pending); // Ensure non-negative
      });

      // For backward compatibility, also calculate totals (summing all currencies)
      // Note: This may not be accurate if currencies have different values
      const totalEarned = Object.values(earningsByCurrency).reduce((sum, e) => sum + e.totalEarned, 0);
      const totalPendingPayout = Object.values(pendingPayoutsByCurrency).reduce((sum, p) => sum + p, 0);
      const totalAvailableForPayout = Object.values(availableByCurrency).reduce((sum, a) => sum + a, 0);

      return NextResponse.json({
        totalEarned,
        totalPendingPayout,
        availableForPayout: totalAvailableForPayout,
        orderCount: orders.length,
        pendingPayoutCount: pendingPayouts.length,
        isSuperAdmin: false,
        earningsByCurrency, // Per-currency breakdown
        pendingPayoutsByCurrency,
        availableByCurrency,
        recentOrders: orders.slice(0, 10).map(order => ({
          orderId: order._id,
          amount: order.amount || 0,
          commission: order.commission || 0,
          currency: order.currency || 'BTC',
          earnings: (order.amount || 0) - (order.commission || 0),
          timestamp: order.timestamp
        })),
      });
    }
  } catch (error: any) {
    console.error('Error fetching earnings:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST: Create a payout request
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

    // Super-admins cannot request payouts (they collect platform commissions, not earnings)
    if (payload.role === 'super-admin') {
      return NextResponse.json(
        { error: 'Super-admins cannot request payouts. This feature is only available for bot owners.' },
        { status: 403 }
      );
    }

    await connectDB();

    const data = await request.json();
    const { amount, currency = 'BTC', walletAddress } = data; // Default to BTC for backward compatibility

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    if (!walletAddress || walletAddress.trim() === '') {
      return NextResponse.json({ error: 'Wallet address is required' }, { status: 400 });
    }

    // Get user's bots to calculate available earnings
    const userBots = await Bot.find(
      payload.role === 'super-admin' ? {} : { owner: payload.userId }
    );
    const userBotIds = userBots.map(b => b._id.toString());

    // Get all paid orders for user's bots
    const orders = await Order.find({
      botId: { $in: userBotIds },
      paymentStatus: 'paid'
    }).lean();

    // Calculate earnings per currency: order amount - commission (automatically deducted)
    const earningsByCurrency: Record<string, number> = {};
    orders.forEach(order => {
      const orderAmount = order.amount || 0;
      const commission = order.commission || 0;
      const earning = orderAmount - commission; // Commission automatically deducted
      const orderCurrency = (order.currency || 'BTC').toUpperCase();
      earningsByCurrency[orderCurrency] = (earningsByCurrency[orderCurrency] || 0) + earning;
    });

    // Get pending + approved (not yet paid) payout requests for balance calculation
    const { CommissionPayout } = await import('@/lib/models');
    const pendingPayouts = await CommissionPayout.find({
      userId: payload.userId,
      status: { $in: ['pending', 'approved'] },
    }).lean();

    const pendingPayoutsByCurrency: Record<string, number> = {};
    pendingPayouts.forEach(payout => {
      const payoutCurrency = (payout.currency || 'BTC').toUpperCase();
      pendingPayoutsByCurrency[payoutCurrency] = (pendingPayoutsByCurrency[payoutCurrency] || 0) + (payout.amount || 0);
    });

    // Calculate available for payout for the requested currency
    const requestedCurrency = (currency || 'BTC').toUpperCase();
    const earnedInCurrency = earningsByCurrency[requestedCurrency] || 0;
    const pendingInCurrency = pendingPayoutsByCurrency[requestedCurrency] || 0;
    const availableForPayout = earnedInCurrency - pendingInCurrency;

    // Prevent payouts if balance is zero or negative for this currency
    if (availableForPayout <= 0) {
      return NextResponse.json(
        { error: `No funds available for payout in ${requestedCurrency}. Current balance: ${availableForPayout.toFixed(8)}` },
        { status: 400 }
      );
    }

    // Prevent payouts exceeding available balance for this currency
    if (amount > availableForPayout) {
      return NextResponse.json(
        { error: `Insufficient balance in ${requestedCurrency}. Available: ${availableForPayout.toFixed(8)}` },
        { status: 400 }
      );
    }

    // Optional: auto-approve (no super-admin step)
    const autoApprove = process.env.AUTO_APPROVE_PAYOUTS === 'true';
    const maxAutoApprove = Number(process.env.AUTO_APPROVE_MAX_AMOUNT || '0');
    const approved = autoApprove && (maxAutoApprove === 0 || amount <= maxAutoApprove);

    const payout = new CommissionPayout({
      userId: payload.userId,
      amount,
      currency: currency.toUpperCase(),
      walletAddress: walletAddress.trim(),
      status: approved ? 'approved' : 'pending',
      requestedAt: new Date(),
    });

    await payout.save();

    // Optional: auto-process (call Python send immediately when approved)
    if (approved && process.env.AUTO_PROCESS_PAYOUTS === 'true') {
      await processOnePayout(payout, 'system');
    }

    return NextResponse.json(payout, { status: 201 });
  } catch (error: any) {
    console.error('Error creating payout request:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

