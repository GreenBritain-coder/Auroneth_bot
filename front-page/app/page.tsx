'use client';

import { useEffect, useState } from 'react';

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

  useEffect(() => {
    fetchBots();
  }, []);

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
    <div className="min-h-screen bg-gray-50">
      {/* Header Bar */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <h1 className="text-2xl font-bold text-gray-900">Auroneth Marketplace</h1>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <div className="bg-indigo-600 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <h2 className="text-4xl font-bold mb-4">Discover Verified Telegram Bots</h2>
          <p className="text-xl text-indigo-100 max-w-2xl">
            Discover and use powerful Telegram bots for shopping, support, and more.
            All bots are verified and secure.
          </p>
        </div>
      </div>

      {/* Bot Listing Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-3xl font-bold text-gray-900">Available Bots</h2>
          <button
            onClick={() => { setLoading(true); fetchBots(); }}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-md hover:bg-indigo-100 disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            <p className="mt-4 text-gray-600">Loading bots...</p>
          </div>
        ) : bots.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600">No bots available at the moment.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {bots.map((bot, index) => {
              // Color themes for cards (cycling through purple, yellow, blue)
              const colorThemes = [
                { bg: 'bg-purple-50', border: 'border-purple-200', badge: 'bg-purple-600', text: 'text-purple-600', stat: 'text-purple-700' },
                { bg: 'bg-yellow-50', border: 'border-yellow-200', badge: 'bg-yellow-500', text: 'text-yellow-600', stat: 'text-yellow-700' },
                { bg: 'bg-blue-50', border: 'border-blue-200', badge: 'bg-blue-600', text: 'text-blue-600', stat: 'text-blue-700' },
              ];
              const theme = colorThemes[index % 3];
              const isFeatured = bot.featured || false;
              
              // Gradient and glow styles for featured bots
              const featuredGradients: Record<string, { from: string; to: string; glowColor: string; ring: string }> = {
                purple: {
                  from: 'from-purple-400',
                  to: 'to-purple-600',
                  glowColor: 'rgba(168, 85, 247, 0.6)',
                  ring: 'ring-purple-300'
                },
                yellow: {
                  from: 'from-yellow-400',
                  to: 'to-yellow-600',
                  glowColor: 'rgba(234, 179, 8, 0.6)',
                  ring: 'ring-yellow-300'
                },
                blue: {
                  from: 'from-blue-400',
                  to: 'to-blue-600',
                  glowColor: 'rgba(59, 130, 246, 0.6)',
                  ring: 'ring-blue-300'
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
                      : 'bg-white border-gray-200 shadow-md hover:shadow-lg'
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
                          className={`w-20 h-20 rounded-full object-cover mr-4 border-2 flex-shrink-0 ${isFeatured ? 'border-white/30 shadow-lg' : 'border-gray-200'}`}
                          onError={(e) => {
                            const img = e.target as HTMLImageElement;
                            img.style.display = 'none';
                            const fallback = document.createElement('div');
                            fallback.className = `w-20 h-20 rounded-full flex items-center justify-center mr-4 border-2 flex-shrink-0 ${isFeatured ? 'bg-white/20 border-white/30' : 'bg-indigo-100 border-gray-200'}`;
                            fallback.innerHTML = `<span class="${isFeatured ? 'text-white' : 'text-indigo-600'} text-2xl font-bold">${bot.name.charAt(0).toUpperCase()}</span>`;
                            img.parentNode?.insertBefore(fallback, img);
                          }}
                        />
                      ) : (
                        <div className={`w-20 h-20 rounded-full flex items-center justify-center mr-4 border-2 flex-shrink-0 ${isFeatured ? 'bg-white/20 border-white/30' : 'bg-indigo-100 border-gray-200'}`}>
                          <span className={`text-2xl font-bold ${isFeatured ? 'text-white' : 'text-indigo-600'}`}>
                            {bot.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}
                      
                      {/* Bot Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className={`text-xl font-bold truncate ${isFeatured ? 'text-white' : 'text-gray-900'}`}>{bot.name}</h3>
                          <span className={isFeatured ? 'text-white' : 'text-blue-500'}>✓</span>
                        </div>
                        
                        {/* Status */}
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`w-2 h-2 rounded-full ${isFeatured ? 'bg-white' : 'bg-green-500'}`}></span>
                          <span className={`text-sm ${isFeatured ? 'text-white/90' : 'text-gray-600'}`}>Online now</span>
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

