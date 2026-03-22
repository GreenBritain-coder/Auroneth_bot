import { cookies } from 'next/headers';
import connectDB from './db';
import { Bot, Cart, Product, ICartItem } from './models';
import { getProductPrice } from './product-utils';

export async function getShopBot(slug: string) {
  await connectDB();
  return Bot.findOne({
    web_shop_slug: slug,
    web_shop_enabled: true,
  }).lean();
}

export async function getSessionId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get('shop_session_id')?.value || null;
}

export async function getValidatedCart(botId: string, sessionId: string) {
  const cart = await Cart.findOne({ bot_id: botId, session_id: sessionId });
  if (!cart || cart.items.length === 0) {
    return { cart, items: [], subtotal: 0, discount: 0, total: 0, item_count: 0, has_stale_prices: false, has_out_of_stock: false };
  }

  const productIds = cart.items.map((i: ICartItem) => i.product_id);
  const products = await Product.find({ _id: { $in: productIds } })
    .select('name price base_price currency image_url stock variations unit')
    .lean();
  const productMap = new Map(products.map((p: Record<string, unknown>) => [String(p._id), p]));

  let hasStale = false;
  let hasOos = false;
  let subtotal = 0;

  const validatedItems = cart.items.map((item: ICartItem) => {
    const product = productMap.get(item.product_id);
    if (!product) {
      hasOos = true;
      return {
        product_id: item.product_id,
        name: 'Unknown Product',
        price: item.price_snapshot,
        price_changed: false,
        quantity: item.quantity,
        line_total: 0,
        in_stock: false,
        image_url: '',
      };
    }

    const currentPrice = getProductPrice(product as Record<string, unknown>);
    const priceChanged = Math.abs(currentPrice - item.price_snapshot) > 0.001;
    if (priceChanged) {
      hasStale = true;
      item.price_snapshot = currentPrice;
    }

    const lineTotal = Math.round(currentPrice * item.quantity * 100) / 100;
    subtotal += lineTotal;

    // Stock check: null/undefined stock = unlimited (matches Telegram bot behavior)
    const productStock = (product as Record<string, unknown>).stock as number | null | undefined;
    const variations = (product as Record<string, unknown>).variations as Array<{ stock?: number }> | undefined;
    const hasAnyStockField = productStock !== undefined && productStock !== null;
    const hasVariationStock = variations?.some((v: { stock?: number }) => v.stock !== undefined && v.stock !== null) ?? false;
    let inStock = true;
    if (hasAnyStockField) {
      inStock = productStock > 0;
    } else if (hasVariationStock) {
      const totalStock = (variations || []).reduce((sum: number, v: { stock?: number }) => sum + (v.stock ?? 0), 0);
      inStock = totalStock > 0;
    }
    // No stock field at all = unlimited = in stock
    if (!inStock) hasOos = true;

    return {
      product_id: item.product_id,
      name: (product as Record<string, unknown>).name as string,
      price: currentPrice,
      price_changed: priceChanged,
      quantity: item.quantity,
      line_total: lineTotal,
      in_stock: inStock,
      image_url: ((product as Record<string, unknown>).image_url as string) || '',
      unit: ((product as Record<string, unknown>).unit as string) || 'pcs',
    };
  });

  if (hasStale && cart) {
    await cart.save();
  }

  subtotal = Math.round(subtotal * 100) / 100;
  const discount = cart.discount_amount || 0;
  const total = Math.round((subtotal - discount) * 100) / 100;

  return {
    cart,
    items: validatedItems,
    subtotal,
    discount,
    discount_code: cart.discount_code || null,
    total: Math.max(total, 0),
    currency: 'GBP',
    item_count: cart.items.reduce((sum: number, i: ICartItem) => sum + i.quantity, 0),
    has_stale_prices: hasStale,
    has_out_of_stock: hasOos,
  };
}
