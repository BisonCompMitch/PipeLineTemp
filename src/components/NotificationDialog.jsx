import React, { useEffect, useMemo, useState } from 'react';
import { listUsers, sendNotification } from '../api.js';
import useSiteDialog from '../utils/useSiteDialog.jsx';
import { formatStageName, STAGE_FLOW } from '../utils/stageDisplay.js';

const AREA_OPTIONS = [...STAGE_FLOW.map((stage) => formatStageName(stage.name, stage.id)), 'Management', 'Admin'];

const MONEY_CHECK_AREA_LABELS = {
  'Money - D&E': 'Design',
  'Money - Production': 'Manufacturing',
  'Manufacturing - Invoice Sent': 'Shipping',
  'Money - Shipping': 'Shipping'
};

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function looksLikeEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value || '').trim());
}

function isAdminUser(user) {
  const roles = (user?.roles || []).map((role) => normalize(role));
  const areas = (user?.areas || []).map((area) => normalize(area));
  return roles.includes('admin') || areas.includes('admin');
}

function usersForArea(users, area) {
  const normalizedArea = normalize(area);
  const moneyCheckAreas = Object.keys(MONEY_CHECK_AREA_LABELS).map((item) => normalize(item));
  return (users || [])
    .filter((user) => {
      const assignedAreas = (user?.areas || []).map((areaName) => normalize(areaName));
      if (assignedAreas.includes(normalizedArea)) {
        return true;
      }
      if (moneyCheckAreas.includes(normalizedArea) && isAdminUser(user)) {
        return true;
      }
      return false;
    })
    .sort((a, b) => normalize(a.full_name || a.username).localeCompare(normalize(b.full_name || b.username)));
}

export default function NotificationDialog({ open, onClose }) {
  const [users, setUsers] = useState([]);
  const [area, setArea] = useState(AREA_OPTIONS[0]);
  const [selected, setSelected] = useState(new Set());
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const { alertDialog, dialogPortal } = useSiteDialog();

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setStatus('');
    listUsers()
      .then((data) => {
        if (!active) return;
        setUsers(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!active) return;
        setUsers([]);
        setStatus('Unable to load users for notifications.');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const filteredUsers = useMemo(() => usersForArea(users, area), [users, area]);

  useEffect(() => {
    if (!open || !status) return;
    let active = true;
    (async () => {
      const isError = status.startsWith('Unable') || status.startsWith('Select');
      await alertDialog(status, {
        title: isError ? 'Notification error' : 'Notification sent',
        confirmText: 'OK'
      });
      if (active) setStatus('');
    })();
    return () => {
      active = false;
    };
  }, [open, status, alertDialog]);

  useEffect(() => {
    if (!open) return;
    const defaults = filteredUsers
      .map((user) => user.email)
      .filter((email) => looksLikeEmail(email));
    setSelected(new Set(defaults));
  }, [filteredUsers, open]);

  const toggleRecipient = (email) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) {
        next.delete(email);
      } else {
        next.add(email);
      }
      return next;
    });
  };

  const handleSend = async () => {
    if (!selected.size) {
      setStatus('Select at least one recipient.');
      return;
    }
    setSending(true);
    setStatus('');
    const subject = `Pipeline Notification - ${area}`;
    const messageLines = message
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const body = ['Area: ' + area, messageLines.length ? 'Message: ' + messageLines[0] : null, ...messageLines.slice(1)]
      .filter(Boolean)
      .join('\n');
    try {
      await sendNotification({
        to_addresses: Array.from(selected),
        subject,
        body
      });
      setStatus('Notification sent.');
      setMessage('');
    } catch (err) {
      setStatus('Unable to send notification.');
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal notify-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Send notification</div>
          <button className="ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="notify-body">
          <div className="notify-fields">
            <label>
              Area
              <select value={area} onChange={(event) => setArea(event.target.value)}>
                {AREA_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="span-2">
              Message (optional)
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={3}
                placeholder="Add a short note for recipients"
              />
            </label>
          </div>
          <div className="notify-users">
            <div className="notify-users-title">Recipients</div>
            {loading ? <div className="muted">Loading users…</div> : null}
            <div className="notify-users-list">
              {filteredUsers.length ? (
                filteredUsers.map((user) => {
                  const email = String(user.email || '').trim();
                  const display = (user.full_name || user.username || email || 'User').trim();
                  const validEmail = looksLikeEmail(email);
                  const label = validEmail ? `${display} — ${email}` : `${display} (no email)`;
                  return (
                    <label key={user.username || email} className="notify-user">
                      <input
                        type="checkbox"
                        checked={validEmail ? selected.has(email) : false}
                        onChange={() => toggleRecipient(email)}
                        disabled={!validEmail}
                      />
                      <span>{label}</span>
                    </label>
                  );
                })
              ) : (
                <div className="muted">No users assigned to this area.</div>
              )}
            </div>
          </div>
          <div className="actions">
            <button className="ghost" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" type="button" onClick={handleSend} disabled={sending}>
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
      {dialogPortal}
    </div>
  );
}
