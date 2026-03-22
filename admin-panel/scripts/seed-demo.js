const mongoose = require('mongoose');
// Pre-computed bcrypt hash for 'demo123' (bcryptjs may not be in container)
const DEMO_PASSWORD_HASH = '$2a$10$1eOZaj/lhbiJBGNi1ybUu.m7u3lRpN7AVBfGkIFBcwC2C/p51UTLe';
try { require('dotenv').config(); } catch(e) { /* dotenv optional */ }

async function seed() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/telegram_bot_platform';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;

  // ── 1. Demo Admin User ──────────────────────────────────────────────
  const adminsCol = db.collection('admins');
  const demoAdmin = await adminsCol.findOneAndUpdate(
    { username: 'demo' },
    {
      $setOnInsert: {
        username: 'demo',
        password_hash: DEMO_PASSWORD_HASH,
        role: 'demo',
        created_at: new Date(),
      },
    },
    { upsert: true, returnDocument: 'after' }
  );
  const demoAdminId = demoAdmin._id.toString();
  console.log(`Demo admin ready: ${demoAdminId}`);

  // ── 2. Demo Bot ─────────────────────────────────────────────────────
  const botsCol = db.collection('bots');
  const demoBot = await botsCol.findOneAndUpdate(
    { token: '8723767603:AAF4aY9LiGy0qsiGYLuA7meRCGtpwfpIx9w' },
    {
      $set: {
        token: '8723767603:AAF4aY9LiGy0qsiGYLuA7meRCGtpwfpIx9w',
        name: 'Auroneth Demo',
        description: 'Experience the full Auroneth platform. Browse products, manage orders, and explore all features.',
        status: 'live',
        owner: demoAdminId,
        public_listing: true,
        main_buttons: ['Shop', 'Support'],
        messages: {
          welcome: 'Welcome to Auroneth Demo! 🎉\n\nExplore our platform features. Your secret phrase is: {{secret_phrase}}',
          thank_you: 'Thank you for your demo order! This is a demonstration of the checkout flow.',
          support: 'Need help? Contact us at support@auroneth.info\n\nThis is a demo support message.',
        },
        payment_methods: ['BTC', 'LTC'],
        web_shop_enabled: true,
        web_shop_slug: 'demo',
        routes: 'United Kingdom 🇬🇧',
        language: 'British English',
        rating: '98',
        rating_count: '2847',
        cut_off_time: '14:30',
        featured: true,
        categories: ['🛍️'],
        profile_picture_url: '',
        inline_buttons: {},
        products: [],
      },
    },
    { upsert: true, returnDocument: 'after' }
  );
  const demoBotId = demoBot._id.toString();
  console.log(`Demo bot ready: ${demoBotId}`);

  // ── 3. Categories ───────────────────────────────────────────────────
  const categoriesCol = db.collection('categories');
  const categoryDefs = [
    { name: 'Flowers', order: 0 },
    { name: 'Edibles', order: 1 },
    { name: 'Accessories', order: 2 },
  ];

  const categoryIds = {};
  for (const cat of categoryDefs) {
    const result = await categoriesCol.findOneAndUpdate(
      { name: cat.name, bot_ids: demoBotId },
      {
        $set: { name: cat.name, order: cat.order, bot_ids: [demoBotId], description: '' },
      },
      { upsert: true, returnDocument: 'after' }
    );
    categoryIds[cat.name] = result._id.toString();
    console.log(`Category "${cat.name}" ready: ${categoryIds[cat.name]}`);
  }

  // ── 4. Subcategories ────────────────────────────────────────────────
  const subcategoriesCol = db.collection('subcategories');
  const subcategoryDefs = [
    { name: 'Indoor', category: 'Flowers', order: 0 },
    { name: 'Outdoor', category: 'Flowers', order: 1 },
    { name: 'Gummies', category: 'Edibles', order: 0 },
    { name: 'Chocolates', category: 'Edibles', order: 1 },
    { name: 'Rolling Papers & Tips', category: 'Accessories', order: 0 },
  ];

  const subcategoryIds = {};
  for (const sub of subcategoryDefs) {
    const result = await subcategoriesCol.findOneAndUpdate(
      { name: sub.name, category_id: categoryIds[sub.category], bot_ids: demoBotId },
      {
        $set: {
          name: sub.name,
          category_id: categoryIds[sub.category],
          bot_ids: [demoBotId],
          order: sub.order,
          description: '',
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    subcategoryIds[sub.name] = result._id.toString();
    console.log(`Subcategory "${sub.name}" ready: ${subcategoryIds[sub.name]}`);
  }

  // ── 5. Products ─────────────────────────────────────────────────────
  const productsCol = db.collection('products');
  const productDefs = [
    // Flowers > Indoor
    {
      name: 'Amnesia Haze',
      base_price: 30,
      unit: 'gr',
      description: 'Premium indoor-grown Amnesia Haze with a strong citrus aroma and uplifting sativa effects.',
      subcategory_id: subcategoryIds['Indoor'],
      category_id: categoryIds['Flowers'],
      variations: [
        { name: '3.5g', price_modifier: 0 },
        { name: '7g', price_modifier: 25 },
        { name: '14g', price_modifier: 60 },
        { name: '28g', price_modifier: 100 },
      ],
    },
    {
      name: 'Gorilla Glue',
      base_price: 35,
      unit: 'gr',
      description: 'Heavy-hitting hybrid with a pungent earthy aroma. Known for its potency and sticky resin.',
      subcategory_id: subcategoryIds['Indoor'],
      category_id: categoryIds['Flowers'],
      variations: [
        { name: '3.5g', price_modifier: 0 },
        { name: '7g', price_modifier: 30 },
        { name: '14g', price_modifier: 65 },
        { name: '28g', price_modifier: 110 },
      ],
    },
    {
      name: 'Wedding Cake',
      base_price: 40,
      unit: 'gr',
      description: 'Top-shelf indica-dominant hybrid with sweet vanilla notes and relaxing effects.',
      subcategory_id: subcategoryIds['Indoor'],
      category_id: categoryIds['Flowers'],
      variations: [
        { name: '3.5g', price_modifier: 0 },
        { name: '7g', price_modifier: 35 },
        { name: '14g', price_modifier: 75 },
        { name: '28g', price_modifier: 130 },
      ],
    },
    // Flowers > Outdoor
    {
      name: 'Lemon Haze',
      base_price: 20,
      unit: 'gr',
      description: 'Outdoor-grown Lemon Haze with a zesty lemon flavour and energising sativa high.',
      subcategory_id: subcategoryIds['Outdoor'],
      category_id: categoryIds['Flowers'],
      variations: [
        { name: '3.5g', price_modifier: 0 },
        { name: '7g', price_modifier: 15 },
        { name: '14g', price_modifier: 35 },
        { name: '28g', price_modifier: 60 },
      ],
    },
    {
      name: 'Blue Dream',
      base_price: 22,
      unit: 'gr',
      description: 'Classic sativa-dominant hybrid with sweet berry aroma. Balanced and mellow effects.',
      subcategory_id: subcategoryIds['Outdoor'],
      category_id: categoryIds['Flowers'],
      variations: [
        { name: '3.5g', price_modifier: 0 },
        { name: '7g', price_modifier: 18 },
        { name: '14g', price_modifier: 40 },
        { name: '28g', price_modifier: 70 },
      ],
    },
    // Edibles > Gummies
    {
      name: 'Sour Gummy Bears 100mg',
      base_price: 12.99,
      unit: 'pcs',
      description: 'Assorted sour gummy bears infused with 100mg total. 10 pieces per pack.',
      subcategory_id: subcategoryIds['Gummies'],
      category_id: categoryIds['Edibles'],
      variations: [],
    },
    {
      name: 'Watermelon Slices 200mg',
      base_price: 19.99,
      unit: 'pcs',
      description: 'Juicy watermelon-flavoured gummy slices with 200mg total. 10 pieces per pack.',
      subcategory_id: subcategoryIds['Gummies'],
      category_id: categoryIds['Edibles'],
      variations: [],
    },
    // Edibles > Chocolates
    {
      name: 'Dark Chocolate Bar 150mg',
      base_price: 14.99,
      unit: 'pcs',
      description: 'Rich dark chocolate bar divided into 15 squares, each containing 10mg. Smooth and discreet.',
      subcategory_id: subcategoryIds['Chocolates'],
      category_id: categoryIds['Edibles'],
      variations: [],
    },
    // Accessories > Rolling Papers & Tips
    {
      name: 'RAW King Size Papers (32 pack)',
      base_price: 2.50,
      unit: 'pcs',
      description: 'Classic RAW unrefined king size slim rolling papers. 32 leaves per pack.',
      subcategory_id: subcategoryIds['Rolling Papers & Tips'],
      category_id: categoryIds['Accessories'],
      variations: [],
    },
    {
      name: 'Grinder - 4 Piece Metal',
      base_price: 8.99,
      unit: 'pcs',
      description: 'Durable 4-piece metal herb grinder with pollen catcher. Sharp diamond teeth.',
      subcategory_id: subcategoryIds['Rolling Papers & Tips'],
      category_id: categoryIds['Accessories'],
      variations: [
        { name: 'Small', price_modifier: 0 },
        { name: 'Large', price_modifier: 6 },
      ],
    },
  ];

  const productIds = {};
  for (const prod of productDefs) {
    const result = await productsCol.findOneAndUpdate(
      { name: prod.name, bot_ids: demoBotId },
      {
        $set: {
          name: prod.name,
          base_price: prod.base_price,
          currency: 'GBP',
          description: prod.description,
          image_url: '',
          subcategory_id: prod.subcategory_id,
          category_id: prod.category_id,
          bot_ids: [demoBotId],
          unit: prod.unit,
          variations: prod.variations,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    productIds[prod.name] = result._id.toString();
    console.log(`Product "${prod.name}" ready: ${productIds[prod.name]}`);
  }

  // ── 6. Discount Codes ───────────────────────────────────────────────
  const discountsCol = db.collection('discounts');
  const now = new Date();
  const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  const discountDefs = [
    {
      code: 'DEMO10',
      description: '10% off demo orders',
      discount_type: 'percentage',
      discount_value: 10,
      bot_ids: [demoBotId],
      active: true,
      min_order_amount: 0,
      usage_limit: 999,
      used_count: 0,
      valid_from: now,
      valid_until: oneYearFromNow,
      created_at: now,
    },
    {
      code: 'WELCOME5',
      description: '£5 off orders over £20',
      discount_type: 'fixed',
      discount_value: 5,
      bot_ids: [demoBotId],
      active: true,
      min_order_amount: 20,
      usage_limit: 999,
      used_count: 0,
      valid_from: now,
      valid_until: oneYearFromNow,
      created_at: now,
    },
  ];

  for (const disc of discountDefs) {
    await discountsCol.findOneAndUpdate(
      { code: disc.code },
      { $set: disc },
      { upsert: true }
    );
    console.log(`Discount "${disc.code}" ready`);
  }

  // ── 7. Mock Orders ──────────────────────────────────────────────────
  const ordersCol = db.collection('orders');
  const dayMs = 24 * 60 * 60 * 1000;

  const orderDefs = [
    {
      _id: `demo-order-001`,
      botId: demoBotId,
      productId: productIds['Amnesia Haze'],
      userId: 'demo-user-101',
      paymentStatus: 'completed',
      amount: 55.00,
      commission: 2.75,
      currency: 'GBP',
      quantity: 1,
      variation_index: 1,
      items: [{ product_id: productIds['Amnesia Haze'], variation_index: 1, quantity: 1, price: 55.00 }],
      items_snapshot: [{ name: 'Amnesia Haze (7g)', quantity: 1, price: 55.00 }],
      timestamp: new Date(now.getTime() - 6 * dayMs),
      paid_at: new Date(now.getTime() - 6 * dayMs + 600000),
      confirmed_at: new Date(now.getTime() - 6 * dayMs + 1200000),
      shipped_at: new Date(now.getTime() - 5 * dayMs),
      completed_at: new Date(now.getTime() - 4 * dayMs),
      source: 'telegram',
      status_history: [
        { from_status: null, to_status: 'pending', changed_by: 'system', changed_at: new Date(now.getTime() - 6 * dayMs) },
        { from_status: 'pending', to_status: 'paid', changed_by: 'system', changed_at: new Date(now.getTime() - 6 * dayMs + 600000) },
        { from_status: 'paid', to_status: 'confirmed', changed_by: 'vendor', changed_at: new Date(now.getTime() - 6 * dayMs + 1200000) },
        { from_status: 'confirmed', to_status: 'shipped', changed_by: 'vendor', changed_at: new Date(now.getTime() - 5 * dayMs) },
        { from_status: 'shipped', to_status: 'completed', changed_by: 'system', changed_at: new Date(now.getTime() - 4 * dayMs) },
      ],
    },
    {
      _id: `demo-order-002`,
      botId: demoBotId,
      productId: productIds['Sour Gummy Bears 100mg'],
      userId: 'demo-user-102',
      paymentStatus: 'shipped',
      amount: 25.98,
      commission: 1.30,
      currency: 'GBP',
      quantity: 2,
      items: [{ product_id: productIds['Sour Gummy Bears 100mg'], quantity: 2, price: 25.98 }],
      items_snapshot: [{ name: 'Sour Gummy Bears 100mg', quantity: 2, price: 25.98 }],
      timestamp: new Date(now.getTime() - 4 * dayMs),
      paid_at: new Date(now.getTime() - 4 * dayMs + 300000),
      confirmed_at: new Date(now.getTime() - 4 * dayMs + 900000),
      shipped_at: new Date(now.getTime() - 3 * dayMs),
      source: 'telegram',
      status_history: [
        { from_status: null, to_status: 'pending', changed_by: 'system', changed_at: new Date(now.getTime() - 4 * dayMs) },
        { from_status: 'pending', to_status: 'paid', changed_by: 'system', changed_at: new Date(now.getTime() - 4 * dayMs + 300000) },
        { from_status: 'paid', to_status: 'confirmed', changed_by: 'vendor', changed_at: new Date(now.getTime() - 4 * dayMs + 900000) },
        { from_status: 'confirmed', to_status: 'shipped', changed_by: 'vendor', changed_at: new Date(now.getTime() - 3 * dayMs) },
      ],
    },
    {
      _id: `demo-order-003`,
      botId: demoBotId,
      productId: productIds['Gorilla Glue'],
      userId: 'demo-user-103',
      paymentStatus: 'confirmed',
      amount: 65.00,
      commission: 3.25,
      currency: 'GBP',
      quantity: 1,
      variation_index: 1,
      items: [{ product_id: productIds['Gorilla Glue'], variation_index: 1, quantity: 1, price: 65.00 }],
      items_snapshot: [{ name: 'Gorilla Glue (7g)', quantity: 1, price: 65.00 }],
      timestamp: new Date(now.getTime() - 2 * dayMs),
      paid_at: new Date(now.getTime() - 2 * dayMs + 450000),
      confirmed_at: new Date(now.getTime() - 2 * dayMs + 1800000),
      source: 'telegram',
      status_history: [
        { from_status: null, to_status: 'pending', changed_by: 'system', changed_at: new Date(now.getTime() - 2 * dayMs) },
        { from_status: 'pending', to_status: 'paid', changed_by: 'system', changed_at: new Date(now.getTime() - 2 * dayMs + 450000) },
        { from_status: 'paid', to_status: 'confirmed', changed_by: 'vendor', changed_at: new Date(now.getTime() - 2 * dayMs + 1800000) },
      ],
    },
    {
      _id: `demo-order-004`,
      botId: demoBotId,
      productId: productIds['Dark Chocolate Bar 150mg'],
      userId: 'demo-user-104',
      paymentStatus: 'paid',
      amount: 14.99,
      commission: 0.75,
      currency: 'GBP',
      quantity: 1,
      items: [{ product_id: productIds['Dark Chocolate Bar 150mg'], quantity: 1, price: 14.99 }],
      items_snapshot: [{ name: 'Dark Chocolate Bar 150mg', quantity: 1, price: 14.99 }],
      timestamp: new Date(now.getTime() - 1 * dayMs),
      paid_at: new Date(now.getTime() - 1 * dayMs + 200000),
      source: 'telegram',
      status_history: [
        { from_status: null, to_status: 'pending', changed_by: 'system', changed_at: new Date(now.getTime() - 1 * dayMs) },
        { from_status: 'pending', to_status: 'paid', changed_by: 'system', changed_at: new Date(now.getTime() - 1 * dayMs + 200000) },
      ],
    },
    {
      _id: `demo-order-005`,
      botId: demoBotId,
      productId: productIds['Grinder - 4 Piece Metal'],
      userId: 'demo-user-105',
      paymentStatus: 'pending',
      amount: 14.99,
      commission: 0.75,
      currency: 'GBP',
      quantity: 1,
      variation_index: 1,
      items: [{ product_id: productIds['Grinder - 4 Piece Metal'], variation_index: 1, quantity: 1, price: 14.99 }],
      items_snapshot: [{ name: 'Grinder - 4 Piece Metal (Large)', quantity: 1, price: 14.99 }],
      timestamp: new Date(now.getTime() - 3600000),
      source: 'telegram',
      status_history: [
        { from_status: null, to_status: 'pending', changed_by: 'system', changed_at: new Date(now.getTime() - 3600000) },
      ],
    },
  ];

  for (const order of orderDefs) {
    await ordersCol.findOneAndUpdate(
      { _id: order._id },
      { $set: order },
      { upsert: true }
    );
    console.log(`Order "${order._id}" ready (${order.paymentStatus})`);
  }

  // ── Done ────────────────────────────────────────────────────────────
  console.log('\n✅ Demo data seeded successfully!');
  console.log(`   Admin: demo / demo123`);
  console.log(`   Bot ID: ${demoBotId}`);
  console.log(`   Categories: ${Object.keys(categoryIds).length}`);
  console.log(`   Subcategories: ${Object.keys(subcategoryIds).length}`);
  console.log(`   Products: ${Object.keys(productIds).length}`);
  console.log(`   Discounts: ${discountDefs.length}`);
  console.log(`   Orders: ${orderDefs.length}`);

  await mongoose.disconnect();
}

seed().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
