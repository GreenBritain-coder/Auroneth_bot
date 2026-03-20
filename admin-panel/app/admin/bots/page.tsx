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

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Bot Management</h1>
        {/* Only show "Add New Bot" button if user is super-admin or has no bots yet */}
        {(userRole === 'super-admin' || bots.length === 0) && (
          <Link
            href="/admin/bots/new"
            className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700"
          >
            Add New Bot
          </Link>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {bots.map((bot) => (
            <li key={bot._id}>
              <div className="px-4 py-4 sm:px-6 flex justify-between items-center">
                <div className="flex-1">
                  <div className="flex items-center">
                    <h3 className="text-lg font-medium text-gray-900">{bot.name}</h3>
                    <span
                      className={`ml-3 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        bot.status === 'live'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {bot.status}
                    </span>
                    {bot.public_listing && (
                      <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        Public
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-gray-500">{bot.description || 'No description'}</p>
                  <div className="mt-2 text-sm text-gray-500">
                    <span>{bot.main_buttons.length} main buttons</span>
                    <span className="mx-2">•</span>
                    <span>{bot.products.length} products</span>
                  </div>
                </div>
                <div className="flex space-x-2">
                  <Link
                    href={`/admin/bots/${bot._id}`}
                    className="text-indigo-600 hover:text-indigo-900 text-sm font-medium"
                  >
                    Edit
                  </Link>
                  <button
                    onClick={() => handleToggleStatus(bot._id, bot.status)}
                    className="text-gray-600 hover:text-gray-900 text-sm font-medium"
                  >
                    {bot.status === 'live' ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    onClick={() => handleDelete(bot._id)}
                    className="text-red-600 hover:text-red-900 text-sm font-medium"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {bots.length === 0 && !loading && (
        <div className="text-center py-8 text-gray-500">
          No bots found. Create your first bot!
        </div>
      )}
    </div>
  );
}

