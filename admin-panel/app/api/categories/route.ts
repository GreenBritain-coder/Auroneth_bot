import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../lib/db';
import { Category, Subcategory, Product, Order } from '../../../lib/models';
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
    
    // Super-admins see all categories, bot-owners only see categories for their bots
    let categories;
    if (payload.role === 'super-admin') {
      categories = await Category.find({}).sort({ order: 1 }).lean();
    } else {
      const { Bot } = await import('../../../lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());
      
      categories = await Category.find({
        bot_ids: { $in: userBotIds }
      }).sort({ order: 1 }).lean();
    }
    
    // Calculate order counts for each category
    // Chain: Category → Subcategory → Product → Order
    const categoryIds = categories.map((c: { _id: unknown }) => String(c._id));
    console.log(`[Categories API] Categories: ${categories.map((c: { name?: string }) => c.name ?? '').join(', ')}, IDs: ${categoryIds.join(', ')}`);
    
    // Get all subcategories for these categories
    const subcategories = await Subcategory.find({
      category_id: { $in: categoryIds }
    }).lean();
    
    const subcategoryIds = subcategories.map(s => s._id.toString());
    console.log(`[Categories API] Subcategories: ${subcategories.length}, IDs: ${subcategoryIds.join(', ')}`);
    
    // Get all products for these subcategories
    const products = await Product.find({
      subcategory_id: { $in: subcategoryIds }
    }).lean();
    
    console.log(`[Categories API] Products found: ${products.length}`);
    if (products.length > 0) {
      console.log(`[Categories API] Sample product: _id=${products[0]._id}, subcategory_id=${products[0].subcategory_id}`);
    }
    
    // Create a set of all possible product ID representations (ObjectId and string)
    const productIdSet = new Set<string>();
    const productIdMap: Record<string, string> = {}; // Maps all ID formats to canonical format
    
    products.forEach(product => {
      const productId = product._id.toString();
      productIdSet.add(productId);
      productIdMap[productId] = productId;
      
      // Also add ObjectId format if it's different
      if (product._id && typeof product._id === 'object') {
        const objIdStr = (product._id as any).toString();
        if (objIdStr !== productId) {
          productIdSet.add(objIdStr);
          productIdMap[objIdStr] = productId;
        }
      }
    });
    
    // NEW APPROACH: Query ALL orders and check if their products belong to our categories
    // This handles cases where productId format doesn't match or products moved/deleted
    const allOrders = await Order.find({}).lean();
    
    // Fetch ALL products to handle orders with productIds not in our category products
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
    
    // Filter orders to only those whose products belong to our categories
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
    
    console.log(`[Categories API] Found ${products.length} category products, ${allOrders.length} total orders, ${orders.length} orders for category`);
    
    orders.forEach(order => {
      if (!order.productId) {
        console.log(`[Categories API] Order ${order._id} has no productId`);
        return;
      }
      
      // Get the product for this order
      const orderProductId = order.productId.toString();
      const product = allProductMap[orderProductId];
      
      if (!product) {
        console.log(`[Categories API] Order productId ${orderProductId} - product not found in database`);
        return;
      }
      
      // Use the product's canonical ID
      const productCanonicalId = product._id.toString();
      
      // Increment count for this product
      orderCountsByProduct[productCanonicalId] = (orderCountsByProduct[productCanonicalId] || 0) + 1;
    });
    
    // Also ensure products in our category are in the map (even with 0 orders)
    products.forEach(product => {
      const productId = product._id.toString();
      if (!(productId in orderCountsByProduct)) {
        orderCountsByProduct[productId] = 0;
      }
    });
    
    console.log(`[Categories API] Order counts by product:`, orderCountsByProduct);
    
    // Map products to subcategories - include ALL products that have orders (even if not in our initial category products)
    const productsBySubcategory: Record<string, string[]> = {};
    
    // First, add products from our category
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
    
    // Map subcategories to categories
    const subcategoriesByCategory: Record<string, string[]> = {};
    subcategories.forEach(subcategory => {
      const categoryId = subcategory.category_id?.toString();
      if (categoryId) {
        if (!subcategoriesByCategory[categoryId]) {
          subcategoriesByCategory[categoryId] = [];
        }
        subcategoriesByCategory[categoryId].push(subcategory._id.toString());
      }
    });
    
    // Calculate order counts per category
    const orderCountsByCategory: Record<string, number> = {};
    categories.forEach(category => {
      const categoryId = category._id.toString();
      const subcategoryIds = subcategoriesByCategory[categoryId] || [];
      
      let totalOrders = 0;
      subcategoryIds.forEach(subcategoryId => {
        const productIdsForSubcategory = productsBySubcategory[subcategoryId] || [];
        productIdsForSubcategory.forEach(productId => {
          totalOrders += orderCountsByProduct[productId] || 0;
        });
      });
      
      orderCountsByCategory[categoryId] = totalOrders;
    });
    
    // Add order counts to categories
    const categoriesWithOrderCounts = categories.map(category => ({
      ...category,
      orderCount: orderCountsByCategory[category._id.toString()] || 0
    }));
    
    return NextResponse.json(categoriesWithOrderCounts);
  } catch (error) {
    console.error('Error fetching categories:', error);
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

    // Bot-owners can only assign categories to their own bots
    let bot_ids = data.bot_ids || [];
    if (payload.role !== 'super-admin' && bot_ids.length > 0) {
      const { Bot } = await import('../../../lib/models');
      const userBots = await Bot.find({ owner: payload.userId });
      const userBotIds = userBots.map(b => b._id.toString());
      
      bot_ids = bot_ids.filter((id: string) => userBotIds.includes(id));
    }

    const category = new Category({
      name: data.name,
      description: data.description || '',
      bot_ids: bot_ids,
      order: data.order || 0,
    });

    await category.save();
    return NextResponse.json(category, { status: 201 });
  } catch (error: any) {
    console.error('Error creating category:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

