import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { Subcategory } from '../../../../lib/models';
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
    const subcategory = await Subcategory.findById(params.id);

    if (!subcategory) {
      return NextResponse.json({ error: 'Subcategory not found' }, { status: 404 });
    }

    // Check ownership
    if (payload.role !== 'super-admin') {
      const { Bot } = await import('../../../../lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());
      
      const subcategoryBotIds = (subcategory.bot_ids || []).map((id: any) => id.toString());
      const hasAccess = subcategoryBotIds.some((id: string) => userBotIds.includes(id));
      
      if (!hasAccess) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    return NextResponse.json(subcategory);
  } catch (error) {
    console.error('Error fetching subcategory:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
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

    const existingSubcategory = await Subcategory.findById(params.id);
    if (!existingSubcategory) {
      return NextResponse.json({ error: 'Subcategory not found' }, { status: 404 });
    }

    const data = await request.json();

    if (payload.role !== 'super-admin') {
      const { Bot } = await import('../../../../lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());

      const subcategoryBotIds = (existingSubcategory.bot_ids || []).map((id: any) => id.toString());
      const hasAccess = subcategoryBotIds.some((id: string) => userBotIds.includes(id));

      if (!hasAccess) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      if (data.bot_ids && Array.isArray(data.bot_ids)) {
        data.bot_ids = data.bot_ids.filter((id: string) => userBotIds.includes(id));
      }
    }
    const subcategory = await Subcategory.findByIdAndUpdate(
      params.id,
      { $set: data },
      { new: true }
    );

    return NextResponse.json(subcategory);
  } catch (error: any) {
    console.error('Error updating subcategory:', error);
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

    const subcategory = await Subcategory.findById(params.id);
    if (!subcategory) {
      return NextResponse.json({ error: 'Subcategory not found' }, { status: 404 });
    }

    if (payload.role !== 'super-admin') {
      const { Bot } = await import('../../../../lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());
      
      const subcategoryBotIds = (subcategory.bot_ids || []).map((id: any) => id.toString());
      const hasAccess = subcategoryBotIds.some((id: string) => userBotIds.includes(id));
      
      if (!hasAccess) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    await Subcategory.findByIdAndDelete(params.id);
    return NextResponse.json({ message: 'Subcategory deleted' });
  } catch (error) {
    console.error('Error deleting subcategory:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

