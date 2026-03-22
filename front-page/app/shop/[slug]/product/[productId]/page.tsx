'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface ProductDetail {
  _id: string;
  name: string;
  price: number;
  currency: string;
  description: string;
  image_url: string;
  unit: string;
  variations: Array<{ name: string; price_modifier: number; stock?: number }>;
}

interface Review {
  _id: string;
  rating: number;
  text: string;
  created_at: string;
}

export default function ProductPage() {
  const params = useParams();
  const slug = params.slug as string;
  const productId = params.productId as string;

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [averageRating, setAverageRating] = useState(0);
  const [totalReviews, setTotalReviews] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [addingToCart, setAddingToCart] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [reviewCursor, setReviewCursor] = useState<string | null>(null);
  const [loadingReviews, setLoadingReviews] = useState(false);

  useEffect(() => {
    fetchProduct();
    fetchReviews();
  }, [slug, productId]);

  const fetchProduct = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/shop/${slug}/products?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        const found = data.products.find((p: ProductDetail) => p._id === productId);
        if (found) {
          // Fetch full description from products endpoint
          setProduct(found);
        }
      }
    } catch (err) {
      console.error('Error fetching product:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchReviews = async (cursor?: string) => {
    setLoadingReviews(true);
    try {
      const params = new URLSearchParams();
      if (cursor) params.set('cursor', cursor);
      params.set('t', String(Date.now()));

      const res = await fetch(`/api/shop/${slug}/products/${productId}/reviews?${params}`);
      if (res.ok) {
        const data = await res.json();
        if (cursor) {
          setReviews((prev) => [...prev, ...data.reviews]);
        } else {
          setReviews(data.reviews);
        }
        setAverageRating(data.average_rating);
        setTotalReviews(data.total_reviews);
        setReviewCursor(data.next_cursor);
      }
    } catch (err) {
      console.error('Error fetching reviews:', err);
    } finally {
      setLoadingReviews(false);
    }
  };

  const addToCart = async () => {
    setAddingToCart(true);
    try {
      const res = await fetch(`/api/shop/${slug}/cart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, quantity }),
      });
      if (res.ok) {
        setToast('Added to cart');
        setTimeout(() => setToast(null), 2000);
      }
    } catch (err) {
      console.error('Error adding to cart:', err);
    } finally {
      setAddingToCart(false);
    }
  };

  const totalStock = product?.variations?.reduce((sum, v) => sum + (v.stock ?? 0), 0) ?? 0;
  const hasVariations = product?.variations && product.variations.length > 0;
  const inStock = !hasVariations || totalStock > 0;

  const getStockLabel = () => {
    if (!hasVariations) return { text: 'In Stock', color: 'text-green-400' };
    if (totalStock === 0) return { text: 'Out of Stock', color: 'text-red-400' };
    if (totalStock <= 5) return { text: 'Low Stock', color: 'text-amber-400' };
    return { text: 'In Stock', color: 'text-green-400' };
  };

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <span key={i} className={i < Math.round(rating) ? 'text-amber-400' : 'text-gray-600'}>
        ★
      </span>
    ));
  };

  if (loading) {
    return (
      <div className="text-center py-24">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400"></div>
        <p className="mt-4 text-gray-400">Loading product...</p>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="text-center py-24">
        <h2 className="text-2xl font-bold text-white mb-4">Product Not Found</h2>
        <Link href={`/shop/${slug}`} className="text-blue-400 hover:text-blue-300">
          Back to Shop
        </Link>
      </div>
    );
  }

  const stockLabel = getStockLabel();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href={`/shop/${slug}`} className="hover:text-white transition-colors">Shop</Link>
        <span>/</span>
        <span className="text-white truncate">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        {/* Product Image */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden aspect-square">
          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-500">
              <svg className="w-24 h-24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}
        </div>

        {/* Product Info */}
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">{product.name}</h1>

          {/* Rating Summary */}
          {totalReviews > 0 && (
            <div className="flex items-center gap-2 mb-4">
              <div className="flex">{renderStars(averageRating)}</div>
              <span className="text-gray-400 text-sm">
                {averageRating.toFixed(1)} ({totalReviews} review{totalReviews !== 1 ? 's' : ''})
              </span>
            </div>
          )}

          {/* Price */}
          <div className="text-3xl font-bold text-blue-400 mb-4">
            {product.currency === 'GBP' ? '\u00a3' : '$'}{product.price.toFixed(2)}
            <span className="text-sm text-gray-400 font-normal ml-2">per {product.unit}</span>
          </div>

          {/* Stock Status */}
          <div className={`text-sm font-medium mb-6 ${stockLabel.color}`}>
            {stockLabel.text}
          </div>

          {/* Description */}
          {product.description && (
            <div className="text-gray-300 mb-6 leading-relaxed whitespace-pre-wrap">
              {product.description}
            </div>
          )}

          {/* Variations */}
          {hasVariations && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Options</h3>
              <div className="flex flex-wrap gap-2">
                {product.variations!.map((v, i) => (
                  <span
                    key={i}
                    className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300"
                  >
                    {v.name}
                    {v.price_modifier !== 0 && (
                      <span className="ml-1 text-blue-400">
                        {v.price_modifier > 0 ? '+' : ''}{product.currency === 'GBP' ? '\u00a3' : '$'}{v.price_modifier.toFixed(2)}
                      </span>
                    )}
                    {v.stock !== undefined && (
                      <span className="ml-1 text-gray-500">({v.stock} left)</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Quantity + Add to Cart */}
          <div className="flex items-center gap-4 mb-6">
            <div className="flex items-center border border-gray-700 rounded-lg">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="px-3 py-2 text-gray-400 hover:text-white transition-colors"
              >
                -
              </button>
              <span className="px-4 py-2 text-white font-medium min-w-[3rem] text-center">{quantity}</span>
              <button
                onClick={() => setQuantity(Math.min(10, quantity + 1))}
                className="px-3 py-2 text-gray-400 hover:text-white transition-colors"
              >
                +
              </button>
            </div>
            <button
              onClick={addToCart}
              disabled={addingToCart || !inStock}
              className="flex-1 px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {!inStock ? 'Out of Stock' : addingToCart ? 'Adding...' : 'Add to Cart'}
            </button>
          </div>
        </div>
      </div>

      {/* Reviews Section */}
      <div className="mt-16 border-t border-gray-700 pt-8">
        <h2 className="text-2xl font-bold text-white mb-6">
          Customer Reviews
          {totalReviews > 0 && (
            <span className="text-base font-normal text-gray-400 ml-2">({totalReviews})</span>
          )}
        </h2>

        {reviews.length === 0 && !loadingReviews ? (
          <p className="text-gray-400">No reviews yet.</p>
        ) : (
          <div className="space-y-4">
            {reviews.map((review) => (
              <div key={review._id} className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex">{renderStars(review.rating)}</div>
                  <span className="text-xs text-gray-500">
                    {new Date(review.created_at).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </div>
                {review.text && (
                  <p className="text-gray-300 text-sm">{review.text}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {reviewCursor && (
          <button
            onClick={() => fetchReviews(reviewCursor)}
            disabled={loadingReviews}
            className="mt-4 px-4 py-2 bg-gray-800 border border-gray-700 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors text-sm disabled:opacity-50"
          >
            {loadingReviews ? 'Loading...' : 'Load More Reviews'}
          </button>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-green-600 text-white px-4 py-3 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
