import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectDB from '../../../../lib/db';
import { Category } from '../../../../lib/models';
import { getTokenFromRequest, verifyToken } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Simple endpoint for category dropdowns (product form).
 * Returns only _id and name - no order counts or complex logic.
 */
export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();

    let categories;
    if (payload.role === 'super-admin') {
      categories = await Category.find({}).sort({ order: 1 }).select('_id name').lean();
    } else {
      const { Bot } = await import('../../../../lib/models');
      let userBots = await Bot.find({ owner: payload.userId });
      if (userBots.length === 0 && payload.userId && /^[a-f0-9]{24}$/i.test(payload.userId)) {
        try {
          userBots = await Bot.find({ owner: new mongoose.Types.ObjectId(payload.userId) });
        } catch {}
      }
      const userBotIds = userBots.map(b => b._id.toString());

      if (userBotIds.length === 0) {
        categories = await Category.find({}).sort({ order: 1 }).select('_id name').lean();
      } else {
        const matchIds: (string | mongoose.Types.ObjectId)[] = [...userBotIds];
        userBotIds.forEach(id => {
          if (/^[a-f0-9]{24}$/i.test(id)) {
            try {
              matchIds.push(new mongoose.Types.ObjectId(id));
            } catch {}
          }
        });

        categories = await Category.find({
          $or: [
            { bot_ids: { $in: matchIds } },
            { bot_ids: { $size: 0 } }
          ]
        }).sort({ order: 1 }).select('_id name').lean();

        if (categories.length === 0) {
          categories = await Category.find({}).sort({ order: 1 }).select('_id name').lean();
        }
      }
    }

    return NextResponse.json(categories);
  } catch (error) {
    console.error('Error fetching categories list:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
