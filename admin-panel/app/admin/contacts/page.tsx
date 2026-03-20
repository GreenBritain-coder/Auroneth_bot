'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

interface ContactMessage {
  _id: string;
  botId: string;
  userId: string;
  message: string;
  timestamp: string;
  read: boolean;
}

interface ContactResponse {
  _id: string;
  botId: string;
  userId: string;
  message: string;
  timestamp: string;
  repliedBy: string;
}

interface Bot {
  _id: string;
  name: string;
}

interface ConversationEntry {
  _id: string;
  type: 'user' | 'vendor';
  message: string;
  timestamp: string;
  read?: boolean;
  repliedBy?: string;
}

interface Conversation {
  botId: string;
  userId: string;
  entries: ConversationEntry[];
  lastMessageTime: string;
  hasUnread: boolean;
  unreadCount: number;
}

export default function ContactsPage() {
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [responses, setResponses] = useState<ContactResponse[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedBotId, setSelectedBotId] = useState<string>('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchBots();
    fetchData();
  }, [selectedBotId, unreadOnly]);

  useEffect(() => {
    // Scroll to bottom of chat when active conversation changes or new messages arrive
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeConversation, messages, responses]);

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

  const fetchData = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedBotId) {
        params.append('botId', selectedBotId);
      }
      if (unreadOnly) {
        params.append('unreadOnly', 'true');
      }

      // Fetch messages and responses in parallel
      const [messagesRes, responsesRes] = await Promise.all([
        fetch(`/api/contacts?${params.toString()}`),
        fetch(`/api/contacts/responses?${params.toString()}`),
      ]);

      if (messagesRes.ok) {
        const data = await messagesRes.json();
        setMessages(data);
      } else {
        setError('Failed to fetch contact messages');
      }

      if (responsesRes.ok) {
        const data = await responsesRes.json();
        setResponses(data);
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (messageId: string) => {
    try {
      await fetch('/api/contacts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, read: true }),
      });
    } catch (err) {
      console.error('Error marking message as read:', err);
    }
  };

  const sendReply = async (botId: string, userId: string) => {
    if (!replyText.trim()) {
      setError('Please enter a reply message');
      return;
    }

    setSendingReply(true);
    setError('');

    try {
      const response = await fetch('/api/contacts/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          botId,
          message: replyText.trim(),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        // Add the new response to local state immediately
        if (data.response) {
          setResponses((prev) => [data.response, ...prev]);
        }
        // Mark all messages from this user as read in local state
        setMessages((prev) =>
          prev.map((msg) =>
            msg.botId === botId && msg.userId === userId
              ? { ...msg, read: true }
              : msg
          )
        );
        setReplyText('');
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

  const formatTime = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateString;
    }
  };

  const formatDateHeader = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      if (date.toDateString() === today.toDateString()) return 'Today';
      if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
      return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  // Build conversations grouped by botId + userId
  const conversations: Conversation[] = (() => {
    const map = new Map<string, Conversation>();

    for (const msg of messages) {
      const key = `${msg.botId}::${msg.userId}`;
      if (!map.has(key)) {
        map.set(key, {
          botId: msg.botId,
          userId: msg.userId,
          entries: [],
          lastMessageTime: msg.timestamp,
          hasUnread: false,
          unreadCount: 0,
        });
      }
      const conv = map.get(key)!;
      conv.entries.push({
        _id: msg._id,
        type: 'user',
        message: msg.message,
        timestamp: msg.timestamp,
        read: msg.read,
      });
      if (!msg.read) {
        conv.hasUnread = true;
        conv.unreadCount++;
      }
    }

    for (const resp of responses) {
      const key = `${resp.botId}::${resp.userId}`;
      if (!map.has(key)) {
        map.set(key, {
          botId: resp.botId,
          userId: resp.userId,
          entries: [],
          lastMessageTime: resp.timestamp,
          hasUnread: false,
          unreadCount: 0,
        });
      }
      const conv = map.get(key)!;
      conv.entries.push({
        _id: resp._id,
        type: 'vendor',
        message: resp.message,
        timestamp: resp.timestamp,
        repliedBy: resp.repliedBy,
      });
    }

    // Sort entries within each conversation by timestamp ascending
    for (const conv of map.values()) {
      conv.entries.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      // Update lastMessageTime to the actual latest entry
      if (conv.entries.length > 0) {
        conv.lastMessageTime = conv.entries[conv.entries.length - 1].timestamp;
      }
    }

    // Sort conversations: unread first, then by last message time descending
    const result = Array.from(map.values());
    result.sort((a, b) => {
      if (a.hasUnread && !b.hasUnread) return -1;
      if (!a.hasUnread && b.hasUnread) return 1;
      return new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime();
    });

    // If unreadOnly filter is on, only keep conversations with unread messages
    if (unreadOnly) {
      return result.filter((c) => c.hasUnread);
    }

    return result;
  })();

  const activeConv = activeConversation
    ? conversations.find(
        (c) => `${c.botId}::${c.userId}` === activeConversation
      )
    : null;

  const handleSelectConversation = async (conv: Conversation) => {
    const key = `${conv.botId}::${conv.userId}`;
    setActiveConversation(key);
    setReplyText('');
    setError('');

    // Mark unread messages as read
    if (conv.hasUnread) {
      const unreadMsgs = conv.entries.filter((e) => e.type === 'user' && !e.read);
      for (const msg of unreadMsgs) {
        await markAsRead(msg._id);
      }
      // Update local state
      setMessages((prev) =>
        prev.map((m) =>
          m.botId === conv.botId && m.userId === conv.userId
            ? { ...m, read: true }
            : m
        )
      );
    }
  };

  const totalUnread = messages.filter((m) => !m.read).length;

  return (
    <div className="h-[calc(100vh-8rem)]">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Contact Messages</h1>
        <Link
          href="/admin/bots"
          className="text-indigo-600 hover:text-indigo-800"
        >
          &larr; Back to Bots
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
          <button
            onClick={() => setError('')}
            className="ml-2 text-red-500 hover:text-red-700 font-bold"
          >
            x
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white shadow rounded-lg p-4 mb-4">
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
                Unread only ({totalUnread})
              </span>
            </label>
          </div>

          <div className="flex items-end">
            <button
              onClick={fetchData}
              className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Main content: conversation list + chat view */}
      {loading ? (
        <div className="text-center py-8">Loading...</div>
      ) : conversations.length === 0 ? (
        <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">
          No contact messages found.
        </div>
      ) : (
        <div className="flex bg-white shadow rounded-lg overflow-hidden" style={{ height: 'calc(100% - 10rem)' }}>
          {/* Conversation list sidebar */}
          <div className="w-80 flex-shrink-0 border-r border-gray-200 overflow-y-auto">
            {conversations.map((conv) => {
              const key = `${conv.botId}::${conv.userId}`;
              const isActive = activeConversation === key;
              const lastEntry = conv.entries[conv.entries.length - 1];
              return (
                <div
                  key={key}
                  onClick={() => handleSelectConversation(conv)}
                  className={`px-4 py-3 cursor-pointer border-b border-gray-100 hover:bg-gray-50 ${
                    isActive ? 'bg-indigo-50 border-l-4 border-l-indigo-600' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900 truncate">
                      User: {conv.userId}
                    </span>
                    {conv.hasUnread && (
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold bg-indigo-600 text-white">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {getBotName(conv.botId)}
                  </div>
                  {lastEntry && (
                    <div className="text-xs text-gray-400 mt-1 truncate">
                      {lastEntry.type === 'vendor' ? 'You: ' : ''}
                      {lastEntry.message}
                    </div>
                  )}
                  <div className="text-xs text-gray-400 mt-0.5">
                    {formatDate(conv.lastMessageTime)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Chat view */}
          <div className="flex-1 flex flex-col">
            {activeConv ? (
              <>
                {/* Chat header */}
                <div className="px-6 py-3 border-b border-gray-200 bg-gray-50 flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">
                        User: {activeConv.userId}
                      </h3>
                      <p className="text-xs text-gray-500">
                        Bot: {getBotName(activeConv.botId)}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400">
                      {activeConv.entries.length} message{activeConv.entries.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>

                {/* Chat messages */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-1">
                  {activeConv.entries.map((entry, idx) => {
                    // Show date header when the date changes
                    const prevEntry = idx > 0 ? activeConv.entries[idx - 1] : null;
                    const showDateHeader =
                      !prevEntry ||
                      new Date(entry.timestamp).toDateString() !==
                        new Date(prevEntry.timestamp).toDateString();

                    return (
                      <div key={entry._id}>
                        {showDateHeader && (
                          <div className="flex justify-center my-3">
                            <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
                              {formatDateHeader(entry.timestamp)}
                            </span>
                          </div>
                        )}
                        {entry.type === 'user' ? (
                          /* User message - left aligned */
                          <div className="flex justify-start mb-2">
                            <div className="max-w-[70%]">
                              <div className="bg-gray-100 rounded-lg rounded-tl-none px-4 py-2">
                                <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">
                                  {entry.message}
                                </p>
                              </div>
                              <div className="text-xs text-gray-400 mt-0.5 ml-1">
                                {formatTime(entry.timestamp)}
                                {entry.read === false && (
                                  <span className="ml-1 text-indigo-500 font-medium">new</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          /* Vendor reply - right aligned */
                          <div className="flex justify-end mb-2">
                            <div className="max-w-[70%]">
                              <div className="bg-indigo-600 text-white rounded-lg rounded-tr-none px-4 py-2">
                                <p className="text-sm whitespace-pre-wrap break-words">
                                  {entry.message}
                                </p>
                              </div>
                              <div className="text-xs text-gray-400 mt-0.5 text-right mr-1">
                                {entry.repliedBy && (
                                  <span className="mr-1">{entry.repliedBy}</span>
                                )}
                                {formatTime(entry.timestamp)}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div ref={chatEndRef} />
                </div>

                {/* Reply input */}
                <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex-shrink-0">
                  <div className="flex gap-2">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if (replyText.trim() && !sendingReply) {
                            sendReply(activeConv.botId, activeConv.userId);
                          }
                        }
                      }}
                      placeholder="Type your reply... (Enter to send, Shift+Enter for new line)"
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      rows={2}
                    />
                    <button
                      onClick={() => sendReply(activeConv.botId, activeConv.userId)}
                      disabled={sendingReply || !replyText.trim()}
                      className="self-end bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                    >
                      {sendingReply ? 'Sending...' : 'Send'}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              /* No conversation selected */
              <div className="flex-1 flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <svg
                    className="mx-auto h-12 w-12 text-gray-300"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    />
                  </svg>
                  <p className="mt-2 text-sm">Select a conversation to view messages</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
