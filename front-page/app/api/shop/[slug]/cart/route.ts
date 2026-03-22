import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../../lib/db';
import { Bot, Cart, Product, ICartItem } from '../../../../../lib/models';
import { getProductPrice } from '../../../../../lib/product-utils';
import { getValidatedCart } from '../../../../../lib/shop-utils';

export const dynamic = 'force-dynamic';

async function getBotId(slug: string): Promise<string | null> {
  await connectDB();
  const bot = await Bot.findOne({ web_shop_slug: slug, web_shop_enabled: true }).lean();
  return bot ? String(bot._id) : null;
}

function getSessionId(request: NextRequest): string | null {
  return request.cookies.get('shop_session_id')?.value || null;
}

// GET - Get cart with validated prices
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const botId = await getBotId(slug);
    if (!botId) {
      return NextResponse.json({ error: 'Shop not found or disabled' }, { status: 404 });
    }

    const sessionId = getSessionId(request);
    if (!sessionId) {
      return NextResponse.json({ cart: { items: [], subtotal: 0, service_fee: 0, discount: 0, total: 0, currency: 'GBP', item_count: 0, has_stale_prices: false, has_out_of_stock: false } });
    }

    const validated = await getValidatedCart(botId, sessionId);
    const { cart: _cart, ...cartResponse } = validated;
    return NextResponse.json({ cart: cartResponse });
  } catch (error) {
    console.error('Error fetching cart:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Add item to cart
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const botId = await getBotId(slug);
    if (!botId) {
      return NextResponse.json({ error: 'Shop not found or disabled' }, { status: 404 });
    }

    const sessionId = getSessionId(request);
    if (!sessionId) {
      return NextResponse.json({ error: 'No session' }, { status: 401 });
    }

    const body = await request.json();
    const { product_id, quantity = 1 } = body;

    if (!product_id || typeof quantity !== 'number' || quantity < 1 || quantity > 10) {
      return NextResponse.json({ error: 'Invalid product_id or quantity (1-10)' }, { status: 400 });
    }

    await connectDB();
    const product = await Product.findOne({ _id: product_id, bot_ids: botId }).lean();
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const currentPrice = getProductPrice(product as Record<string, unknown>);
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    let cart = await Cart.findOne({ bot_id: botId, session_id: sessionId });

    if (!cart) {
      cart = new Cart({
        bot_id: botId,
        session_id: sessionId,
        items: [],
        expires_at: expires,
      });
    }

    if (cart.items.length >= 50) {
      return NextResponse.json({ error: 'Cart is full (max 50 items)' }, { status: 400 });
    }

    const existingItem = cart.items.find((i: ICartItem) => i.product_id === product_id);
    if (existingItem) {
      const newQty = Math.min(existingItem.quantity + quantity, 10);
      existingItem.quantity = newQty;
      existingItem.price_snapshot = currentPrice;
      existingItem.added_at = new Date();
    } else {
      cart.items.push({
        product_id,
        quantity: Math.min(quantity, 10),
        price_snapshot: currentPrice,
        added_at: new Date(),
      });
    }

    cart.expires_at = expires;
    await cart.save();

    const validated = await getValidatedCart(botId, sessionId);
    const { cart: _cart, ...cartResponse } = validated;
    return NextResponse.json({ cart: cartResponse });
  } catch (error) {
    console.error('Error adding to cart:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH - Update item quantity
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const botId = await getBotId(slug);
    if (!botId) {
      return NextResponse.json({ error: 'Shop not found or disabled' }, { status: 404 });
    }

    const sessionId = getSessionId(request);
    if (!sessionId) {
      return NextResponse.json({ error: 'No session' }, { status: 401 });
    }

    const body = await request.json();
    const { product_id, quantity } = body;

    if (!product_id || typeof quantity !== 'number' || quantity < 0 || quantity > 10) {
      return NextResponse.json({ error: 'Invalid product_id or quantity (0-10)' }, { status: 400 });
    }

    await connectDB();
    const cart = await Cart.findOne({ bot_id: botId, session_id: sessionId });
    if (!cart) {
      return NextResponse.json({ error: 'Cart not found' }, { status: 404 });
    }

    if (quantity === 0) {
      cart.items = cart.items.filter((i: ICartItem) => i.product_id !== product_id);
    } else {
      const item = cart.items.find((i: ICartItem) => i.product_id === product_id);
      if (!item) {
        return NextResponse.json({ error: 'Item not in cart' }, { status: 404 });
      }
      item.quantity = quantity;
    }

    await cart.save();

    const validated = await getValidatedCart(botId, sessionId);
    const { cart: _cart, ...cartResponse } = validated;
    return NextResponse.json({ cart: cartResponse });
  } catch (error) {
    console.error('Error updating cart:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE - Remove item from cart
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const botId = await getBotId(slug);
    if (!botId) {
      return NextResponse.json({ error: 'Shop not found or disabled' }, { status: 404 });
    }

    const sessionId = getSessionId(request);
    if (!sessionId) {
      return NextResponse.json({ error: 'No session' }, { status: 401 });
    }

    const body = await request.json();
    const { product_id } = body;

    if (!product_id) {
      return NextResponse.json({ error: 'product_id required' }, { status: 400 });
    }

    await connectDB();
    const cart = await Cart.findOne({ bot_id: botId, session_id: sessionId });
    if (!cart) {
      return NextResponse.json({ error: 'Cart not found' }, { status: 404 });
    }

    cart.items = cart.items.filter((i: ICartItem) => i.product_id !== product_id);
    await cart.save();

    const validated = await getValidatedCart(botId, sessionId);
    const { cart: _cart, ...cartResponse } = validated;
    return NextResponse.json({ cart: cartResponse });
  } catch (error) {
    console.error('Error removing from cart:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
