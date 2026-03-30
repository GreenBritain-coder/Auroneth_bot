'use client';

import { useEffect, useState } from 'react';

interface User {
  _id: string;
  secret_phrase: string;
  first_bot_id: string;
  created_at: string;
  last_seen?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
}

type Filter = 'all' | 'active' | 'new' | 'inactive' | 'never';

function timeAgo(dateStr: string | undefined): string {
  if (!dateStr) return 'Never';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function applyFilter(users: User[], filter: Filter): User[] {
  const now = Date.now();
  const day = 86400000;
  switch (filter) {
    case 'active':
      return users.filter(u => u.last_seen && now - new Date(u.last_seen).getTime() < 7 * day);
    case 'new':
      return users.filter(u => now - new Date(u.created_at).getTime() < 7 * day);
    case 'inactive':
      return users.filter(u => !u.last_seen || now - new Date(u.last_seen).getTime() > 30 * day);
    case 'never':
      return users.filter(u => !u.last_seen);
    default:
      return users;
  }
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/users');
      if (response.ok) {
        const data = await response.json();
        setUsers(data.data || data);
      } else {
        setError('Failed to fetch users');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const now = Date.now();
  const day = 86400000;
  const counts: Record<Filter, number> = {
    all: users.length,
    active: users.filter(u => u.last_seen && now - new Date(u.last_seen).getTime() < 7 * day).length,
    new: users.filter(u => now - new Date(u.created_at).getTime() < 7 * day).length,
    inactive: users.filter(u => !u.last_seen || now - new Date(u.last_seen).getTime() > 30 * day).length,
    never: users.filter(u => !u.last_seen).length,
  };

  const filteredUsers = applyFilter(users, filter).filter((user) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      user._id.toLowerCase().includes(term) ||
      (user.secret_phrase || '').toLowerCase().includes(term) ||
      (user.username || '').toLowerCase().includes(term) ||
      (user.first_name || '').toLowerCase().includes(term) ||
      (user.last_name || '').toLowerCase().includes(term)
    );
  });

  const tabs: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'new', label: 'New' },
    { key: 'inactive', label: 'Inactive' },
    { key: 'never', label: 'Never seen' },
  ];

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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users & Secret Phrases</h1>
          <p className="mt-1 text-sm text-gray-500">
            {filteredUsers.length} {filteredUsers.length === 1 ? 'user' : 'users'}
            {searchTerm ? ` (filtered from ${users.length})` : ''}
          </p>
        </div>
        <div className="w-full sm:w-72 relative">
          <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
          </svg>
          <input
            type="text"
            placeholder="Search users, phrases, names..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-2 text-sm font-medium rounded-t-md transition-colors flex items-center gap-1.5 ${
              filter === key
                ? 'text-indigo-600 border-b-2 border-indigo-600 -mb-px bg-white'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              filter === key ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-500'
            }`}>
              {counts[key]}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">{error}</div>
      )}

      {/* User List */}
      <div className="bg-white shadow-sm rounded-xl border border-gray-200 overflow-hidden">
        <div className="divide-y divide-gray-100">
          {filteredUsers.map((user) => {
            const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ') || null;

            return (
              <div key={user._id} className="px-4 py-3 sm:px-6 flex items-center gap-4 hover:bg-gray-50">
                {/* Avatar */}
                <div className="flex-shrink-0">
                  {user.avatar_url ? (
                    <img
                      src={user.avatar_url}
                      alt=""
                      className="h-10 w-10 rounded-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }}
                    />
                  ) : null}
                  <div className={`h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center ${user.avatar_url ? 'hidden' : ''}`}>
                    <span className="text-indigo-600 font-semibold text-sm">
                      {(user.first_name || user._id).charAt(0).toUpperCase()}
                    </span>
                  </div>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {displayName && (
                      <span className="font-medium text-gray-900 text-sm">{displayName}</span>
                    )}
                    {user.username && (
                      <span className="text-xs text-gray-400">@{user.username}</span>
                    )}
                    {!displayName && !user.username && (
                      <span className="font-mono text-sm text-gray-700">{user._id}</span>
                    )}
                    {now - new Date(user.created_at).getTime() < 7 * day && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-600 font-medium">New</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-sm font-semibold text-indigo-600">{user.secret_phrase}</span>
                    <span className="text-xs text-gray-400">ID: {user._id}</span>
                  </div>
                </div>

                {/* Meta */}
                <div className="hidden sm:flex flex-col items-end text-xs text-gray-400 flex-shrink-0">
                  <span>Seen {timeAgo(user.last_seen)}</span>
                  <span>Joined {new Date(user.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {filteredUsers.length === 0 && !loading && (
        <div className="text-center py-12 text-gray-500">
          {searchTerm ? 'No users match your search.' : 'No users found.'}
        </div>
      )}
    </div>
  );
}
