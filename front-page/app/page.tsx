'use client';

import { useEffect, useState, useMemo } from 'react';
import Image from 'next/image';

// Category emoji mapping
const CATEGORY_EMOJIS: Record<string, string> = {
  stimulants: '💊',
  cannabis: '🍃',
  psychedelics: '🌿',
  prescription: '💉',
  other: '📦',
};

// Reverse mapping: emoji to category name
const EMOJI_TO_CATEGORY: Record<string, string> = {
  '💊': 'Stimulants',
  '🍃': 'Cannabis',
  '🌿': 'Psychedelics',
  '💉': 'Prescription',
  '📦': 'Other',
};

// Get emoji from category value
function getCategoryEmoji(categoryValue: string): string {
  return CATEGORY_EMOJIS[categoryValue.toLowerCase()] || '';
}

// Get category name from emoji
function getCategoryName(emoji: string): string {
  return EMOJI_TO_CATEGORY[emoji] || 'Category';
}

// Parse rating string (e.g. "96.81%" or "96.81") to number
function parseRating(rating: string | null | undefined): number | null {
  if (!rating || typeof rating !== 'string' || !rating.trim()) return null;
  const cleaned = rating.replace(/%/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

type SortOption = 'random' | 'sales' | 'reviews' | 'rating' | 'oldest' | null;

interface Bot {
  _id: string;
  name: string;
  description?: string;
  status: string;
  profile_picture_url?: string;
  telegram_username?: string;
  categories?: string[];
  featured?: boolean;
  payment_methods?: string[]; // Supported payment methods (e.g., ["BTC", "LTC"])
  cut_off_time?: string; // Cut-off time in HH:MM format (e.g., "14:30")
  sales?: number; // Paid orders count
  rating?: string | null; // Rating percentage (e.g., "96.81%")
  rating_count?: string | null; // Number of ratings (e.g., "7707")
}

export default function Home() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>(null);
  const [randomKey, setRandomKey] = useState(0);

  useEffect(() => {
    fetchBots();
  }, []);

  // Stats computed from bots
  const stats = useMemo(() => {
    const activeVendors = bots.length;
    const totalVendors = bots.length;
    const ratings = bots.map((b) => parseRating(b.rating)).filter((r): r is number => r !== null);
    const avgRating = ratings.length > 0
      ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
      : 'N/A';
    return { activeVendors, avgRating, totalVendors };
  }, [bots]);

  // Filter and sort bots
  const displayedBots = useMemo(() => {
    let result = bots;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = bots.filter((bot) => {
        const name = (bot.name || '').toLowerCase();
        const desc = (bot.description || '').toLowerCase();
        const username = (bot.telegram_username || '').toLowerCase();
        const categoryNames = (bot.categories || [])
          .map((c) => getCategoryName(c).toLowerCase())
          .join(' ');
        return name.includes(q) || desc.includes(q) || username.includes(q) || categoryNames.includes(q);
      });
    }
    if (sortBy === 'random') {
      const hash = (s: string) => s.split('').reduce((acc, c) => ((acc << 5) - acc + c.charCodeAt(0)) | 0, 0);
      result = [...result].sort((a, b) => ((hash(a._id) + randomKey) % 1000) - ((hash(b._id) + randomKey) % 1000));
    } else if (sortBy === 'sales') {
      result = [...result].sort((a, b) => (b.sales ?? 0) - (a.sales ?? 0));
    } else if (sortBy === 'reviews') {
      result = [...result].sort(
        (a, b) => parseInt(String(b.rating_count ?? '0').replace(/\D/g, ''), 10) - parseInt(String(a.rating_count ?? '0').replace(/\D/g, ''), 10)
      );
    } else if (sortBy === 'rating') {
      result = [...result].sort((a, b) => {
        const ra = parseRating(a.rating) ?? 0;
        const rb = parseRating(b.rating) ?? 0;
        return rb - ra;
      });
    } else if (sortBy === 'oldest') {
      result = [...result].sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
    }
    return result;
  }, [bots, searchQuery, sortBy, randomKey]);

  const fetchBots = async () => {
    try {
      const response = await fetch('/api/bots?t=' + Date.now());
      if (response.ok) {
        const data = await response.json();
        setBots(data);
      }
    } catch (err) {
      console.error('Error fetching bots:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header Bar */}
      <header className="bg-gray-800/80 border-b border-gray-700 shadow-sm backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            <div className="flex items-center gap-3">
              <Image
                src="/logo.png"
                alt="Auroneth Marketplace"
                width={80}
                height={80}
                className="h-16 w-auto object-contain"
                priority
              />
              <span className="text-xl font-bold text-white">Auroneth Marketplace</span>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <div className="bg-gray-800 text-white border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <h2 className="text-4xl font-bold mb-4">Discover Verified Telegram Bots</h2>
          <p className="text-xl text-gray-300 max-w-2xl">
            Discover and use powerful Telegram bots for shopping, support, and more.
            All bots are verified and secure.
          </p>
        </div>
      </div>

      {/* Stats, Search, Filter Section - Dark theme */}
      <div className="bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-gray-800 rounded-2xl shadow-lg p-6">
              <div className="text-3xl font-bold text-blue-400">{stats.activeVendors}</div>
              <div className="text-xs uppercase tracking-wider text-gray-400 mt-1">Active Vendors</div>
            </div>
            <div className="bg-gray-800 rounded-2xl shadow-lg p-6">
              <div className="text-3xl font-bold text-blue-400">{stats.avgRating}</div>
              <div className="text-xs uppercase tracking-wider text-gray-400 mt-1">Average Rating</div>
            </div>
            <div className="bg-gray-800 rounded-2xl shadow-lg p-6">
              <div className="text-3xl font-bold text-blue-400">{stats.totalVendors}</div>
              <div className="text-xs uppercase tracking-wider text-gray-400 mt-1">Total Vendors</div>
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative mb-6">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
            <input
              type="text"
              placeholder="Search vendors..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-gray-800 border border-gray-700 rounded-2xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Sort By */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-gray-400 text-sm">Sort By:</span>
            {[
              { id: 'random' as const, label: 'Random', icon: '✕' },
              { id: 'sales' as const, label: 'Sales', icon: '📈' },
              { id: 'reviews' as const, label: 'Reviews', icon: '⭐' },
              { id: 'rating' as const, label: 'Rating', icon: '📊' },
              { id: 'oldest' as const, label: 'Oldest', icon: '🕒' },
            ].map(({ id, label, icon }) => (
              <button
                key={id}
                onClick={() => {
                  const next = sortBy === id ? null : id;
                  setSortBy(next);
                  if (next === 'random') setRandomKey((k) => k + 1);
                }}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                  sortBy === id
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-800 border border-gray-600 text-white hover:bg-gray-700'
                }`}
              >
                <span>{icon}</span>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bot Listing Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-12">
        <h2 className="text-3xl font-bold text-white mb-8">Available Bots</h2>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400"></div>
            <p className="mt-4 text-gray-400">Loading bots...</p>
          </div>
        ) : bots.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400">No bots available at the moment.</p>
          </div>
        ) : displayedBots.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400">No vendors match your search.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {displayedBots.map((bot, index) => {
              // Color themes for cards (dark variants - purple, amber, blue)
              const colorThemes = [
                { border: 'border-purple-500/50', badge: 'bg-purple-600', text: 'text-purple-400', stat: 'text-purple-400' },
                { border: 'border-amber-500/50', badge: 'bg-amber-600', text: 'text-amber-400', stat: 'text-amber-400' },
                { border: 'border-blue-500/50', badge: 'bg-blue-600', text: 'text-blue-400', stat: 'text-blue-400' },
              ];
              const theme = colorThemes[index % 3];
              const isFeatured = bot.featured || false;
              
              // Gradient and glow styles for featured bots
              const featuredGradients: Record<string, { from: string; to: string; glowColor: string; ring: string }> = {
                purple: {
                  from: 'from-purple-600',
                  to: 'to-purple-800',
                  glowColor: 'rgba(168, 85, 247, 0.4)',
                  ring: 'ring-purple-500/50'
                },
                yellow: {
                  from: 'from-amber-600',
                  to: 'to-amber-800',
                  glowColor: 'rgba(245, 158, 11, 0.4)',
                  ring: 'ring-amber-500/50'
                },
                blue: {
                  from: 'from-blue-600',
                  to: 'to-blue-800',
                  glowColor: 'rgba(59, 130, 246, 0.4)',
                  ring: 'ring-blue-500/50'
                }
              };
              
              const gradientTheme = ['purple', 'yellow', 'blue'][index % 3];
              const gradient = featuredGradients[gradientTheme];
              
              return (
                <div
                  key={bot._id}
                  className={`rounded-lg transition-all duration-300 border-2 h-full flex flex-col ${
                    isFeatured 
                      ? `bg-gradient-to-br ${gradient.from} ${gradient.to} ${theme.border} ring-4 ${gradient.ring} hover:scale-105` 
                      : 'bg-gray-800 border-gray-700 shadow-lg hover:shadow-xl hover:border-gray-600'
                  }`}
                  style={isFeatured ? {
                    boxShadow: `0 0 30px ${gradient.glowColor}, 0 0 60px ${gradient.glowColor}`,
                  } : {}}
                >
                  <div className={`p-6 flex flex-col flex-grow ${isFeatured ? 'text-white' : ''}`}>
                    {/* Header Section */}
                    <div className="flex items-start mb-4">
                      {/* Profile Picture */}
                      {bot.profile_picture_url && bot.profile_picture_url.trim() ? (
                        <img
                          src={bot.profile_picture_url}
                          alt={bot.name}
                          className={`w-20 h-20 rounded-full object-cover mr-4 border-2 flex-shrink-0 ${isFeatured ? 'border-white/30 shadow-lg' : 'border-gray-600'}`}
                          onError={(e) => {
                            const img = e.target as HTMLImageElement;
                            img.style.display = 'none';
                            const fallback = document.createElement('div');
                            fallback.className = `w-20 h-20 rounded-full flex items-center justify-center mr-4 border-2 flex-shrink-0 ${isFeatured ? 'bg-white/20 border-white/30' : 'bg-gray-700 border-gray-600'}`;
                            fallback.innerHTML = `<span class="${isFeatured ? 'text-white' : 'text-blue-400'} text-2xl font-bold">${bot.name.charAt(0).toUpperCase()}</span>`;
                            img.parentNode?.insertBefore(fallback, img);
                          }}
                        />
                      ) : (
                        <div className={`w-20 h-20 rounded-full flex items-center justify-center mr-4 border-2 flex-shrink-0 ${isFeatured ? 'bg-white/20 border-white/30' : 'bg-gray-700 border-gray-600'}`}>
                          <span className={`text-2xl font-bold ${isFeatured ? 'text-white' : 'text-blue-400'}`}>
                            {bot.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}
                      
                      {/* Bot Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className={`text-xl font-bold truncate ${isFeatured ? 'text-white' : 'text-white'}`}>{bot.name}</h3>
                          <span className={isFeatured ? 'text-white' : 'text-green-400'}>✓</span>
                        </div>
                        
                        {/* Status */}
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`w-2 h-2 rounded-full ${isFeatured ? 'bg-white' : 'bg-green-500'}`}></span>
                          <span className={`text-sm ${isFeatured ? 'text-white/90' : 'text-gray-400'}`}>Online now</span>
                        </div>
                        
                        {/* Featured Badge */}
                        {isFeatured && (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold text-white bg-white/20 backdrop-blur-sm border border-white/30 mb-2">
                            PREMIUM
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Category Emojis */}
                    {bot.categories && bot.categories.length > 0 && (
                      <div className="flex items-center gap-2 mb-3 flex-wrap">
                        {bot.categories.map((cat, i) => {
                          const categoryName = getCategoryName(cat);
                          return (
                            <span
                              key={i}
                              className="text-2xl relative group cursor-help"
                              title={categoryName}
                            >
                              {cat}
                              {/* Tooltip on hover */}
                              <span className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 text-xs text-white bg-gray-800 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10">
                                {categoryName}
                                {/* Tooltip arrow */}
                                <span className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-800"></span>
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {/* Description */}
                    <p className={`text-sm mb-4 ${isFeatured ? 'text-white/90' : 'text-gray-600'}`}>{bot.description || 'No description available.'}</p>

                    {/* Statistics Section */}
                    <div className={`grid grid-cols-3 gap-4 mb-4 pb-4 ${isFeatured ? 'border-b border-white/20' : 'border-b border-gray-200'}`}>
                      <div>
                        <div className={`text-2xl font-bold ${isFeatured ? 'text-white' : theme.stat}`}>
                          {(bot.sales ?? 0)}+
                        </div>
                        <div className={`text-xs ${isFeatured ? 'text-white/80' : 'text-gray-500'}`}>SALES</div>
                      </div>
                      <div>
                        <div className={`text-2xl font-bold ${isFeatured ? 'text-white' : theme.stat}`}>
                          {bot.rating && bot.rating.trim() ? bot.rating : 'N/A'}
                        </div>
                        <div className={`text-xs ${isFeatured ? 'text-white/80' : 'text-gray-500'}`}>RATING</div>
                      </div>
                      <div>
                        <div className={`text-2xl font-bold ${isFeatured ? 'text-white' : theme.stat}`}>
                          {(() => {
                            const cutOffTime = bot.cut_off_time;
                            if (cutOffTime && typeof cutOffTime === 'string' && cutOffTime.trim()) {
                              // Format time from HH:MM to user-friendly format
                              try {
                                const timeStr = cutOffTime.trim();
                                const [hours, minutes] = timeStr.split(':');
                                if (hours && minutes) {
                                  const hour = parseInt(hours, 10);
                                  const min = minutes.padStart(2, '0');
                                  // Convert to 12-hour format
                                  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
                                  const ampm = hour >= 12 ? 'PM' : 'AM';
                                  return `${hour12}:${min} ${ampm}`;
                                }
                              } catch (e) {
                                console.error('Error parsing cut_off_time:', e, cutOffTime);
                                // If parsing fails, return as-is
                                return cutOffTime;
                              }
                            }
                            return 'N/A';
                          })()}
                        </div>
                        <div className={`text-xs ${isFeatured ? 'text-white/80' : 'text-gray-500'}`}>CUT-OFF</div>
                      </div>
                    </div>

                    {/* Payment Methods */}
                    {bot.payment_methods && bot.payment_methods.length > 0 && (
                      <div className="flex items-center gap-2 mb-3 flex-wrap">
                        {bot.payment_methods
                          .filter((method: string) => method === 'BTC' || method === 'LTC') // Only show BTC/LTC
                          .map((method: string, idx: number) => (
                            <span
                              key={idx}
                              className={`text-xs px-2 py-1 rounded font-medium ${
                                isFeatured 
                                  ? 'bg-white/20 backdrop-blur-sm border border-white/30 text-white' 
                                  : `${theme.badge} text-white`
                              }`}
                            >
                              {method}
                            </span>
                          ))}
                      </div>
                    )}

                    {/* Reviews */}
                    <div className="flex items-center gap-1 mb-3">
                      <span className={`text-lg ${isFeatured ? 'text-white' : theme.text}`}>★</span>
                      <span className={`text-sm ${isFeatured ? 'text-white/90' : 'text-gray-600'}`}>
                        {bot.rating_count && bot.rating_count.trim() ? `${bot.rating_count}+ reviews` : '0+ reviews'}
                      </span>
                    </div>

                    {/* Establishment Date */}
                    <div className={`flex items-center gap-1 mb-4 text-sm ${isFeatured ? 'text-white/80' : 'text-gray-500'}`}>
                      <span>📅</span>
                      <span>Est: {new Date().toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}</span>
                    </div>

                    {/* Spacer to push button to bottom */}
                    <div className="flex-grow"></div>

                    {/* Open Bot Button */}
                    <a
                      href={`https://t.me/${bot.telegram_username || bot.name.toLowerCase().replace(/\s+/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex items-center justify-center w-full px-4 py-2 rounded-md hover:opacity-90 transition-opacity font-medium mt-4 ${
                        isFeatured 
                          ? 'bg-white text-gray-900 hover:bg-white/90 shadow-lg' 
                          : `${theme.badge} text-white`
                      }`}
                    >
                      Open Bot
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

