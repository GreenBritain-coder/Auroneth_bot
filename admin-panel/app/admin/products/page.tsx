'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Product {
  _id: string;
  name: string;
  price: number;
  base_price?: number;
  currency: string;
  description: string;
  image_url?: string;
  bot_ids: string[];
  unit?: string;
  variations?: Array<{ name: string; price_modifier: number; stock?: number }>;
  category_id?: string;
  subcategory_id?: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: '£', USD: '$', EUR: '€', BTC: '₿', LTC: 'Ł', USDT: '$', ETH: 'Ξ',
};

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [currencyFilter, setCurrencyFilter] = useState('all');

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      const response = await fetch('/api/products');
      if (response.ok) {
        const data = await response.json();
        setProducts(data);
      } else {
        setError('Failed to fetch products');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (productId: string) => {
    if (!confirm('Are you sure you want to delete this product?')) return;
    try {
      const response = await fetch(`/api/products/${productId}`, { method: 'DELETE' });
      if (response.ok) {
        fetchProducts();
      } else {
        alert('Failed to delete product');
      }
    } catch (err) {
      alert('Network error');
    }
  };

  // Filter products
  const filtered = products.filter((p) => {
    const matchesSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.description.toLowerCase().includes(search.toLowerCase());
    const matchesCurrency = currencyFilter === 'all' || p.currency === currencyFilter;
    return matchesSearch && matchesCurrency;
  });

  // Get unique currencies for filter
  const currencies = [...new Set(products.map((p) => p.currency))].sort();

  // Stock status helper
  const getStockStatus = (product: Product) => {
    if (!product.variations || product.variations.length === 0) return null;
    const hasStock = product.variations.some((v) => v.stock !== undefined);
    if (!hasStock) return null;
    const totalStock = product.variations.reduce((sum, v) => sum + (v.stock ?? 0), 0);
    if (totalStock === 0) return { label: 'Out of stock', color: 'bg-red-100 text-red-700' };
    if (totalStock <= 5) return { label: `Low stock (${totalStock})`, color: 'bg-yellow-100 text-yellow-700' };
    return { label: `In stock (${totalStock})`, color: 'bg-green-100 text-green-700' };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Products</h1>
          <p className="mt-1 text-sm text-gray-500">
            {filtered.length} {filtered.length === 1 ? 'product' : 'products'}
            {search || currencyFilter !== 'all' ? ` (filtered from ${products.length})` : ''}
          </p>
        </div>
        <Link
          href="/admin/products/new"
          className="inline-flex items-center justify-center bg-indigo-600 text-white px-4 py-2.5 rounded-lg hover:bg-indigo-700 font-medium text-sm shadow-sm"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          Add Product
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">{error}</div>
      )}

      {/* Search & Filters */}
      {products.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="flex-1 relative">
            <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>
            <input
              type="text"
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          {currencies.length > 1 && (
            <select
              value={currencyFilter}
              onChange={(e) => setCurrencyFilter(e.target.value)}
              className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All currencies</option>
              {currencies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Product Grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((product) => {
            const price = product.base_price ?? product.price;
            const symbol = CURRENCY_SYMBOLS[product.currency] || '';
            const stock = getStockStatus(product);
            const varCount = product.variations?.length || 0;

            return (
              <div key={product._id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                {/* Image */}
                <div className="h-48 bg-gray-100 relative">
                  {product.image_url ? (
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                  {/* Currency badge */}
                  <span className="absolute top-2 right-2 bg-white/90 backdrop-blur-sm text-xs font-semibold px-2 py-1 rounded-full shadow-sm text-gray-700">
                    {product.currency}
                  </span>
                </div>

                {/* Content */}
                <div className="p-4">
                  <h3 className="font-semibold text-gray-900 truncate">{product.name}</h3>
                  <p className="mt-1 text-sm text-gray-500 line-clamp-2 min-h-[2.5rem]">{product.description || 'No description'}</p>

                  {/* Price */}
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-lg font-bold text-gray-900">{symbol}{price}</span>
                    {product.unit && product.unit !== 'pcs' && (
                      <span className="text-sm text-gray-400">/ {product.unit}</span>
                    )}
                  </div>

                  {/* Tags row */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {varCount > 0 && (
                      <span className="inline-flex items-center text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                        {varCount} {varCount === 1 ? 'variation' : 'variations'}
                      </span>
                    )}
                    {stock && (
                      <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${stock.color}`}>
                        {stock.label}
                      </span>
                    )}
                    <span className="inline-flex items-center text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {product.bot_ids.length} {product.bot_ids.length === 1 ? 'bot' : 'bots'}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex justify-between">
                  <Link
                    href={`/admin/products/${product._id}`}
                    className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    Edit
                  </Link>
                  <button
                    onClick={() => handleDelete(product._id)}
                    className="text-sm font-medium text-red-500 hover:text-red-700"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-16">
          <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-16 w-16 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900">No products yet</h3>
          <p className="mt-2 text-sm text-gray-500">Get started by adding your first product.</p>
          <Link
            href="/admin/products/new"
            className="mt-4 inline-flex items-center bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 text-sm font-medium"
          >
            Add Product
          </Link>
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500">
          No products match your search.
        </div>
      )}
    </div>
  );
}
