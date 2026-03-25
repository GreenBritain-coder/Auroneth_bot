import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { Discount } from '../../../../lib/models';
import { getTokenFromRequest, verifyToken } from '../../../../lib/auth';
import { demoWriteBlocked } from '../../../../lib/demo-guard';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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
    const discount = await Discount.findById(params.id);
    
    if (!discount) {
      return NextResponse.json({ error: 'Discount not found' }, { status: 404 });
    }

    // Check if user has access to this discount
    if (payload.role !== 'super-admin') {
      const { Bot } = await import('../../../../lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());
      
      const hasAccess = discount.bot_ids.length === 0 || 
        discount.bot_ids.some((id: string) => userBotIds.includes(id));
      
      if (!hasAccess) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    return NextResponse.json(discount);
  } catch (error) {
    console.error('Error fetching discount:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const demoBlocked = demoWriteBlocked(payload);
    if (demoBlocked) return demoBlocked;

    await connectDB();
    const discount = await Discount.findById(params.id);

    if (!discount) {
      return NextResponse.json({ error: 'Discount not found' }, { status: 404 });
    }

    // Check if user has access to this discount
    if (payload.role !== 'super-admin') {
      const { Bot } = await import('../../../../lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());

      const hasAccess = discount.bot_ids.length === 0 ||
        discount.bot_ids.some((id: string) => userBotIds.includes(id));

      if (!hasAccess) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const data = await request.json();

    // If code is being changed, check uniqueness
    if (data.code && data.code.toUpperCase() !== discount.code) {
      const existingDiscount = await Discount.findOne({ code: data.code.toUpperCase() });
      if (existingDiscount) {
        return NextResponse.json(
          { error: 'Discount code already exists' },
          { status: 400 }
        );
      }
    }

    // Bot-owners can only assign discounts to their own bots
    let bot_ids = data.bot_ids !== undefined ? data.bot_ids : discount.bot_ids;
    if (payload.role !== 'super-admin' && bot_ids.length > 0) {
      const { Bot } = await import('../../../../lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());
      
      bot_ids = bot_ids.filter((id: string) => userBotIds.includes(id));
    }

    // Update discount
    discount.code = data.code ? data.code.toUpperCase() : discount.code;
    discount.description = data.description !== undefined ? data.description : discount.description;
    discount.discount_type = data.discount_type || discount.discount_type;
    discount.discount_value = data.discount_value !== undefined ? data.discount_value : discount.discount_value;
    discount.bot_ids = bot_ids;
    discount.min_order_amount = data.min_order_amount !== undefined ? data.min_order_amount : discount.min_order_amount;
    discount.max_discount_amount = data.max_discount_amount !== undefined ? data.max_discount_amount : discount.max_discount_amount;
    discount.usage_limit = data.usage_limit !== undefined ? data.usage_limit : discount.usage_limit;
    discount.valid_from = data.valid_from ? new Date(data.valid_from) : discount.valid_from;
    discount.valid_until = data.valid_until ? new Date(data.valid_until) : discount.valid_until;
    discount.active = data.active !== undefined ? data.active : discount.active;
    discount.applicable_product_ids = data.applicable_product_ids !== undefined ? data.applicable_product_ids : (discount.applicable_product_ids || []);

    await discount.save();
    return NextResponse.json(discount);
  } catch (error: any) {
    console.error('Error updating discount:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const demoBlocked = demoWriteBlocked(payload);
    if (demoBlocked) return demoBlocked;

    await connectDB();
    const discount = await Discount.findById(params.id);

    if (!discount) {
      return NextResponse.json({ error: 'Discount not found' }, { status: 404 });
    }

    // Check if user has access to this discount
    if (payload.role !== 'super-admin') {
      const { Bot } = await import('../../../../lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());

      const hasAccess = discount.bot_ids.length === 0 ||
        discount.bot_ids.some((id: string) => userBotIds.includes(id));

      if (!hasAccess) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    await Discount.findByIdAndDelete(params.id);
    return NextResponse.json({ message: 'Discount deleted' });
  } catch (error) {
    console.error('Error deleting discount:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

