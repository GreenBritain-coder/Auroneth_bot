import mongoose, { Schema, Document } from 'mongoose';

export interface IBot extends Document {
  _id: string;
  name: string;
  description?: string;
  status: 'live' | 'offline';
  public_listing: boolean;
  profile_picture_url?: string;
  categories?: string[];
  featured?: boolean;
  payment_methods?: string[]; // Supported payment methods (e.g., ["BTC", "LTC"])
  cut_off_time?: string; // Cut-off time in HH:MM format (e.g., "14:30")
  web_shop_enabled?: boolean;
  web_shop_slug?: string;
}

const BotSchema = new Schema<IBot>({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  status: { type: String, enum: ['live', 'offline'], default: 'live' },
  public_listing: { type: Boolean, default: true },
  profile_picture_url: { type: String, default: '' },
  categories: { type: [String], default: [] },
  featured: { type: Boolean, default: false },
  payment_methods: { type: [String], default: ['BTC', 'LTC'] }, // Supported payment methods (BTC/LTC only)
  web_shop_enabled: { type: Boolean, default: false },
  web_shop_slug: { type: String, default: '' },
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
  category_id?: string;
  bot_ids: string[];
  unit?: string;
  increment_amount?: number;
  variations?: Array<{
    name: string;
    price_modifier: number;
    stock?: number;
  }>;
}

const ProductSchema = new Schema<IProduct>({
  name: { type: String, required: true },
  base_price: { type: Number },
  price: { type: Number },
  currency: { type: String, required: true },
  description: { type: String, required: true },
  image_url: { type: String, default: '' },
  subcategory_id: { type: String, default: '' },
  category_id: { type: String, default: '' },
  bot_ids: { type: [String], default: [] },
  unit: { type: String, default: 'pcs' },
  increment_amount: { type: Number },
  variations: { type: [Schema.Types.Mixed], default: [] },
});

export const Product = mongoose.models.Product || mongoose.model<IProduct>('Product', ProductSchema);

// Cart Model (web shop server-side carts)
export interface ICartItem {
  product_id: string;
  quantity: number;
  price_snapshot: number;
  added_at: Date;
}

export interface ICart extends Document {
  _id: string;
  bot_id: string;
  session_id: string;
  items: ICartItem[];
  discount_code?: string;
  discount_amount?: number;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
}

const CartItemSchema = new Schema({
  product_id: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1, max: 10 },
  price_snapshot: { type: Number, required: true },
  added_at: { type: Date, default: Date.now },
}, { _id: false });

const CartSchema = new Schema<ICart>({
  bot_id: { type: String, required: true },
  session_id: { type: String, required: true },
  items: { type: [CartItemSchema], default: [] },
  discount_code: { type: String, default: null },
  discount_amount: { type: Number, default: 0 },
  expires_at: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

CartSchema.index({ bot_id: 1, session_id: 1 }, { unique: true });

export const Cart = mongoose.models.Cart || mongoose.model<ICart>('Cart', CartSchema);

// Order Model (web shop orders)
export interface IOrderItemSnapshot {
  product_id: string;
  name: string;
  price: number;
  quantity: number;
  line_total: number;
  image_url?: string;
  unit?: string;
}

export interface IOrder extends Document {
  _id: string;
  botId: string;
  source: 'telegram' | 'web';
  status: string;
  web_session_id?: string;
  order_token?: string;
  address_salt?: string;
  display_amount?: number;
  fiat_amount?: number;
  exchange_rate_gbp_usd?: number;
  exchange_rate_usd_crypto?: number;
  crypto_currency?: string;
  crypto_amount?: number;
  idempotency_key?: string;
  items_snapshot?: IOrderItemSnapshot[];
  rate_locked_at?: Date;
  rate_lock_expires_at?: Date;
  commission?: number;
  commission_rate?: number;
  paymentStatus?: string;
  paymentDetails?: Record<string, unknown>;
  created_at?: Date;
  updated_at?: Date;
}

const OrderSchema = new Schema<IOrder>({
  _id: { type: String },
  botId: { type: String, required: true },
  source: { type: String, enum: ['telegram', 'web'], default: 'telegram' },
  status: { type: String, default: 'pending' },
  web_session_id: { type: String, default: null },
  order_token: { type: String, default: null },
  address_salt: { type: String, default: null },
  display_amount: { type: Number },
  fiat_amount: { type: Number },
  exchange_rate_gbp_usd: { type: Number },
  exchange_rate_usd_crypto: { type: Number },
  crypto_currency: { type: String },
  crypto_amount: { type: Number },
  idempotency_key: { type: String, default: null },
  items_snapshot: { type: [Schema.Types.Mixed], default: [] },
  rate_locked_at: { type: Date },
  rate_lock_expires_at: { type: Date },
  commission: { type: Number, default: 0 },
  commission_rate: { type: Number, default: 0.10 },
}, { strict: false, timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

OrderSchema.index({ order_token: 1 }, { unique: true, sparse: true });
OrderSchema.index({ idempotency_key: 1 }, { unique: true, sparse: true });
OrderSchema.index({ web_session_id: 1, botId: 1 });

export const Order = mongoose.models.Order || mongoose.model<IOrder>('Order', OrderSchema);

