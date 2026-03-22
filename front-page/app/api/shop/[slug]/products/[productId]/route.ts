import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../../../lib/db';
import { Bot, Product } from '../../../../../../lib/models';
import { getProductPrice } from '../../../../../../lib/product-utils';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; productId: string }> }
) {
  try {
    await connectDB();
    const { slug, productId } = await params;

    const bot = await Bot.findOne({
      web_shop_slug: slug,
      web_shop_enabled: true,
    }).lean();

    if (!bot) {
      return NextResponse.json(
        { error: 'Shop not found or disabled' },
        { status: 404 }
      );
    }

    const botId = String(bot._id);
    const product = await Product.findOne({ _id: productId, bot_ids: botId }).lean() as Record<string, unknown> | null;

    if (!product) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      );
    }

    const res = NextResponse.json({
      product: {
        _id: product._id,
        name: product.name,
        price: getProductPrice(product),
        currency: product.currency,
        description: product.description || '',
        image_url: product.image_url || '',
        unit: product.unit || 'pcs',
        variations: product.variations || [],
      },
    });
    res.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    return res;
  } catch (error) {
    console.error('Error fetching product:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
