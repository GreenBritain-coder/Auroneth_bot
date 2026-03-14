'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Discount {
  _id: string;
  code: string;
  description?: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  bot_ids: string[];
  min_order_amount?: number;
  max_discount_amount?: number;
  usage_limit?: number;
  used_count: number;
  valid_from: Date;
  valid_until: Date;
  active: boolean;
  created_at: Date;
}

export default function DiscountsPage() {
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchDiscounts();
  }, []);

  const fetchDiscounts = async () => {
    try {
      const response = await fetch('/api/discounts');
      if (response.ok) {
        const data = await response.json();
        setDiscounts(data);
      } else {
        setError('Failed to fetch discounts');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (discountId: string) => {
    if (!confirm('Are you sure you want to delete this discount code?')) {
      return;
    }

    try {
      const response = await fetch(`/api/discounts/${discountId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchDiscounts();
      } else {
        alert('Failed to delete discount');
      }
    } catch (err) {
      alert('Network error');
    }
  };

  const handleToggleActive = async (discount: Discount) => {
    try {
      const response = await fetch(`/api/discounts/${discount._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...discount,
          active: !discount.active,
        }),
      });

      if (response.ok) {
        fetchDiscounts();
      } else {
        alert('Failed to update discount');
      }
    } catch (err) {
      alert('Network error');
    }
  };

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const isExpired = (validUntil: string | Date) => {
    return new Date(validUntil) < new Date();
  };

  const isActive = (discount: Discount) => {
    const now = new Date();
    return (
      discount.active &&
      new Date(discount.valid_from) <= now &&
      new Date(discount.valid_until) >= now &&
      (discount.usage_limit === undefined || discount.used_count < discount.usage_limit)
    );
  };

  if (loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Discount Codes</h1>
        <Link
          href="/admin/discounts/new"
          className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700"
        >
          Create Discount Code
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {discounts.map((discount) => (
            <li key={discount._id}>
              <div className="px-4 py-4 sm:px-6">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center">
                      <h3 className="text-lg font-medium text-gray-900">
                        {discount.code}
                      </h3>
                      <span
                        className={`ml-2 px-2 py-1 text-xs rounded-full ${
                          isActive(discount)
                            ? 'bg-green-100 text-green-800'
                            : isExpired(discount.valid_until)
                            ? 'bg-red-100 text-red-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {isActive(discount)
                          ? 'Active'
                          : isExpired(discount.valid_until)
                          ? 'Expired'
                          : 'Inactive'}
                      </span>
                    </div>
                    {discount.description && (
                      <p className="mt-1 text-sm text-gray-500">
                        {discount.description}
                      </p>
                    )}
                    <div className="mt-2 text-sm text-gray-700 space-y-1">
                      <div>
                        <span className="font-medium">Discount:</span>{' '}
                        {discount.discount_type === 'percentage'
                          ? `${discount.discount_value}%`
                          : `£${discount.discount_value.toFixed(2)}`}
                        {discount.max_discount_amount &&
                          discount.discount_type === 'percentage' && (
                            <span className="text-gray-500">
                              {' '}
                              (max £{discount.max_discount_amount.toFixed(2)})
                            </span>
                          )}
                      </div>
                      <div>
                        <span className="font-medium">Valid:</span>{' '}
                        {formatDate(discount.valid_from)} -{' '}
                        {formatDate(discount.valid_until)}
                      </div>
                      <div>
                        <span className="font-medium">Usage:</span>{' '}
                        {discount.used_count}
                        {discount.usage_limit
                          ? ` / ${discount.usage_limit}`
                          : ' / ∞'}
                      </div>
                      {discount.min_order_amount && (
                        <div>
                          <span className="font-medium">Min Order:</span> £
                          {discount.min_order_amount.toFixed(2)}
                        </div>
                      )}
                      <div>
                        <span className="font-medium">Bots:</span>{' '}
                        {discount.bot_ids.length === 0
                          ? 'All bots'
                          : `${discount.bot_ids.length} bot(s)`}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col space-y-2 ml-4">
                    <Link
                      href={`/admin/discounts/${discount._id}`}
                      className="text-indigo-600 hover:text-indigo-900 text-sm font-medium"
                    >
                      Edit
                    </Link>
                    <button
                      onClick={() => handleToggleActive(discount)}
                      className={`text-sm font-medium ${
                        discount.active
                          ? 'text-yellow-600 hover:text-yellow-900'
                          : 'text-green-600 hover:text-green-900'
                      }`}
                    >
                      {discount.active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      onClick={() => handleDelete(discount._id)}
                      className="text-red-600 hover:text-red-900 text-sm font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {discounts.length === 0 && !loading && (
        <div className="text-center py-8 text-gray-500">
          No discount codes found. Create your first discount code!
        </div>
      )}
    </div>
  );
}

