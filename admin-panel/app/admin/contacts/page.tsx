'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface ContactMessage {
  _id: string;
  botId: string;
  userId: string;
  message: string;
  timestamp: string;
  read: boolean;
}

interface Bot {
  _id: string;
  name: string;
}

export default function ContactsPage() {
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedBotId, setSelectedBotId] = useState<string>('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  useEffect(() => {
    fetchBots();
    fetchMessages();
  }, [selectedBotId, unreadOnly]);

  const fetchBots = async () => {
    try {
      const response = await fetch('/api/bots');
      if (response.ok) {
        const data = await response.json();
        setBots(data);
      }
    } catch (err) {
      console.error('Error fetching bots:', err);
    }
  };

  const fetchMessages = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedBotId) {
        params.append('botId', selectedBotId);
      }
      if (unreadOnly) {
        params.append('unreadOnly', 'true');
      }

      const response = await fetch(`/api/contacts?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setMessages(data);
      } else {
        setError('Failed to fetch contact messages');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (messageId: string) => {
    try {
      const response = await fetch('/api/contacts', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messageId, read: true }),
      });

      if (response.ok) {
        // Update local state
        setMessages((prev) =>
          prev.map((msg) =>
            msg._id === messageId ? { ...msg, read: true } : msg
          )
        );
      }
    } catch (err) {
      console.error('Error marking message as read:', err);
    }
  };

  const sendReply = async (message: ContactMessage) => {
    if (!replyText.trim()) {
      setError('Please enter a reply message');
      return;
    }

    setSendingReply(true);
    setError('');

    try {
      const response = await fetch('/api/contacts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: message.userId,
          botId: message.botId,
          message: replyText.trim(),
        }),
      });

      if (response.ok) {
        setReplyText('');
        setReplyingTo(null);
        // Optionally mark original message as read
        await markAsRead(message._id);
        alert('Reply sent successfully!');
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to send reply');
      }
    } catch (err) {
      console.error('Error sending reply:', err);
      setError('Network error while sending reply');
    } finally {
      setSendingReply(false);
    }
  };

  const getBotName = (botId: string) => {
    const bot = bots.find((b) => b._id === botId);
    return bot ? bot.name : botId;
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleString();
    } catch {
      return dateString;
    }
  };

  const unreadCount = messages.filter((m) => !m.read).length;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Contact Messages</h1>
        <Link
          href="/admin/bots"
          className="text-indigo-600 hover:text-indigo-800"
        >
          ← Back to Bots
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white shadow rounded-lg p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Filter by Bot
            </label>
            <select
              className="block w-full border border-gray-300 rounded-md px-3 py-2"
              value={selectedBotId}
              onChange={(e) => setSelectedBotId(e.target.value)}
            >
              <option value="">All Bots</option>
              {bots.map((bot) => (
                <option key={bot._id} value={bot._id}>
                  {bot.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <label className="flex items-center">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                checked={unreadOnly}
                onChange={(e) => setUnreadOnly(e.target.checked)}
              />
              <span className="ml-2 text-sm text-gray-700">
                Unread only ({unreadCount})
              </span>
            </label>
          </div>

          <div className="flex items-end">
            <button
              onClick={fetchMessages}
              className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Messages List */}
      {loading ? (
        <div className="text-center py-8">Loading...</div>
      ) : messages.length === 0 ? (
        <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">
          No contact messages found.
        </div>
      ) : (
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <ul className="divide-y divide-gray-200">
            {messages.map((message) => (
              <li key={message._id}>
                <div className="px-4 py-4 sm:px-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center">
                        <h3 className="text-sm font-medium text-gray-900">
                          Bot: {getBotName(message.botId)}
                        </h3>
                        {!message.read && (
                          <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            New
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-gray-500">
                        User ID: {message.userId}
                      </p>
                      <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">
                        {message.message}
                      </p>
                      <p className="mt-2 text-xs text-gray-500">
                        {formatDate(message.timestamp)}
                      </p>
                    </div>
                    <div className="ml-4 flex flex-col gap-2">
                      {!message.read && (
                        <button
                          onClick={() => markAsRead(message._id)}
                          className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700"
                        >
                          Mark as Read
                        </button>
                      )}
                      <button
                        onClick={() => setReplyingTo(message._id)}
                        className="bg-indigo-600 text-white px-3 py-1 rounded text-sm hover:bg-indigo-700"
                      >
                        Reply
                      </button>
                    </div>
                  </div>
                  {replyingTo === message._id && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="Type your reply..."
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                        rows={3}
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => sendReply(message)}
                          disabled={sendingReply || !replyText.trim()}
                          className="bg-indigo-600 text-white px-4 py-2 rounded text-sm hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                        >
                          {sendingReply ? 'Sending...' : 'Send Reply'}
                        </button>
                        <button
                          onClick={() => {
                            setReplyingTo(null);
                            setReplyText('');
                            setError('');
                          }}
                          className="bg-gray-300 text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-400"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

