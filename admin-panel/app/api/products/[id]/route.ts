import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { Product } from '../../../../lib/models';
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
    const product = await Product.findById(params.id);

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    // Check ownership: super-admins can access any product, bot-owners only products for their bots
    if (payload.role !== 'super-admin') {
      const { Bot } = await import('../../../../lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());
      
      const productBotIds = (product.bot_ids || []).map((id: any) => id.toString());
      const hasAccess = productBotIds.some((id: string) => userBotIds.includes(id));
      
      if (!hasAccess) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    return NextResponse.json(product);
  } catch (error) {
    console.error('Error fetching product:', error);
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

    // Check ownership first
    const existingProduct = await Product.findById(params.id);
    if (!existingProduct) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const data = await request.json();

    if (payload.role !== 'super-admin') {
      const { Bot } = await import('../../../../lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());
      
      const productBotIds = (existingProduct.bot_ids || []).map((id: any) => id.toString());
      const hasAccess = productBotIds.some((id: string) => userBotIds.includes(id));
      
      if (!hasAccess) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      
      // Bot-owners can only assign products to their own bots
      if (data.bot_ids && Array.isArray(data.bot_ids)) {
        data.bot_ids = data.bot_ids.filter((id: string) => userBotIds.includes(id));
      }
    }
    const product = await Product.findByIdAndUpdate(
      params.id,
      { $set: data },
      { new: true }
    );

    return NextResponse.json(product);
  } catch (error) {
    console.error('Error updating product:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
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

    // Check ownership first
    const product = await Product.findById(params.id);
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    if (payload.role !== 'super-admin') {
      const { Bot } = await import('../../../../lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());
      
      const productBotIds = (product.bot_ids || []).map((id: any) => id.toString());
      const hasAccess = productBotIds.some((id: string) => userBotIds.includes(id));
      
      if (!hasAccess) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    await Product.findByIdAndDelete(params.id);
    return NextResponse.json({ message: 'Product deleted' });
  } catch (error) {
    console.error('Error deleting product:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

