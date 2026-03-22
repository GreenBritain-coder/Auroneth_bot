'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';

interface Product {
  _id: string;
  name: string;
  price: number;
  currency: string;
  image_url: string;
  unit: string;
  variations: Array<{ name: string; price_modifier: number; stock?: number }>;
}

interface Category {
  _id: string;
  name: string;
  subcategories: Array<{ _id: string; name: string }>;
}

interface ShopConfig {
  name: string;
  slug: string;
  description: string;
  banner_url: string | null;
  categories_count: number;
  products_count: number;
}

export default function ShopPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [shop, setShop] = useState<ShopConfig | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [addingToCart, setAddingToCart] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    fetchShop();
    fetchCategories();
    fetchProducts();
  }, [slug]);

  useEffect(() => {
    setNextCursor(null);
    fetchProducts();
  }, [selectedCategory, selectedSubcategory]);

  const fetchShop = async () => {
    try {
      const res = await fetch(`/api/shop/${slug}`);
      if (res.ok) {
        const data = await res.json();
        setShop(data.shop);
      }
    } catch (err) {
      console.error('Error fetching shop:', err);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await fetch(`/api/shop/${slug}/categories`);
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories);
      }
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  };

  const fetchProducts = async (cursor?: string) => {
    if (cursor) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }

    try {
      const searchParams = new URLSearchParams();
      if (selectedSubcategory) searchParams.set('subcategory', selectedSubcategory);
      else if (selectedCategory) searchParams.set('category', selectedCategory);
      if (cursor) searchParams.set('cursor', cursor);

      const res = await fetch(`/api/shop/${slug}/products?${searchParams}`);
      if (res.ok) {
        const data = await res.json();
        if (cursor) {
          setProducts((prev) => [...prev, ...data.products]);
        } else {
          setProducts(data.products);
        }
        setNextCursor(data.next_cursor);
      }
    } catch (err) {
      console.error('Error fetching products:', err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const addToCart = async (productId: string) => {
    setAddingToCart(productId);
    try {
      const res = await fetch(`/api/shop/${slug}/cart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, quantity: 1 }),
      });
      if (res.ok) {
        setToast('Added to cart');
        setTimeout(() => setToast(null), 2000);
        window.dispatchEvent(new Event('cart-updated'));
      }
    } catch (err) {
      console.error('Error adding to cart:', err);
    } finally {
      setAddingToCart(null);
    }
  };

  const handleCategoryClick = (categoryId: string) => {
    if (selectedCategory === categoryId) {
      setSelectedCategory(null);
      setSelectedSubcategory(null);
    } else {
      setSelectedCategory(categoryId);
      setSelectedSubcategory(null);
    }
  };

  const handleSubcategoryClick = (subcategoryId: string) => {
    if (selectedSubcategory === subcategoryId) {
      setSelectedSubcategory(null);
    } else {
      setSelectedSubcategory(subcategoryId);
    }
  };

  return (
    <div>
      {/* Hero Section */}
      <div className="relative bg-gray-800 border-b border-gray-700">
        {shop?.banner_url && (
          <div className="absolute inset-0 overflow-hidden">
            <img src={shop.banner_url} alt="" className="w-full h-full object-cover opacity-20" />
          </div>
        )}
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h1 className="text-4xl font-bold text-white mb-3">
            {shop?.name || 'Loading...'}
          </h1>
          <p className="text-lg text-gray-300 max-w-2xl">
            {shop?.description || 'Browse our selection of products.'}
          </p>
          {shop && (
            <div className="flex items-center gap-6 mt-6 text-sm text-gray-400">
              <span>{shop.products_count} Products</span>
              <span>{shop.categories_count} Categories</span>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Category Sidebar */}
          {categories.length > 0 && (
            <aside className="lg:w-64 flex-shrink-0">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Categories</h3>
              <nav className="space-y-1">
                <button
                  onClick={() => { setSelectedCategory(null); setSelectedSubcategory(null); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    !selectedCategory
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`}
                >
                  All Products
                </button>
                {categories.map((cat) => (
                  <div key={cat._id}>
                    <button
                      onClick={() => handleCategoryClick(cat._id)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                        selectedCategory === cat._id && !selectedSubcategory
                          ? 'bg-blue-600 text-white'
                          : selectedCategory === cat._id
                          ? 'bg-gray-800 text-white'
                          : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                      }`}
                    >
                      {cat.name}
                    </button>
                    {selectedCategory === cat._id && cat.subcategories.length > 0 && (
                      <div className="ml-3 mt-1 space-y-1">
                        {cat.subcategories.map((sub) => (
                          <button
                            key={sub._id}
                            onClick={() => handleSubcategoryClick(sub._id)}
                            className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors ${
                              selectedSubcategory === sub._id
                                ? 'bg-blue-500/30 text-blue-300'
                                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-300'
                            }`}
                          >
                            {sub.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </nav>
            </aside>
          )}

          {/* Product Grid */}
          <div className="flex-1">
            {loading ? (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400"></div>
                <p className="mt-4 text-gray-400">Loading products...</p>
              </div>
            ) : products.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-400">No products found in this category.</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {products.map((product) => (
                    <div
                      key={product._id}
                      className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden hover:border-gray-600 transition-colors group"
                    >
                      <Link href={`/shop/${slug}/product/${product._id}`}>
                        <div className="aspect-square bg-gray-700 relative overflow-hidden">
                          {product.image_url ? (
                            <img
                              src={product.image_url}
                              alt={product.name}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-500">
                              <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </div>
                          )}
                        </div>
                      </Link>
                      <div className="p-4">
                        <Link href={`/shop/${slug}/product/${product._id}`}>
                          <h3 className="font-semibold text-white group-hover:text-blue-400 transition-colors truncate">
                            {product.name}
                          </h3>
                        </Link>
                        <div className="flex items-center justify-between mt-3">
                          <span className="text-lg font-bold text-blue-400">
                            {product.currency === 'GBP' ? '\u00a3' : '$'}{product.price.toFixed(2)}
                          </span>
                          <span className="text-xs text-gray-400">per {product.unit}</span>
                        </div>
                        <button
                          onClick={() => addToCart(product._id)}
                          disabled={addingToCart === product._id}
                          className="w-full mt-3 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {addingToCart === product._id ? 'Adding...' : 'Add to Cart'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {nextCursor && (
                  <div className="text-center mt-8">
                    <button
                      onClick={() => fetchProducts(nextCursor)}
                      disabled={loadingMore}
                      className="px-6 py-3 bg-gray-800 border border-gray-700 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
                    >
                      {loadingMore ? 'Loading...' : 'Load More'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-green-600 text-white px-4 py-3 rounded-lg shadow-lg animate-fade-in z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
