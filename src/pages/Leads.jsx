
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  convertLeadToProject,
  createLead,
  deleteLead,
  deleteLeadFile,
  downloadLeadFile,
  listLeadFiles,
  listLeads,
  requestLeadQuote,
  updateLead,
  uploadLeadFile
} from '../api.js';
import useSiteDialog from '../utils/useSiteDialog.jsx';
import { REQUIRED_DOC_OPTIONS, buildEmptyRequiredDocs } from '../utils/requiredDocs.js';

const STATUS_OPTIONS = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];
const PRIORITY_OPTIONS = ['high', 'mid', 'low'];
const FILTER_ALL = '__all__';
const CREATOR_COMPANY_ALL = '__all__';

function normalizePriority(value, fallback = 'mid') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return PRIORITY_OPTIONS.includes(normalized) ? normalized : fallback;
}

function formatPriority(value) {
  const normalized = normalizePriority(value, 'mid');
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatDateTime(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString();
}

function statusClass(status) {
  return `lead-status status-${status || 'new'}`;
}

function buildLeadFormState() {
  return {
    name: '',
    company: '',
    project_location_state: '',
    zip_code: '',
    email: '',
    phone: '',
    owner: '',
    priority: 'mid',
    status: 'new',
    square_footage: '',
    estimated_value: '',
    required_docs: buildEmptyRequiredDocs(),
    notes: ''
  };
}

function normalizeRequiredDocs(value) {
  const base = buildEmptyRequiredDocs();
  if (!value || typeof value !== 'object') return base;
  REQUIRED_DOC_OPTIONS.forEach((option) => {
    base[option.id] = Boolean(value[option.id]);
  });
  return base;
}

function normalizeLeadForEdit(lead) {
  return {
    ...lead,
    owner: lead?.owner || '',
    priority: normalizePriority(lead?.priority, 'mid'),
    square_footage: lead?.square_footage || '',
    estimated_value: lead?.estimated_value || '',
    zip_code: lead?.zip_code || '',
    project_location_state: lead?.project_location_state || '',
    required_docs: normalizeRequiredDocs(lead?.required_docs)
  };
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (!size) return '-';
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function getFileTypeLabel(filename) {
  const text = String(filename || '').trim();
  if (!text.includes('.')) return 'FILE';
  const extension = text.split('.').pop() || '';
  const cleaned = extension.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return cleaned ? cleaned.slice(0, 6) : 'FILE';
}

function summarizeSelection(items, emptyLabel, pluralLabel) {
  const count = Array.isArray(items) ? items.length : 0;
  if (!count) return emptyLabel;
  return count === 1 ? '1 file selected' : `${count} ${pluralLabel} selected`;
}

function queueFiles(files) {
  return files.map((file, index) => ({
    id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    file
  }));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'lead-file';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function Leads({ isAdminView = false }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [formOpen, setFormOpen] = useState(true);
  const [form, setForm] = useState(() => buildLeadFormState());
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [requestingQuote, setRequestingQuote] = useState(false);
  const [convertingLead, setConvertingLead] = useState(false);
  const [createFiles, setCreateFiles] = useState([]);
  const [createFileDragActive, setCreateFileDragActive] = useState(false);
  const [editFiles, setEditFiles] = useState([]);
  const [newEditFiles, setNewEditFiles] = useState([]);
  const [editFilesStatus, setEditFilesStatus] = useState('');
  const [filters, setFilters] = useState({
    name: '',
    company: '',
    project_location_state: '',
    zip_code: '',
    owner: '',
    priority: FILTER_ALL,
    status: FILTER_ALL,
    quote_requested: FILTER_ALL,
    created: '',
    email: '',
    phone: '',
    creator_company: CREATOR_COMPANY_ALL
  });
  const { alertDialog, confirmDialog, promptDialog, dialogPortal } = useSiteDialog();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listLeads();
      setLeads(Array.isArray(data) ? data : []);
      setMessage('');
    } catch (_error) {
      setMessage('Unable to load leads.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const uploadFilesToLead = useCallback(async (leadId, files) => {
    let uploaded = 0;
    let failed = 0;
    for (const file of files) {
      try {
        await uploadLeadFile(leadId, file, { filename: file.name, content_type: file.type || undefined });
        uploaded += 1;
      } catch (_error) {
        failed += 1;
      }
    }
    return { uploaded, failed };
  }, []);

  const handleSelectCreateFiles = useCallback((event) => {
    const picked = Array.from(event.target.files || []);
    setCreateFiles(queueFiles(picked));
  }, []);

  const handleCreateFileDrop = useCallback((event) => {
    event.preventDefault();
    setCreateFileDragActive(false);
    const dropped = Array.from(event.dataTransfer?.files || []);
    if (!dropped.length) return;
    setCreateFiles(queueFiles(dropped));
  }, []);

  const removeQueuedCreateFile = useCallback((fileId) => {
    setCreateFiles((prev) => prev.filter((item) => item.id !== fileId));
  }, []);

  const loadLeadFiles = useCallback(async (leadId) => {
    if (!leadId) return;
    try {
      const data = await listLeadFiles(leadId);
      setEditFiles(Array.isArray(data) ? data : []);
      setEditFilesStatus('');
    } catch (_error) {
      setEditFiles([]);
      setEditFilesStatus('Unable to load lead files.');
    }
  }, []);

  const creatorCompanyOptions = useMemo(() => {
    if (!isAdminView) return [];
    const map = new Map();
    leads.forEach((lead) => {
      const company = String(lead?.created_by_company || '').trim();
      if (!company) return;
      map.set(company.toLowerCase(), company);
    });
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [isAdminView, leads]);

  const filteredRows = useMemo(() => {
    return leads.filter((lead) => {
      const name = String(lead?.name || '').trim();
      const owner = String(lead?.owner || '').trim();
      const company = String(lead?.company || '').trim();
      const state = String(lead?.project_location_state || '').trim();
      const zip = String(lead?.zip_code || '').trim();
      const email = String(lead?.email || '').trim();
      const phone = String(lead?.phone || '').trim();
      const created = formatDateTime(lead?.created_at);
      const creatorCompany = String(lead?.created_by_company || '').trim();
      const priority = normalizePriority(lead?.priority, 'mid');
      const status = String(lead?.status || '').trim().toLowerCase();
      const hasQuote = Boolean(lead?.quote_requested_at);
      if (filters.name && !name.toLowerCase().includes(filters.name.toLowerCase())) return false;
      if (filters.company && !company.toLowerCase().includes(filters.company.toLowerCase())) return false;
      if (filters.project_location_state && !state.toLowerCase().includes(filters.project_location_state.toLowerCase()))
        return false;
      if (filters.zip_code && !zip.toLowerCase().includes(filters.zip_code.toLowerCase())) return false;
      if (filters.owner && !owner.toLowerCase().includes(filters.owner.toLowerCase())) return false;
      if (filters.email && !email.toLowerCase().includes(filters.email.toLowerCase())) return false;
      if (filters.phone && !phone.toLowerCase().includes(filters.phone.toLowerCase())) return false;
      if (filters.created && !created.toLowerCase().includes(filters.created.toLowerCase())) return false;
      if (filters.status !== FILTER_ALL && status !== String(filters.status).toLowerCase()) return false;
      if (filters.priority !== FILTER_ALL && priority !== String(filters.priority).toLowerCase()) return false;
      if (filters.quote_requested === 'requested' && !hasQuote) return false;
      if (filters.quote_requested === 'pending' && hasQuote) return false;
      if (
        isAdminView &&
        filters.creator_company !== CREATOR_COMPANY_ALL &&
        creatorCompany.toLowerCase() !== String(filters.creator_company).toLowerCase()
      )
        return false;
      return true;
    });
  }, [leads, filters, isAdminView]);

  const handleCreateLead = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setMessage('Lead name is required.');
      return;
    }
    setSaving(true);
    try {
      const created = await createLead({
        ...form,
        name: form.name.trim(),
        priority: normalizePriority(form.priority, 'mid'),
        required_docs: normalizeRequiredDocs(form.required_docs)
      });
      if (createFiles.length) {
        await uploadFilesToLead(
          created.id,
          createFiles.map((item) => item.file)
        );
      }
      setForm(buildLeadFormState());
      setCreateFiles([]);
      setMessage('Lead added.');
      await refresh();
    } catch (_error) {
      setMessage('Unable to add lead.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateLead = async () => {
    if (!editing) return;
    try {
      const updated = await updateLead(editing.id, {
        name: editing.name,
        company: editing.company,
        project_location_state: editing.project_location_state,
        zip_code: editing.zip_code,
        email: editing.email,
        phone: editing.phone,
        owner: editing.owner,
        priority: normalizePriority(editing.priority, 'mid'),
        status: editing.status,
        square_footage: editing.square_footage,
        estimated_value: editing.estimated_value,
        required_docs: normalizeRequiredDocs(editing.required_docs),
        notes: editing.notes
      });
      if (newEditFiles.length) {
        await uploadFilesToLead(editing.id, newEditFiles);
        setNewEditFiles([]);
        await loadLeadFiles(editing.id);
      }
      setEditing(normalizeLeadForEdit(updated));
      setMessage('Lead updated.');
      await refresh();
    } catch (_error) {
      setMessage('Unable to update lead.');
    }
  };

  const handleDeleteLead = async (leadId) => {
    const ok = await confirmDialog('Delete this lead?', { title: 'Delete lead', confirmText: 'Delete' });
    if (!ok) return;
    try {
      await deleteLead(leadId);
      setEditing(null);
      setMessage('Lead deleted.');
      await refresh();
    } catch (_error) {
      setMessage('Unable to delete lead.');
    }
  };

  const handleRequestQuote = async () => {
    if (!editing?.id) return;
    const enteredPriority = await promptDialog('Set quote priority (high, mid, low).', {
      title: 'Request project quote',
      defaultValue: normalizePriority(editing.priority, 'mid'),
      confirmText: 'Send request'
    });
    if (enteredPriority === null) return;
    const priority = normalizePriority(enteredPriority, '');
    if (!priority) {
      await alertDialog('Priority must be high, mid, or low.', { title: 'Invalid priority' });
      return;
    }
    const note = await promptDialog('Optional note for admin notification.', {
      title: 'Quote request note',
      defaultValue: '',
      confirmText: 'Continue'
    });
    if (note === null) return;
    setRequestingQuote(true);
    try {
      const updated = await requestLeadQuote(editing.id, {
        priority,
        note: String(note || '').trim() || undefined
      });
      setEditing(normalizeLeadForEdit(updated));
      setMessage(`Quote requested (${formatPriority(priority)} priority).`);
      await refresh();
    } catch (_error) {
      await alertDialog('Unable to request project quote.', { title: 'Quote request' });
    } finally {
      setRequestingQuote(false);
    }
  };

  const handleConvertLead = async () => {
    if (!editing?.id) return;
    const ok = await confirmDialog('Convert this lead into a project now?', {
      title: 'Convert lead',
      confirmText: 'Convert'
    });
    if (!ok) return;
    setConvertingLead(true);
    try {
      const project = await convertLeadToProject(editing.id);
      setMessage(
        `Lead converted to project${project?.project_number ? ` ${project.project_number}` : ''}${
          project?.name ? ` - ${project.name}` : ''
        }.`
      );
      await refresh();
      setEditing((prev) =>
        prev
          ? {
              ...prev,
              converted_project_id: project?.id || prev.converted_project_id,
              status: 'won'
            }
          : prev
      );
    } catch (_error) {
      await alertDialog('Unable to convert this lead to project.', { title: 'Convert lead' });
    } finally {
      setConvertingLead(false);
    }
  };

  const tableColCount = isAdminView ? 12 : 11;

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Leads</h2>
            <p className="muted">Track contractor leads.</p>
          </div>
          <div className="detail-header-actions lead-toolbar">
            <button
              className="ghost lead-intake-toggle"
              type="button"
              aria-expanded={formOpen}
              onClick={() => setFormOpen((prev) => !prev)}
            >
              <span className="lead-intake-toggle-arrow">{formOpen ? '^' : 'v'}</span>
              <span>{formOpen ? 'Lead intake' : 'Lead intake'}</span>
            </button>
          </div>
        </div>

        {message ? <p className="muted lead-message">{message}</p> : null}

        {formOpen ? (
          <form className="lead-form" onSubmit={handleCreateLead}>
            <div className="form-grid lead-create-grid">
              <label>
                Lead name
                <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
              </label>
              <label>
                Company
                <input value={form.company} onChange={(event) => setForm((prev) => ({ ...prev, company: event.target.value }))} />
              </label>
              <label>
                Project Location (State)
                <input
                  value={form.project_location_state}
                  placeholder="AZ"
                  onChange={(event) => setForm((prev) => ({ ...prev, project_location_state: event.target.value }))}
                />
              </label>
              <label>
                Zip code
                <input
                  value={form.zip_code}
                  placeholder="85260"
                  onChange={(event) => setForm((prev) => ({ ...prev, zip_code: event.target.value }))}
                />
              </label>
              <label>
                Email
                <input value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} />
              </label>
              <label>
                Phone
                <input value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} />
              </label>
              <label>
                Lead owner
                <input value={form.owner} onChange={(event) => setForm((prev) => ({ ...prev, owner: event.target.value }))} />
              </label>
              <label>
                Priority
                <select value={form.priority} onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value }))}>
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {formatPriority(option)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}>
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sqr footage
                <input
                  value={form.square_footage}
                  onChange={(event) => setForm((prev) => ({ ...prev, square_footage: event.target.value }))}
                />
              </label>
              <label>
                Estimated value
                <input
                  value={form.estimated_value}
                  onChange={(event) => setForm((prev) => ({ ...prev, estimated_value: event.target.value }))}
                />
              </label>
              <label className="lead-notes-field">
                Notes
                <textarea value={form.notes} rows={5} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} />
              </label>
              <div className="intake-docs lead-docs-block">
                <div className="intake-docs-title">Required docs</div>
                <div className="intake-docs-grid">
                  {REQUIRED_DOC_OPTIONS.map((option) => (
                    <label key={option.id} className="intake-doc-option">
                      <input
                        type="checkbox"
                        checked={Boolean(form.required_docs?.[option.id])}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            required_docs: { ...prev.required_docs, [option.id]: event.target.checked }
                          }))
                        }
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="intake-upload-section lead-upload-section">
                <div className="intake-docs-title">Files</div>
                <div className="file-upload-form">
                  <div
                    className={`file-upload-row${createFileDragActive ? ' drag-active' : ''}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'copy';
                    }}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setCreateFileDragActive(true);
                    }}
                    onDragLeave={(event) => {
                      event.preventDefault();
                      setCreateFileDragActive(false);
                    }}
                    onDrop={handleCreateFileDrop}
                  >
                    <div className="file-drop-hint">
                      <span className="file-drop-icon" aria-hidden="true">
                        +
                      </span>
                      <span>{createFileDragActive ? 'Drop files to upload' : 'Drag and drop files here'}</span>
                    </div>
                    <span className="file-upload-name">
                      {summarizeSelection(createFiles, 'No files selected', 'files')}
                    </span>
                  </div>
                  <div className="file-upload-actions">
                    <div className="file-upload-controls">
                      <input
                        id="lead-intake-file-upload"
                        className="file-upload-input"
                        type="file"
                        multiple
                        onChange={handleSelectCreateFiles}
                      />
                      <label htmlFor="lead-intake-file-upload" className="ghost file-upload-button">
                        Choose files
                      </label>
                    </div>
                    <span className="file-upload-selected">
                      {summarizeSelection(createFiles, 'No files selected', 'files')}
                    </span>
                  </div>
                </div>
                <div className="photo-gallery-panel">
                  {createFiles.length ? (
                    <div className="photo-gallery upload-card-gallery">
                      {createFiles.map((item) => (
                        <div key={item.id} className="photo-card file-card compact-upload-card">
                          <div className="photo-thumb-wrap file-thumb-wrap">
                            <div className="file-thumb-placeholder">
                              <span className="file-thumb-type">{getFileTypeLabel(item.file.name)}</span>
                            </div>
                          </div>
                          <div className="photo-meta">
                            <div className="photo-name" title={item.file.name}>
                              {item.file.name}
                            </div>
                            <div className="photo-sub muted">
                              <span>{new Date(item.file.lastModified).toLocaleString()}</span>
                              <span>{formatBytes(item.file.size)}</span>
                            </div>
                          </div>
                          <button className="ghost tiny-button" type="button" onClick={() => removeQueuedCreateFile(item.id)}>
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No files selected yet.</p>
                  )}
                </div>
              </div>
            </div>
            <div className="lead-actions">
              <button className="primary" type="submit" disabled={saving}>
                {saving ? 'Adding...' : 'Add lead'}
              </button>
            </div>
          </form>
        ) : null}

        {loading ? <p className="muted">Loading leads...</p> : null}
        <div className="table-scroll">
          <table className="project-table lead-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Company</th>
                <th>State</th>
                <th>Zip</th>
                <th>Owner</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Quote requested</th>
                <th>Created</th>
                <th>Email</th>
                <th>Phone</th>
                {isAdminView ? <th>Creator company</th> : null}
              </tr>
              <tr className="lead-filter-row">
                <th>
                  <input
                    className="lead-filter-control"
                    placeholder="Filter"
                    value={filters.name}
                    onChange={(event) => setFilters((prev) => ({ ...prev, name: event.target.value }))}
                  />
                </th>
                <th>
                  <input
                    className="lead-filter-control"
                    placeholder="Filter"
                    value={filters.company}
                    onChange={(event) => setFilters((prev) => ({ ...prev, company: event.target.value }))}
                  />
                </th>
                <th>
                  <input
                    className="lead-filter-control"
                    placeholder="Filter"
                    value={filters.project_location_state}
                    onChange={(event) => setFilters((prev) => ({ ...prev, project_location_state: event.target.value }))}
                  />
                </th>
                <th>
                  <input
                    className="lead-filter-control"
                    placeholder="Filter"
                    value={filters.zip_code}
                    onChange={(event) => setFilters((prev) => ({ ...prev, zip_code: event.target.value }))}
                  />
                </th>
                <th>
                  <input
                    className="lead-filter-control"
                    placeholder="Filter"
                    value={filters.owner}
                    onChange={(event) => setFilters((prev) => ({ ...prev, owner: event.target.value }))}
                  />
                </th>
                <th>
                  <select
                    className="lead-filter-control"
                    value={filters.priority}
                    onChange={(event) => setFilters((prev) => ({ ...prev, priority: event.target.value }))}
                  >
                    <option value={FILTER_ALL}>All</option>
                    {PRIORITY_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {formatPriority(option)}
                      </option>
                    ))}
                  </select>
                </th>
                <th>
                  <select
                    className="lead-filter-control"
                    value={filters.status}
                    onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
                  >
                    <option value={FILTER_ALL}>All</option>
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </th>
                <th>
                  <select
                    className="lead-filter-control"
                    value={filters.quote_requested}
                    onChange={(event) => setFilters((prev) => ({ ...prev, quote_requested: event.target.value }))}
                  >
                    <option value={FILTER_ALL}>All</option>
                    <option value="requested">Requested</option>
                    <option value="pending">Not requested</option>
                  </select>
                </th>
                <th>
                  <input
                    className="lead-filter-control"
                    placeholder="Filter"
                    value={filters.created}
                    onChange={(event) => setFilters((prev) => ({ ...prev, created: event.target.value }))}
                  />
                </th>
                <th>
                  <input
                    className="lead-filter-control"
                    placeholder="Filter"
                    value={filters.email}
                    onChange={(event) => setFilters((prev) => ({ ...prev, email: event.target.value }))}
                  />
                </th>
                <th>
                  <input
                    className="lead-filter-control"
                    placeholder="Filter"
                    value={filters.phone}
                    onChange={(event) => setFilters((prev) => ({ ...prev, phone: event.target.value }))}
                  />
                </th>
                {isAdminView ? (
                  <th>
                    <select
                      className="lead-filter-control"
                      value={filters.creator_company}
                      onChange={(event) => setFilters((prev) => ({ ...prev, creator_company: event.target.value }))}
                    >
                      <option value={CREATOR_COMPANY_ALL}>All</option>
                      {creatorCompanyOptions.map((company) => (
                        <option key={company} value={company}>
                          {company}
                        </option>
                      ))}
                    </select>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length ? (
                filteredRows.map((lead) => (
                  <tr
                    key={lead.id}
                    onDoubleClick={async () => {
                      const next = normalizeLeadForEdit(lead);
                      setEditing(next);
                      await loadLeadFiles(lead.id);
                    }}
                  >
                    <td>{lead.name}</td>
                    <td>{lead.company || '-'}</td>
                    <td>{lead.project_location_state || '-'}</td>
                    <td>{lead.zip_code || '-'}</td>
                    <td>{lead.owner || '-'}</td>
                    <td>{formatPriority(lead.priority)}</td>
                    <td>
                      <span className={statusClass(lead.status)}>{lead.status}</span>
                    </td>
                    <td>{lead.quote_requested_at ? formatDateTime(lead.quote_requested_at) : '-'}</td>
                    <td>{formatDateTime(lead.created_at)}</td>
                    <td>{lead.email || '-'}</td>
                    <td>{lead.phone || '-'}</td>
                    {isAdminView ? <td>{lead.created_by_company || '-'}</td> : null}
                  </tr>
                ))
              ) : (
                <tr className="empty-row">
                  <td colSpan={tableColCount}>No leads match current filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {editing ? (
          <div className="modal-backdrop" onClick={() => setEditing(null)}>
            <div className="modal lead-modal" onClick={(event) => event.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">Edit lead</div>
                <button className="ghost" type="button" onClick={() => setEditing(null)}>
                  Close
                </button>
              </div>
              <div className="lead-edit-card">
                <div className="lead-modal-actions">
                  <button className="primary" type="button" onClick={handleRequestQuote} disabled={requestingQuote}>
                    {requestingQuote ? 'Requesting...' : 'Request project quote'}
                  </button>
                  <button className="ghost" type="button" onClick={handleConvertLead} disabled={convertingLead}>
                    {convertingLead ? 'Converting...' : 'Convert to project'}
                  </button>
                </div>
                <div className="form-grid">
                  <label>
                    Lead name
                    <input value={editing.name} onChange={(event) => setEditing((prev) => ({ ...prev, name: event.target.value }))} />
                  </label>
                  <label>
                    Company
                    <input value={editing.company || ''} onChange={(event) => setEditing((prev) => ({ ...prev, company: event.target.value }))} />
                  </label>
                  <label>
                    Project Location (State)
                    <input
                      value={editing.project_location_state || ''}
                      onChange={(event) => setEditing((prev) => ({ ...prev, project_location_state: event.target.value }))}
                    />
                  </label>
                  <label>
                    Zip code
                    <input value={editing.zip_code || ''} onChange={(event) => setEditing((prev) => ({ ...prev, zip_code: event.target.value }))} />
                  </label>
                  <label>
                    Email
                    <input value={editing.email || ''} onChange={(event) => setEditing((prev) => ({ ...prev, email: event.target.value }))} />
                  </label>
                  <label>
                    Phone
                    <input value={editing.phone || ''} onChange={(event) => setEditing((prev) => ({ ...prev, phone: event.target.value }))} />
                  </label>
                  <label>
                    Lead owner
                    <input value={editing.owner || ''} onChange={(event) => setEditing((prev) => ({ ...prev, owner: event.target.value }))} />
                  </label>
                  <label>
                    Priority
                    <select value={editing.priority || 'mid'} onChange={(event) => setEditing((prev) => ({ ...prev, priority: event.target.value }))}>
                      {PRIORITY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {formatPriority(option)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Status
                    <select value={editing.status || 'new'} onChange={(event) => setEditing((prev) => ({ ...prev, status: event.target.value }))}>
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Sqr footage
                    <input value={editing.square_footage || ''} onChange={(event) => setEditing((prev) => ({ ...prev, square_footage: event.target.value }))} />
                  </label>
                  <label>
                    Estimated value
                    <input value={editing.estimated_value || ''} onChange={(event) => setEditing((prev) => ({ ...prev, estimated_value: event.target.value }))} />
                  </label>
                  <label className="span-2">
                    Created
                    <div className="field-static">{formatDateTime(editing.created_at)}</div>
                  </label>
                  <label className="span-2">
                    Quote requested
                    <div className="field-static">
                      {editing.quote_requested_at
                        ? `${formatDateTime(editing.quote_requested_at)}${editing.quote_requested_by ? ` by ${editing.quote_requested_by}` : ''}`
                        : 'Not requested'}
                    </div>
                  </label>
                  <label className="span-2">
                    Notes
                    <textarea value={editing.notes || ''} rows={4} onChange={(event) => setEditing((prev) => ({ ...prev, notes: event.target.value }))} />
                  </label>
                </div>

                <div className="intake-docs lead-docs-block">
                  <div className="intake-docs-title">Required docs</div>
                  <div className="intake-docs-grid">
                    {REQUIRED_DOC_OPTIONS.map((option) => (
                      <label key={option.id} className="intake-doc-option">
                        <input
                          type="checkbox"
                          checked={Boolean(editing.required_docs?.[option.id])}
                          onChange={(event) =>
                            setEditing((prev) => ({
                              ...prev,
                              required_docs: { ...prev.required_docs, [option.id]: event.target.checked }
                            }))
                          }
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="lead-files-panel">
                  <label>
                    Upload lead files
                    <input type="file" multiple onChange={(event) => setNewEditFiles(Array.from(event.target.files || []))} />
                  </label>
                  <div className="muted">
                    {newEditFiles.length ? `${newEditFiles.length} file(s) selected` : 'No files selected'}
                  </div>
                  {editFilesStatus ? <p className="muted">{editFilesStatus}</p> : null}
                  <div className="table-scroll">
                    <table className="project-table">
                      <thead>
                        <tr>
                          <th>File</th>
                          <th>Uploaded</th>
                          <th>Size</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {editFiles.length ? (
                          editFiles.map((file) => (
                            <tr key={file.id}>
                              <td>{file.filename}</td>
                              <td>{formatDateTime(file.created_at)}</td>
                              <td>{formatBytes(file.size_bytes)}</td>
                              <td>
                                <div className="lead-file-actions-inline">
                                  <button
                                    className="ghost tiny-button"
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        const blob = await downloadLeadFile(editing.id, file.id);
                                        downloadBlob(blob, file.filename);
                                      } catch (_error) {
                                        await alertDialog('Unable to download lead file.', { title: 'Lead files' });
                                      }
                                    }}
                                  >
                                    Download
                                  </button>
                                  <button
                                    className="ghost tiny-button"
                                    type="button"
                                    onClick={async () => {
                                      const ok = await confirmDialog('Delete this file?', {
                                        title: 'Delete file',
                                        confirmText: 'Delete'
                                      });
                                      if (!ok) return;
                                      await deleteLeadFile(editing.id, file.id);
                                      await loadLeadFiles(editing.id);
                                    }}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr className="empty-row">
                            <td colSpan={4}>No files uploaded yet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="actions">
                  <button className="ghost" type="button" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                  <button className="danger" type="button" onClick={() => handleDeleteLead(editing.id)}>
                    Delete
                  </button>
                  <button className="primary" type="button" onClick={handleUpdateLead}>
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </section>
      {dialogPortal}
    </>
  );
}
