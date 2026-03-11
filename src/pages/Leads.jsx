import React, { useEffect, useMemo, useState } from 'react';
import { createLead, deleteLead, listLeads, updateLead } from '../api.js';

const STATUS_OPTIONS = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];
const CREATOR_COMPANY_ALL = '__all__';

function statusClass(status) {
  return `lead-status status-${status || 'new'}`;
}

export default function Leads({ isAdminView = false }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    name: '',
    company: '',
    email: '',
    phone: '',
    status: 'new',
    notes: ''
  });
  const [editing, setEditing] = useState(null);
  const [creatorCompanyFilter, setCreatorCompanyFilter] = useState(CREATOR_COMPANY_ALL);

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await listLeads();
      setLeads(Array.isArray(data) ? data : []);
      setMessage('');
    } catch (err) {
      setMessage('Unable to load leads.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setMessage('Lead name is required.');
      return;
    }
    try {
      await createLead({ ...form, name: form.name.trim() });
      setForm({ name: '', company: '', email: '', phone: '', status: 'new', notes: '' });
      setMessage('Lead added.');
      refresh();
    } catch (err) {
      setMessage('Unable to add lead.');
    }
  };

  const handleUpdate = async () => {
    if (!editing) return;
    try {
      await updateLead(editing.id, {
        name: editing.name,
        company: editing.company,
        email: editing.email,
        phone: editing.phone,
        status: editing.status,
        notes: editing.notes
      });
      setEditing(null);
      setMessage('Lead updated.');
      refresh();
    } catch (err) {
      setMessage('Unable to update lead.');
    }
  };

  const handleDelete = async (leadId) => {
    if (!leadId) return;
    if (!window.confirm('Delete this lead?')) return;
    try {
      await deleteLead(leadId);
      setMessage('Lead deleted.');
      refresh();
    } catch (err) {
      setMessage('Unable to delete lead.');
    }
  };

  const creatorCompanyOptions = useMemo(() => {
    if (!isAdminView) return [];
    const seen = new Map();
    leads.forEach((lead) => {
      const value = String(lead?.created_by_company || '').trim();
      if (!value) return;
      const key = value.toLowerCase();
      if (!seen.has(key)) seen.set(key, value);
    });
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [leads, isAdminView]);

  useEffect(() => {
    if (!isAdminView) return;
    if (creatorCompanyFilter === CREATOR_COMPANY_ALL) return;
    const selected = String(creatorCompanyFilter || '').trim().toLowerCase();
    const stillExists = creatorCompanyOptions.some(
      (option) => String(option || '').trim().toLowerCase() === selected
    );
    if (!stillExists) {
      setCreatorCompanyFilter(CREATOR_COMPANY_ALL);
    }
  }, [creatorCompanyFilter, creatorCompanyOptions, isAdminView]);

  const rows = useMemo(() => {
    if (!isAdminView || creatorCompanyFilter === CREATOR_COMPANY_ALL) return leads;
    const selected = String(creatorCompanyFilter || '').trim().toLowerCase();
    if (!selected) return leads;
    return leads.filter(
      (lead) => String(lead?.created_by_company || '').trim().toLowerCase() === selected
    );
  }, [leads, isAdminView, creatorCompanyFilter]);

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Leads</h2>
          <p className="muted">Track contractor leads.</p>
        </div>
        <div className="detail-header-actions">
          {isAdminView ? (
            <label className="pipeline-area-select">
              <span className="muted">Creator company</span>
              <select
                value={creatorCompanyFilter}
                onChange={(event) => setCreatorCompanyFilter(event.target.value)}
              >
                <option value={CREATOR_COMPANY_ALL}>All</option>
                {creatorCompanyOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {message ? <span className="muted">{message}</span> : null}
        </div>
      </div>

      <form className="lead-form" onSubmit={handleSubmit}>
        <div className="form-grid lead-create-grid">
          <label>
            Lead name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Company
            <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          </label>
          <label>
            Email
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label>
            Phone
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <label>
            Status
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="lead-notes-field">
            Notes
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={6} />
          </label>
        </div>
        <div className="lead-actions">
          <button className="primary" type="submit">Add lead</button>
        </div>
      </form>

      {loading ? <p className="muted">Loading leads...</p> : null}
      <div className="table-scroll">
        <table className="project-table lead-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Company</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Status</th>
              {isAdminView ? <th>Creator company</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((lead) => (
                <tr key={lead.id} onDoubleClick={() => setEditing({ ...lead })}>
                  <td>{lead.name}</td>
                  <td>{lead.company || '-'}</td>
                  <td>{lead.email || '-'}</td>
                  <td>{lead.phone || '-'}</td>
                  <td>
                    <span className={statusClass(lead.status)}>{lead.status}</span>
                  </td>
                  {isAdminView ? <td>{lead.created_by_company || '-'}</td> : null}
                </tr>
              ))
            ) : (
              <tr className="empty-row">
                <td colSpan={isAdminView ? 6 : 5}>
                  {isAdminView && creatorCompanyFilter !== CREATOR_COMPANY_ALL
                    ? 'No leads match that creator company.'
                    : 'No leads yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing ? (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal lead-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Edit lead</div>
              <button className="ghost" type="button" onClick={() => setEditing(null)}>Close</button>
            </div>
            <div className="lead-edit-card">
              <div className="form-grid">
                <label>
                  Lead name
                  <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                </label>
                <label>
                  Company
                  <input value={editing.company || ''} onChange={(e) => setEditing({ ...editing, company: e.target.value })} />
                </label>
                <label>
                  Email
                  <input value={editing.email || ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
                </label>
                <label>
                  Phone
                  <input value={editing.phone || ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
                </label>
                <label>
                  Status
                  <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <label className="span-2">
                  Notes
                  <textarea value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} rows={2} />
                </label>
              </div>
              <div className="actions">
                <button className="ghost" type="button" onClick={() => setEditing(null)}>Cancel</button>
                <button className="danger" type="button" onClick={() => handleDelete(editing.id)}>Delete</button>
                <button className="primary" type="button" onClick={handleUpdate}>Save</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
