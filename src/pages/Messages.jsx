import React, { useEffect, useRef, useState } from 'react';
import { listUsers } from '../api.js';
import { getStoredUsername } from '../utils/authStorage.js';

const STORAGE_KEY = 'bw_direct_messages';

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function loadMessages() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveMessages(msgs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
  } catch {}
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function timeLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function Messages({ currentUsername }) {
  const me = currentUsername || getStoredUsername() || '';
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState(loadMessages);
  const [draft, setDraft] = useState('');
  const threadEndRef = useRef(null);

  useEffect(() => {
    let active = true;
    listUsers()
      .then((data) => {
        if (!active) return;
        const list = Array.isArray(data) ? data : [];
        setUsers(list.filter((u) => String(u.username || '') !== me));
        setLoadingUsers(false);
      })
      .catch(() => {
        if (active) setLoadingUsers(false);
      });
    return () => {
      active = false;
    };
  }, [me]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, selectedUser]);

  const conversation = selectedUser
    ? [...messages]
        .filter((m) => (m.from === me && m.to === selectedUser) || (m.from === selectedUser && m.to === me))
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    : [];

  const unreadCount = (otherUser) =>
    messages.filter((m) => m.from === otherUser && m.to === me && !m.read).length;

  const lastMsg = (otherUser) => {
    const thread = messages
      .filter((m) => (m.from === me && m.to === otherUser) || (m.from === otherUser && m.to === me))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return thread[0] || null;
  };

  const markRead = (otherUser) => {
    setMessages((prev) => {
      const next = prev.map((m) =>
        m.from === otherUser && m.to === me && !m.read ? { ...m, read: true } : m
      );
      saveMessages(next);
      return next;
    });
  };

  const handleSelect = (username) => {
    setSelectedUser(username);
    markRead(username);
    setDraft('');
  };

  const handleSend = () => {
    const body = draft.trim();
    if (!body || !selectedUser) return;
    const msg = {
      id: newId(),
      from: me,
      to: selectedUser,
      body,
      timestamp: new Date().toISOString(),
      read: false
    };
    setMessages((prev) => {
      const next = [...prev, msg];
      saveMessages(next);
      return next;
    });
    setDraft('');
  };

  const selectedUserObj = users.find((u) => u.username === selectedUser);

  const sortedUsers = [...users].sort((a, b) => {
    const la = lastMsg(a.username);
    const lb = lastMsg(b.username);
    if (!la && !lb) return 0;
    if (!la) return 1;
    if (!lb) return -1;
    return new Date(lb.timestamp) - new Date(la.timestamp);
  });

  return (
    <div className="messages-layout">
      <div className="messages-sidebar">
        <div className="messages-sidebar-header">
          <span className="messages-sidebar-title">Direct Messages</span>
        </div>
        {loadingUsers ? (
          <div className="messages-status-text">Loading users…</div>
        ) : sortedUsers.length === 0 ? (
          <div className="messages-status-text">No other users found.</div>
        ) : (
          <div className="messages-contact-list">
            {sortedUsers.map((user) => {
              const last = lastMsg(user.username);
              const count = unreadCount(user.username);
              const displayName = user.full_name || user.username;
              return (
                <button
                  key={user.username}
                  type="button"
                  className={`messages-contact-item${selectedUser === user.username ? ' selected' : ''}`}
                  onClick={() => handleSelect(user.username)}
                >
                  <div className="messages-avatar">{initials(displayName)}</div>
                  <div className="messages-contact-meta">
                    <div className="messages-contact-row">
                      <span className="messages-contact-name">{displayName}</span>
                      {count > 0 && <span className="messages-badge">{count}</span>}
                    </div>
                    {last && (
                      <div className="messages-contact-preview">
                        <span className="messages-preview-text">
                          {last.from === me ? 'You: ' : ''}
                          {last.body}
                        </span>
                        <span className="messages-preview-time">{timeLabel(last.timestamp)}</span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="messages-thread-panel">
        {!selectedUser ? (
          <div className="messages-empty-state">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="messages-empty-icon">
              <path
                d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <p>Select a contact to start a conversation</p>
          </div>
        ) : (
          <>
            <div className="messages-thread-header">
              <div className="messages-avatar">{initials(selectedUserObj?.full_name || selectedUser)}</div>
              <span className="messages-thread-name">{selectedUserObj?.full_name || selectedUser}</span>
            </div>
            <div className="messages-thread-body">
              {conversation.length === 0 ? (
                <div className="messages-empty-state">
                  <p>No messages yet. Start the conversation!</p>
                </div>
              ) : (
                conversation.map((msg) => (
                  <div
                    key={msg.id}
                    className={`messages-bubble-row${msg.from === me ? ' outgoing' : ' incoming'}`}
                  >
                    <div className="messages-bubble">
                      <span className="messages-bubble-text">{msg.body}</span>
                      <span className="messages-bubble-time">{timeLabel(msg.timestamp)}</span>
                    </div>
                  </div>
                ))
              )}
              <div ref={threadEndRef} />
            </div>
            <div className="messages-compose-bar">
              <textarea
                className="messages-compose-input"
                placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={2}
              />
              <button
                type="button"
                className="primary messages-send-button"
                onClick={handleSend}
                disabled={!draft.trim()}
              >
                Send
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
