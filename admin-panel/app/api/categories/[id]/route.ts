import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { Category } from '@/lib/models';
import { getTokenFromRequest, verifyToken } from '@/lib/auth';

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
    const category = await Category.findById(params.id);

    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    // Check ownership
    if (payload.role !== 'super-admin') {
      const { Bot } = await import('@/lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());
      
      const categoryBotIds = (category.bot_ids || []).map((id: any) => id.toString());
      const hasAccess = categoryBotIds.some((id: string) => userBotIds.includes(id));
      
      if (!hasAccess) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    return NextResponse.json(category);
  } catch (error) {
    console.error('Error fetching category:', error);
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

    await connectDB();
    
    const existingCategory = await Category.findById(params.id);
    if (!existingCategory) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    if (payload.role !== 'super-admin') {
      const { Bot } = await import('@/lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());
      
      const categoryBotIds = (existingCategory.bot_ids || []).map((id: any) => id.toString());
      const hasAccess = categoryBotIds.some((id: string) => userBotIds.includes(id));
      
      if (!hasAccess) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      
      // Filter bot_ids to only user's bots
      const data = await request.json();
      if (data.bot_ids && Array.isArray(data.bot_ids)) {
        data.bot_ids = data.bot_ids.filter((id: string) => userBotIds.includes(id));
      }
    }

    const data = await request.json();
    const category = await Category.findByIdAndUpdate(
      params.id,
      { $set: data },
      { new: true }
    );

    return NextResponse.json(category);
  } catch (error: any) {
    console.error('Error updating category:', error);
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

    await connectDB();
    
    const category = await Category.findById(params.id);
    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    if (payload.role !== 'super-admin') {
      const { Bot } = await import('@/lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());
      
      const categoryBotIds = (category.bot_ids || []).map((id: any) => id.toString());
      const hasAccess = categoryBotIds.some((id: string) => userBotIds.includes(id));
      
      if (!hasAccess) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    await Category.findByIdAndDelete(params.id);
    return NextResponse.json({ message: 'Category deleted' });
  } catch (error) {
    console.error('Error deleting category:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

