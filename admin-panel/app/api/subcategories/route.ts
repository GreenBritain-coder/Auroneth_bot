import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../lib/db';
import { Subcategory, Product, Order } from '../../../lib/models';
import { getTokenFromRequest, verifyToken } from '../../../lib/auth';

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
    
    const categoryId = request.nextUrl.searchParams.get('category_id');
    const query: any = {};
    
    if (categoryId) {
      query.category_id = categoryId;
    }
    
    // Super-admins see all, bot-owners only their bots
    if (payload.role !== 'super-admin') {
      const { Bot } = await import('../../../lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());
      
      query.bot_ids = { $in: userBotIds };
    }
    
    const subcategories = await Subcategory.find(query).sort({ order: 1 }).lean();
    
    // Calculate order counts for each subcategory
    // Chain: Subcategory → Product → Order
    const subcategoryIds = subcategories.map(s => s._id.toString());
    
    // Get all products for these subcategories
    const products = await Product.find({
      subcategory_id: { $in: subcategoryIds }
    }).lean();
    
    // NEW APPROACH: Query ALL orders and check if their products belong to our subcategories
    const allOrders = await Order.find({}).lean();
    
    // Fetch ALL products to handle orders with productIds not in our subcategory products
    const allProducts = await Product.find({}).lean();
    const allProductMap: Record<string, any> = {};
    allProducts.forEach(product => {
      const productId = product._id.toString();
      allProductMap[productId] = product;
      // Also map ObjectId format
      if (product._id && typeof product._id === 'object') {
        allProductMap[(product._id as any).toString()] = product;
      }
    });
    
    // Filter orders to only those whose products belong to our subcategories
    const orders = allOrders.filter(order => {
      if (!order.productId) return false;
      
      const orderProductId = order.productId.toString();
      const product = allProductMap[orderProductId];
      
      if (!product || !product.subcategory_id) return false;
      
      const productSubcategoryId = product.subcategory_id.toString();
      return subcategoryIds.includes(productSubcategoryId);
    });
    
    // Count orders per product
    const orderCountsByProduct: Record<string, number> = {};
    orders.forEach(order => {
      if (!order.productId) return;
      
      const orderProductId = order.productId.toString();
      const product = allProductMap[orderProductId];
      
      if (!product) return;
      
      const productCanonicalId = product._id.toString();
      orderCountsByProduct[productCanonicalId] = (orderCountsByProduct[productCanonicalId] || 0) + 1;
    });
    
    // Also ensure products in our subcategories are in the map (even with 0 orders)
    products.forEach(product => {
      const productId = product._id.toString();
      if (!(productId in orderCountsByProduct)) {
        orderCountsByProduct[productId] = 0;
      }
    });
    
    // Map products to subcategories - include ALL products that have orders (even if not in our initial subcategory products)
    const productsBySubcategory: Record<string, string[]> = {};
    
    // First, add products from our subcategories
    products.forEach(product => {
      const subcategoryId = product.subcategory_id?.toString();
      const canonicalProductId = product._id.toString();
      if (subcategoryId && subcategoryIds.includes(subcategoryId)) {
        if (!productsBySubcategory[subcategoryId]) {
          productsBySubcategory[subcategoryId] = [];
        }
        if (!productsBySubcategory[subcategoryId].includes(canonicalProductId)) {
          productsBySubcategory[subcategoryId].push(canonicalProductId);
        }
      }
    });
    
    // Also add products from orders that belong to our subcategories
    orders.forEach(order => {
      if (!order.productId) return;
      const orderProductId = order.productId.toString();
      const product = allProductMap[orderProductId];
      if (product && product.subcategory_id) {
        const subcategoryId = product.subcategory_id.toString();
        if (subcategoryIds.includes(subcategoryId)) {
          const canonicalProductId = product._id.toString();
          if (!productsBySubcategory[subcategoryId]) {
            productsBySubcategory[subcategoryId] = [];
          }
          if (!productsBySubcategory[subcategoryId].includes(canonicalProductId)) {
            productsBySubcategory[subcategoryId].push(canonicalProductId);
          }
        }
      }
    });
    
    // Calculate order counts per subcategory
    const orderCountsBySubcategory: Record<string, number> = {};
    subcategories.forEach(subcategory => {
      const subcategoryId = subcategory._id.toString();
      const productIdsForSubcategory = productsBySubcategory[subcategoryId] || [];
      
      let totalOrders = 0;
      productIdsForSubcategory.forEach(productId => {
        totalOrders += orderCountsByProduct[productId] || 0;
      });
      
      orderCountsBySubcategory[subcategoryId] = totalOrders;
    });
    
    // Add order counts to subcategories
    const subcategoriesWithOrderCounts = subcategories.map(subcategory => ({
      ...subcategory,
      orderCount: orderCountsBySubcategory[subcategory._id.toString()] || 0
    }));
    
    return NextResponse.json(subcategoriesWithOrderCounts);
  } catch (error) {
    console.error('Error fetching subcategories:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

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

    await connectDB();
    const data = await request.json();

    if (!data.category_id) {
      return NextResponse.json(
        { error: 'category_id is required' },
        { status: 400 }
      );
    }

    // Bot-owners can only assign to their own bots
    let bot_ids = data.bot_ids || [];
    if (payload.role !== 'super-admin' && bot_ids.length > 0) {
      const { Bot } = await import('../../../lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());
      
      bot_ids = bot_ids.filter((id: string) => userBotIds.includes(id));
    }

    const subcategory = new Subcategory({
      name: data.name,
      description: data.description || '',
      category_id: data.category_id,
      bot_ids: bot_ids,
      order: data.order || 0,
    });

    await subcategory.save();
    return NextResponse.json(subcategory, { status: 201 });
  } catch (error: any) {
    console.error('Error creating subcategory:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

