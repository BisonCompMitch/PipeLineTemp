import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  getMessageAttachmentUrl,
  listMessages,
  listUsers,
  markMessageRead,
  sendMessage,
  uploadMessageAttachment
} from '../api.js';
import { getStoredUsername } from '../utils/authStorage.js';

const POLL_INTERVAL_MS = 12000;
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB client-side guard

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function timeLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentPreview({ attachment }) {
  const url = getMessageAttachmentUrl(attachment.id);
  const isImage = (attachment.content_type || '').startsWith('image/');
  if (isImage) {
    return (
      <a
        className="msg-attachment-image-link"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={attachment.filename}
      >
        <img
          className="msg-attachment-image"
          src={url}
          alt={attachment.filename}
          loading="lazy"
        />
      </a>
    );
  }
  return (
    <a
      className="msg-attachment-chip"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download={attachment.filename}
    >
      <svg className="msg-attachment-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <polyline
          points="14 2 14 8 20 8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
      <span className="msg-attachment-name">{attachment.filename}</span>
      <span className="msg-attachment-size">{formatBytes(attachment.size_bytes)}</span>
    </a>
  );
}

export default function Messages({ currentUsername }) {
  const me = currentUsername || getStoredUsername() || '';
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const threadEndRef = useRef(null);
  const pollRef = useRef(null);
  const fileInputRef = useRef(null);
  const sendingRef = useRef(false);

  const fetchMessages = useCallback(async () => {
    try {
      const data = await listMessages();
      if (Array.isArray(data)) setMessages(data);
    } catch {
      // silently skip on poll errors
    }
  }, []);

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
    return () => { active = false; };
  }, [me]);

  useEffect(() => {
    fetchMessages();
    pollRef.current = setInterval(fetchMessages, POLL_INTERVAL_MS);
    return () => clearInterval(pollRef.current);
  }, [fetchMessages]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, selectedUser]);

  const conversation = selectedUser
    ? [...messages]
        .filter(
          (m) =>
            (m.from_user === me && m.to_user === selectedUser) ||
            (m.from_user === selectedUser && m.to_user === me)
        )
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    : [];

  const unreadCount = (otherUser) =>
    messages.filter((m) => m.from_user === otherUser && m.to_user === me && !m.read).length;

  const lastMsg = (otherUser) => {
    const thread = messages
      .filter(
        (m) =>
          (m.from_user === me && m.to_user === otherUser) ||
          (m.from_user === otherUser && m.to_user === me)
      )
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return thread[0] || null;
  };

  const handleSelect = async (username) => {
    setSelectedUser(username);
    setDraft('');
    setPendingFiles([]);
    setUploadError('');
    const unread = messages.filter(
      (m) => m.from_user === username && m.to_user === me && !m.read
    );
    await Promise.all(unread.map((m) => markMessageRead(m.id).catch(() => {})));
    if (unread.length > 0) {
      setMessages((prev) =>
        prev.map((m) =>
          m.from_user === username && m.to_user === me && !m.read ? { ...m, read: true } : m
        )
      );
    }
  };

  const handleFileChange = (e) => {
    setUploadError('');
    const files = Array.from(e.target.files || []);
    const oversized = files.filter((f) => f.size > MAX_FILE_BYTES);
    if (oversized.length > 0) {
      setUploadError(`File too large (max 50 MB): ${oversized.map((f) => f.name).join(', ')}`);
      e.target.value = '';
      return;
    }
    setPendingFiles((prev) => [...prev, ...files]);
    e.target.value = '';
  };

  const removePendingFile = (index) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    const body = draft.trim();
    const files = pendingFiles;
    if ((!body && files.length === 0) || !selectedUser || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setDraft('');
    setPendingFiles([]);
    setUploadError('');
    try {
      const msgBody = body || (files.length > 0 ? ' ' : '');
      const newMsg = await sendMessage(selectedUser, msgBody);
      setMessages((prev) => [...prev, newMsg]);

      if (files.length > 0) {
        const uploaded = [];
        for (const file of files) {
          try {
            const att = await uploadMessageAttachment(newMsg.id, file);
            uploaded.push(att);
          } catch (err) {
            setUploadError(`Failed to upload "${file.name}": ${err.message}`);
          }
        }
        if (uploaded.length > 0) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === newMsg.id
                ? { ...m, attachments: [...(m.attachments || []), ...uploaded] }
                : m
            )
          );
        }
      }
    } catch {
      setDraft(body);
      setPendingFiles(files);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  // Merge listUsers() results with anyone who has messaged or been messaged by me,
  // so contacts always appear even if the API doesn't return them for this role.
  const contactList = React.useMemo(() => {
    const map = new Map(users.map((u) => [u.username, u]));
    for (const m of messages) {
      const other = m.from_user === me ? m.to_user : m.from_user;
      if (other && other !== me && !map.has(other)) {
        map.set(other, { username: other, full_name: null });
      }
    }
    return [...map.values()];
  }, [users, messages, me]);

  const selectedUserObj = contactList.find((u) => u.username === selectedUser);

  const sortedUsers = [...contactList].sort((a, b) => {
    const la = lastMsg(a.username);
    const lb = lastMsg(b.username);
    if (!la && !lb) return 0;
    if (!la) return 1;
    if (!lb) return -1;
    return new Date(lb.created_at) - new Date(la.created_at);
  });

  const canSend = (draft.trim().length > 0 || pendingFiles.length > 0) && !sending;

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
                          {last.from_user === me ? 'You: ' : ''}
                          {last.body && last.body.trim() ? last.body : (last.attachments?.length > 0 ? '📎 Attachment' : '')}
                        </span>
                        <span className="messages-preview-time">{timeLabel(last.created_at)}</span>
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
                    className={`messages-bubble-row${msg.from_user === me ? ' outgoing' : ' incoming'}`}
                  >
                    <div className="messages-bubble">
                      {msg.body && msg.body.trim() ? (
                        <span className="messages-bubble-text">{msg.body}</span>
                      ) : null}
                      {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                        <div className="msg-attachments">
                          {msg.attachments.map((att) => (
                            <AttachmentPreview key={att.id} attachment={att} />
                          ))}
                        </div>
                      )}
                      <span className="messages-bubble-time">{timeLabel(msg.created_at)}</span>
                    </div>
                  </div>
                ))
              )}
              <div ref={threadEndRef} />
            </div>

            {pendingFiles.length > 0 && (
              <div className="msg-pending-files">
                {pendingFiles.map((file, i) => (
                  <div key={i} className="msg-pending-chip">
                    <span className="msg-pending-name">{file.name}</span>
                    <span className="msg-pending-size">{formatBytes(file.size)}</span>
                    <button
                      type="button"
                      className="msg-pending-remove"
                      onClick={() => removePendingFile(i)}
                      aria-label={`Remove ${file.name}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {uploadError && (
              <div className="msg-upload-error">{uploadError}</div>
            )}

            <div className="messages-compose-bar">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="msg-file-input"
                onChange={handleFileChange}
                tabIndex={-1}
                aria-hidden="true"
              />
              <button
                type="button"
                className="ghost icon-button msg-attach-button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach file"
                title="Attach file"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.48"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
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
                disabled={!canSend}
              >
                {sending ? '…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
