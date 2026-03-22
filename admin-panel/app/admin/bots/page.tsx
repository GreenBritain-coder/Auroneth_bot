'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Bot {
  _id: string;
  name: string;
  description: string;
  status: string;
  public_listing: boolean;
  main_buttons: string[];
  products: string[];
}

export default function BotsPage() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    fetchBots();
    // Get user role from server
    fetch('/api/auth/me')
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(data => setUserRole(data.role || 'bot-owner'))
      .catch(() => setUserRole('bot-owner'));
  }, []);

  const fetchBots = async () => {
    try {
      const response = await fetch('/api/bots?t=' + Date.now());
      if (response.ok) {
        const data = await response.json();
        setBots(data);
      } else {
        setError('Failed to fetch bots');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (botId: string) => {
    if (!confirm('Are you sure you want to delete this bot?')) {
      return;
    }

    try {
      const response = await fetch(`/api/bots/${botId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchBots();
      } else {
        alert('Failed to delete bot');
      }
    } catch (err) {
      alert('Network error');
    }
  };

  const handleToggleStatus = async (botId: string, currentStatus: string) => {
    try {
      const response = await fetch(`/api/bots/${botId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: currentStatus === 'live' ? 'offline' : 'live',
        }),
      });

      if (response.ok) {
        fetchBots();
      } else {
        alert('Failed to update bot status');
      }
    } catch (err) {
      alert('Network error');
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  const isDemo = userRole === 'demo';

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Bot Management</h1>
        {/* Hide "Add New Bot" for demo users. Show for super-admin always, or bot-owner with no bots */}
        {!isDemo && (userRole === 'super-admin' || bots.length === 0) && (
          <Link
            href="/admin/bots/new"
            className="inline-flex items-center bg-indigo-600 text-white px-5 py-2.5 rounded-md hover:bg-indigo-700 font-medium text-sm shadow-sm"
          >
            <svg className="h-5 w-5 mr-1.5 -ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add New Bot
          </Link>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {bots.map((bot) => (
          <div
            key={bot._id}
            className="bg-white rounded-lg shadow hover:shadow-md transition-shadow p-5 flex flex-col"
          >
            {/* Top: name + status */}
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-lg font-semibold text-gray-900 leading-tight">{bot.name}</h3>
              <span
                className={`ml-2 flex-shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  bot.status === 'live'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-800'
                }`}
              >
                {bot.status === 'live' ? 'Live' : 'Offline'}
              </span>
            </div>

            {/* Public badge */}
            {bot.public_listing && (
              <span className="self-start inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 mb-2">
                Public
              </span>
            )}

            {/* Description */}
            <p className="text-sm text-gray-500 line-clamp-2 mb-3 flex-grow">
              {bot.description || 'No description'}
            </p>

            {/* Stats */}
            <div className="text-sm text-gray-500 mb-4">
              <span>{bot.products.length} product{bot.products.length !== 1 ? 's' : ''}</span>
              <span className="mx-2">&middot;</span>
              <span>{bot.main_buttons.length} button{bot.main_buttons.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
              <Link
                href={`/admin/bots/${bot._id}`}
                className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
              >
                Edit
              </Link>
              <button
                onClick={() => handleToggleStatus(bot._id, bot.status)}
                disabled={isDemo}
                className={`inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md ${
                  isDemo
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {bot.status === 'live' ? 'Deactivate' : 'Activate'}
              </button>
              {!isDemo && (
                <button
                  onClick={() => handleDelete(bot._id)}
                  className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md text-red-700 hover:bg-red-50 ml-auto"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {bots.length === 0 && !loading && (
        <div className="text-center py-8 text-gray-500">
          No bots found. Create your first bot!
        </div>
      )}
    </div>
  );
}
