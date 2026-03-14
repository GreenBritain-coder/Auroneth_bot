import mongoose, { Schema, Document } from 'mongoose';

// Bot Model
export interface IBot extends Document {
  _id: string;
  token: string;
  name: string;
  description?: string;
  main_buttons: string[];
  inline_buttons: Record<string, Array<{ text: string; action: string }>>;
  menu_inline_buttons?: Array<Array<{ text: string; action: string; url?: string }>>; // Menu inline buttons (2D array for layout)
  messages: Record<string, string>;
  inline_action_messages?: Record<string, string>; // Custom messages for inline button actions
  products: string[];
  status: 'live' | 'offline';
  owner?: string;
  public_listing: boolean;
  profile_picture_url?: string;
  categories?: string[]; // Category emojis (e.g., ["🍃", "💊"])
  featured?: boolean; // Featured status (super-admin only)
  telegram_username?: string; // Telegram bot username (e.g., "mybot" for @mybot, without @)
  routes?: string; // Shipping routes (e.g., "United Kingdom 🇬🇧 ➤ Europe 🇪🇺")
  language?: string; // Language (e.g., "British English")
  website_url?: string; // Official website URL
  instagram_url?: string; // Instagram URL
  telegram_channel?: string; // Telegram channel (without @)
  telegram_group?: string; // Telegram group (without @)
  rating?: string; // Rating percentage (e.g., "96.81")
  rating_count?: string; // Number of ratings (e.g., "7707")
  vendor_pgp_key?: string; // Vendor's public PGP key
  webhook_url?: string; // Webhook URL for payment callbacks (e.g., "https://your-domain.com" or "http://localhost:8000")
  payment_methods?: string[]; // Supported payment methods (e.g., ["BTC", "LTC"])
  cut_off_time?: string; // Cut-off time in HH:MM format (e.g., "14:30")
}

const BotSchema = new Schema<IBot>({
  token: { type: String, required: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  main_buttons: { type: [String], default: [] },
  inline_buttons: { type: Schema.Types.Mixed, default: {} },
  menu_inline_buttons: { type: Schema.Types.Mixed, default: [] }, // Array of button rows
  messages: { type: Schema.Types.Mixed, default: {} },
  inline_action_messages: { type: Schema.Types.Mixed, default: {} },
  products: { type: [String], default: [] },
  status: { type: String, enum: ['live', 'offline'], default: 'live' },
  owner: { type: String },
  public_listing: { type: Boolean, default: true },
  profile_picture_url: { type: String, default: '' },
  categories: { type: [String], default: [] },
  featured: { type: Boolean, default: false },
  telegram_username: { type: String }, // Telegram bot username (without @)
  routes: { type: String }, // Shipping routes
  language: { type: String }, // Language
  website_url: { type: String }, // Official website URL
  instagram_url: { type: String }, // Instagram URL
  telegram_channel: { type: String }, // Telegram channel (without @)
  telegram_group: { type: String }, // Telegram group (without @)
  rating: { type: String }, // Rating percentage
  rating_count: { type: String }, // Number of ratings
  vendor_pgp_key: { type: String }, // Vendor's public PGP key
  webhook_url: { type: String }, // Webhook URL for payment callbacks
  payment_methods: { type: [String], default: ['BTC', 'LTC'] }, // Supported payment methods (BTC/LTC only)
  cut_off_time: { type: String }, // Cut-off time in HH:MM format (e.g., "14:30")
}, { strict: false }); // Allow additional fields beyond schema

// Delete existing model if it exists to force schema refresh
if (mongoose.models.Bot) {
  delete mongoose.models.Bot;
}
export const Bot = mongoose.model<IBot>('Bot', BotSchema);

// Category Model
export interface ICategory extends Document {
  _id: string;
  name: string;
  description?: string;
  bot_ids: string[];
  order: number;
}

const CategorySchema = new Schema<ICategory>({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  bot_ids: { type: [String], default: [] },
  order: { type: Number, default: 0 },
});

export const Category = mongoose.models.Category || mongoose.model<ICategory>('Category', CategorySchema);

// Subcategory Model
export interface ISubcategory extends Document {
  _id: string;
  name: string;
  description?: string;
  category_id: string;
  bot_ids: string[];
  order: number;
}

const SubcategorySchema = new Schema<ISubcategory>({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  category_id: { type: String, required: true },
  bot_ids: { type: [String], default: [] },
  order: { type: Number, default: 0 },
});

export const Subcategory = mongoose.models.Subcategory || mongoose.model<ISubcategory>('Subcategory', SubcategorySchema);

// Product Model
export interface IProduct extends Document {
  _id: string;
  name: string;
  base_price: number;
  price?: number; // Legacy field for backward compatibility
  currency: string;
  description: string;
  image_url?: string;
  subcategory_id: string;
  bot_ids: string[];
  unit?: string; // Unit of measurement: "pcs" (pieces), "gr" (grams), "kg" (kilograms), "ml" (milliliters)
  increment_amount?: number; // Amount to increment/decrement (defaults to price-based calculation)
  variations?: Array<{
    name: string;
    price_modifier: number; // Added to base_price
    stock?: number;
  }>;
}

const ProductSchema = new Schema<IProduct>({
  name: { type: String, required: true },
  base_price: { type: Number },
  price: { type: Number }, // Legacy field for backward compatibility
  currency: { type: String, required: true },
  description: { type: String, required: true },
  image_url: { type: String, default: '' },
  subcategory_id: { type: String, default: '' }, // Not required for backward compatibility
  bot_ids: { type: [String], default: [] },
  unit: { type: String, default: 'pcs' }, // Default to "pcs" for pieces
  increment_amount: { type: Number }, // Optional, defaults to price-based calculation
  variations: { type: [Schema.Types.Mixed], default: [] },
});

// Pre-save hook to migrate old 'price' to 'base_price'
ProductSchema.pre('save', function(next) {
  if (!this.base_price && this.price) {
    this.base_price = this.price;
  }
  if (!this.base_price) {
    this.base_price = 0;
  }
  next();
});

export const Product = mongoose.models.Product || mongoose.model<IProduct>('Product', ProductSchema);

// Cart Model
export interface ICart extends Document {
  _id: string;
  user_id: string;
  bot_id: string;
  items: Array<{
    product_id: string;
    variation_index?: number;
    quantity: number;
    price: number;
  }>;
  updated_at: Date;
}

const CartSchema = new Schema<ICart>({
  user_id: { type: String, required: true },
  bot_id: { type: String, required: true },
  items: { type: [Schema.Types.Mixed] as any, default: [] },
  updated_at: { type: Date, default: Date.now },
});

export const Cart = mongoose.models.Cart || mongoose.model<ICart>('Cart', CartSchema);

// Order Model
export interface IOrder extends Document {
  _id: string;
  botId: string;
  productId: string;
  userId: string;
  invoiceId?: string;
  paymentStatus: 'pending' | 'paid' | 'failed';
  amount: number;
  commission: number;
  currency?: string; // Payment currency (BTC, LTC, etc.) - optional for backward compatibility
  timestamp: Date;
  encrypted_address?: string; // Encrypted shipping/delivery address
  quantity?: number;
  variation_index?: number;
}

const OrderSchema = new Schema<IOrder>({
  _id: { type: String }, // Allow string IDs (UUIDs from Python bot)
  botId: { type: String, required: true },
  productId: { type: String, required: true },
  userId: { type: String, required: true },
  invoiceId: { type: String },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
  amount: { type: Number, required: true },
  commission: { type: Number, required: true },
  currency: { type: String }, // Payment currency (BTC, LTC, etc.) - optional for backward compatibility
  timestamp: { type: Date, default: Date.now },
  encrypted_address: { type: String }, // Encrypted address field
  quantity: { type: Number },
  variation_index: { type: Number },
}, {
  _id: true, // Keep _id but allow custom string values
});

export const Order = mongoose.models.Order || mongoose.model<IOrder>('Order', OrderSchema);

// Commission Model
export interface ICommission extends Document {
  _id: string;
  botId: string;
  orderId: string;
  amount: number;
  timestamp: Date;
}

const CommissionSchema = new Schema<ICommission>({
  botId: { type: String, required: true },
  orderId: { type: String, required: true },
  amount: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now },
});

export const Commission = mongoose.models.Commission || mongoose.model<ICommission>('Commission', CommissionSchema);

// Deposit address tracking (HD-style: one address per order, auditable)
export interface IAddress extends Document {
  _id: string;
  currency: string;
  address: string;
  orderId?: string; // Set when assigned to an order
  status: 'available' | 'assigned' | 'used';
  provider?: string; // cryptapi, shkeeper, blockonomics, coinpayments
  createdAt: Date;
}

const AddressSchema = new Schema<IAddress>({
  currency: { type: String, required: true },
  address: { type: String, required: true },
  orderId: { type: String },
  status: { type: String, enum: ['available', 'assigned', 'used'], default: 'assigned' },
  provider: { type: String },
  createdAt: { type: Date, default: Date.now },
});

// Unique index: one address per order; index for lookups by currency/status
AddressSchema.index({ address: 1 }, { unique: true });
AddressSchema.index({ orderId: 1 });
AddressSchema.index({ currency: 1, status: 1 });

export const Address = mongoose.models.Address || mongoose.model<IAddress>('Address', AddressSchema);

// Commission Payout Request Model
export interface ICommissionPayout extends Document {
  _id: string;
  userId: string; // Bot owner/admin requesting payout
  amount: number;
  currency: string; // Currency code (BTC, LTC, etc.)
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  walletAddress?: string; // Wallet address for payout
  requestedAt: Date;
  processedAt?: Date;
  processedBy?: string; // Admin who processed it
  notes?: string;
}

const CommissionPayoutSchema = new Schema<ICommissionPayout>({
  userId: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'BTC' }, // Default to BTC for backward compatibility
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'paid'], default: 'pending' },
  walletAddress: { type: String },
  requestedAt: { type: Date, default: Date.now },
  processedAt: { type: Date },
  processedBy: { type: String },
  notes: { type: String },
});

export const CommissionPayout = mongoose.models.CommissionPayout || mongoose.model<ICommissionPayout>('CommissionPayout', CommissionPayoutSchema);

// Commission Payment Model (tracks when commissions are marked as paid/collected)
export interface ICommissionPayment extends Document {
  _id: string;
  botId: string; // Bot that commission was collected from
  amount: number;
  currency: string; // Currency code (BTC, LTC, etc.)
  paidAt: Date;
  paidBy: string; // Admin who marked it as paid
  notes?: string;
  orderIds?: string[]; // Optional: specific order IDs this payment covers
}

const CommissionPaymentSchema = new Schema<ICommissionPayment>({
  botId: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'BTC' },
  paidAt: { type: Date, default: Date.now },
  paidBy: { type: String, required: true },
  notes: { type: String },
  orderIds: { type: [String], default: [] },
});

export const CommissionPayment = mongoose.models.CommissionPayment || mongoose.model<ICommissionPayment>('CommissionPayment', CommissionPaymentSchema);

// User Model (Secret Phrase)
export interface IUser extends Document {
  _id: string;
  secret_phrase: string;
  first_bot_id: string;
  created_at: Date;
  verification_completed?: boolean; // Track if user completed verification flow
  last_seen?: Date; // Last seen timestamp
}

const UserSchema = new Schema<IUser>({
  _id: { type: String, required: true },
  secret_phrase: { type: String, required: true },
  first_bot_id: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
  verification_completed: { type: Boolean, default: false },
  last_seen: { type: Date },
});

export const User = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);

// Contact Message Model
export interface IContactMessage extends Document {
  _id: string;
  botId: string;
  userId: string;
  message: string;
  timestamp: Date;
  read: boolean;
}

const ContactMessageSchema = new Schema<IContactMessage>({
  _id: { type: String }, // Allow string IDs
  botId: { type: String, required: true },
  userId: { type: String, required: true },
  message: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  read: { type: Boolean, default: false },
}, {
  _id: true, // Keep _id but allow custom string values
  collection: 'contact_messages', // Explicitly set collection name to match Python
});

export const ContactMessage = mongoose.models.ContactMessage || mongoose.model<IContactMessage>('ContactMessage', ContactMessageSchema);

// Admin Model
export interface IAdmin extends Document {
  _id: string;
  username: string;
  password_hash: string;
  role: 'super-admin' | 'bot-owner';
  created_at: Date;
}

const AdminSchema = new Schema<IAdmin>({
  username: { type: String, required: true, unique: true },
  password_hash: { type: String, required: true },
  role: { type: String, enum: ['super-admin', 'bot-owner'], default: 'bot-owner' },
  created_at: { type: Date, default: Date.now },
});

export const Admin = mongoose.models.Admin || mongoose.model<IAdmin>('Admin', AdminSchema);

// Discount Code Model
export interface IDiscount extends Document {
  _id: string;
  code: string; // Discount code (e.g., "SAVE10")
  description?: string;
  discount_type: 'percentage' | 'fixed'; // Percentage or fixed amount
  discount_value: number; // Percentage (0-100) or fixed amount
  bot_ids: string[]; // Which bots can use this discount
  min_order_amount?: number; // Minimum order amount to use this discount
  max_discount_amount?: number; // Maximum discount amount (for percentage discounts)
  usage_limit?: number; // Maximum number of times this code can be used
  used_count: number; // How many times it's been used
  valid_from: Date; // When the discount becomes valid
  valid_until: Date; // When the discount expires
  active: boolean; // Whether the discount is currently active
  created_at: Date;
  created_by?: string; // Admin user who created it
}

const DiscountSchema = new Schema<IDiscount>({
  code: { type: String, required: true, unique: true, uppercase: true },
  description: { type: String, default: '' },
  discount_type: { type: String, enum: ['percentage', 'fixed'], required: true },
  discount_value: { type: Number, required: true },
  bot_ids: { type: [String], default: [] },
  min_order_amount: { type: Number },
  max_discount_amount: { type: Number },
  usage_limit: { type: Number },
  used_count: { type: Number, default: 0 },
  valid_from: { type: Date, default: Date.now },
  valid_until: { type: Date, required: true },
  active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
  created_by: { type: String },
});

export const Discount = mongoose.models.Discount || mongoose.model<IDiscount>('Discount', DiscountSchema);
