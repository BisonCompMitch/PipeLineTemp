import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createLead,
  deleteLead,
  deleteLeadFile,
  downloadLeadFile,
  listLeadFiles,
  listLeads,
  updateLead,
  uploadLeadFile
} from '../api.js';
import useSiteDialog from '../utils/useSiteDialog.jsx';

const STATUS_OPTIONS = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];
const CREATOR_COMPANY_ALL = '__all__';

function statusClass(status) {
  return `lead-status status-${status || 'new'}`;
}

function summarizeSelection(items, emptyLabel, noun) {
  if (!items.length) return emptyLabel;
  if (items.length === 1) return items[0].file.name;
  return `${items.length} ${noun} selected`;
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (!size) return '-';
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function getFileTypeLabel(filename) {
  const name = String(filename || '').trim();
  if (!name.includes('.')) return 'FILE';
  const ext = name.split('.').pop();
  if (!ext) return 'FILE';
  return ext.slice(0, 5).toUpperCase();
}

function toUploadItems(fileList) {
  return fileList.map((file, index) => ({
    id: `${file.name}-${file.size}-${file.lastModified}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    file
  }));
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'download';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
  const [queuedFiles, setQueuedFiles] = useState([]);
  const [fileDragActive, setFileDragActive] = useState(false);
  const [editingQueuedFiles, setEditingQueuedFiles] = useState([]);
  const [editingFileDragActive, setEditingFileDragActive] = useState(false);
  const [editingFiles, setEditingFiles] = useState([]);
  const [editingFilesLoading, setEditingFilesLoading] = useState(false);
  const [editingFilesStatus, setEditingFilesStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [creatorCompanyFilter, setCreatorCompanyFilter] = useState(CREATOR_COMPANY_ALL);
  const { alertDialog, confirmDialog, dialogPortal } = useSiteDialog();

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

  const uploadQueuedFiles = useCallback(async (leadId, items) => {
    let uploaded = 0;
    let failed = 0;
    for (const item of items) {
      try {
        await uploadLeadFile(leadId, item.file, {
          filename: item.file.name,
          content_type: item.file.type || undefined
        });
        uploaded += 1;
      } catch (_error) {
        failed += 1;
      }
    }
    return { uploaded, failed };
  }, []);

  const addCreateQueuedFiles = useCallback((files) => {
    const selected = Array.from(files || []).filter(Boolean);
    if (!selected.length) return;
    setQueuedFiles((prev) => [...prev, ...toUploadItems(selected)]);
  }, []);

  const addEditingQueuedFiles = useCallback((files) => {
    const selected = Array.from(files || []).filter(Boolean);
    if (!selected.length) return;
    setEditingQueuedFiles((prev) => [...prev, ...toUploadItems(selected)]);
  }, []);

  const loadLeadFilesForEdit = useCallback(async (leadId) => {
    if (!leadId) return;
    setEditingFilesLoading(true);
    try {
      const data = await listLeadFiles(leadId);
      setEditingFiles(Array.isArray(data) ? data : []);
      setEditingFilesStatus('');
    } catch (_error) {
      setEditingFiles([]);
      setEditingFilesStatus('Unable to load lead files.');
    } finally {
      setEditingFilesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!editing?.id) {
      setEditingFiles([]);
      setEditingQueuedFiles([]);
      setEditingFilesStatus('');
      setEditingFileDragActive(false);
      return;
    }
    loadLeadFilesForEdit(editing.id);
  }, [editing?.id, loadLeadFilesForEdit]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setMessage('Lead name is required.');
      return;
    }
    setSaving(true);
    try {
      const created = await createLead({ ...form, name: form.name.trim() });
      let nextMessage = 'Lead added.';
      if (queuedFiles.length) {
        const result = await uploadQueuedFiles(created.id, queuedFiles);
        if (result.failed > 0) {
          nextMessage = `Lead added. Uploaded ${result.uploaded}/${queuedFiles.length} files.`;
        } else {
          nextMessage = `Lead added with ${result.uploaded} file${result.uploaded === 1 ? '' : 's'}.`;
        }
      }
      setForm({ name: '', company: '', email: '', phone: '', status: 'new', notes: '' });
      setQueuedFiles([]);
      setMessage(nextMessage);
      await refresh();
    } catch (err) {
      setMessage('Unable to add lead.');
    } finally {
      setSaving(false);
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

  const handleUploadEditingFiles = async () => {
    if (!editing?.id || !editingQueuedFiles.length) return;
    setEditingFilesLoading(true);
    try {
      const result = await uploadQueuedFiles(editing.id, editingQueuedFiles);
      setEditingQueuedFiles([]);
      await loadLeadFilesForEdit(editing.id);
      if (result.failed > 0) {
        setEditingFilesStatus(`Uploaded ${result.uploaded}/${result.uploaded + result.failed} files.`);
      } else {
        setEditingFilesStatus(`Uploaded ${result.uploaded} file${result.uploaded === 1 ? '' : 's'}.`);
      }
    } catch (_error) {
      setEditingFilesStatus('Unable to upload lead files.');
    } finally {
      setEditingFilesLoading(false);
    }
  };

  const handleDownloadEditingFile = async (fileRecord) => {
    if (!editing?.id || !fileRecord?.id) return;
    try {
      const blob = await downloadLeadFile(editing.id, fileRecord.id);
      triggerBlobDownload(blob, fileRecord.filename || 'lead-file');
    } catch (_error) {
      await alertDialog('Unable to download lead file.', { title: 'Lead files' });
    }
  };

  const handleDeleteEditingFile = async (fileRecord) => {
    if (!editing?.id || !fileRecord?.id) return;
    const shouldDelete = await confirmDialog('Delete this file?', {
      title: 'Delete file',
      confirmText: 'Delete'
    });
    if (!shouldDelete) return;
    try {
      await deleteLeadFile(editing.id, fileRecord.id);
      await loadLeadFilesForEdit(editing.id);
      setEditingFilesStatus('File deleted.');
    } catch (_error) {
      setEditingFilesStatus('Unable to delete lead file.');
    }
  };

  const handleDelete = async (leadId) => {
    if (!leadId) return;
    const shouldDelete = await confirmDialog('Delete this lead?', {
      title: 'Delete lead',
      confirmText: 'Delete'
    });
    if (!shouldDelete) return;
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

  const openEditingLead = (lead) => {
    setEditing({ ...lead });
    setEditingQueuedFiles([]);
    setEditingFilesStatus('');
  };

  return (
    <>
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
          <div className="intake-upload-section lead-upload-section">
            <div className="intake-docs-title">Files</div>
            <div className="file-upload-form">
              <div
                className={`file-upload-row${fileDragActive ? ' drag-active' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'copy';
                }}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setFileDragActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setFileDragActive(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setFileDragActive(false);
                  addCreateQueuedFiles(event.dataTransfer?.files || []);
                }}
              >
                <div className="file-drop-hint">
                  <span className="file-drop-icon" aria-hidden="true">
                    +
                  </span>
                  <span>{fileDragActive ? 'Drop files to attach' : 'Drag and drop files here'}</span>
                </div>
                <span className="file-upload-name">
                  {summarizeSelection(queuedFiles, 'No files selected', 'files')}
                </span>
              </div>
              <div className="file-upload-actions">
                <div className="file-upload-controls">
                  <input
                    id="lead-create-upload"
                    className="file-upload-input"
                    type="file"
                    multiple
                    onChange={(event) => {
                      addCreateQueuedFiles(event.target.files || []);
                      event.target.value = '';
                    }}
                  />
                  <label htmlFor="lead-create-upload" className="ghost file-upload-button">
                    Choose files
                  </label>
                </div>
                <span className="file-upload-selected">
                  {summarizeSelection(queuedFiles, 'No files selected', 'files')}
                </span>
              </div>
            </div>
            <div className="photo-gallery-panel">
              {queuedFiles.length ? (
                <div className="photo-gallery upload-card-gallery">
                  {queuedFiles.map((item) => (
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
                      <button
                        className="ghost tiny-button"
                        type="button"
                        onClick={() => setQueuedFiles((prev) => prev.filter((entry) => entry.id !== item.id))}
                      >
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
            {saving ? 'Adding lead...' : 'Add lead'}
          </button>
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
                <tr key={lead.id} onDoubleClick={() => openEditingLead(lead)}>
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
              <div className="intake-upload-section lead-upload-section">
                <div className="lead-files-header">
                  <div className="intake-docs-title">Files</div>
                  <button
                    className="ghost tiny-button"
                    type="button"
                    onClick={() => loadLeadFilesForEdit(editing.id)}
                    disabled={editingFilesLoading}
                  >
                    Refresh
                  </button>
                </div>
                <div className="file-upload-form">
                  <div
                    className={`file-upload-row${editingFileDragActive ? ' drag-active' : ''}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'copy';
                    }}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setEditingFileDragActive(true);
                    }}
                    onDragLeave={(event) => {
                      event.preventDefault();
                      setEditingFileDragActive(false);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      setEditingFileDragActive(false);
                      addEditingQueuedFiles(event.dataTransfer?.files || []);
                    }}
                  >
                    <div className="file-drop-hint">
                      <span className="file-drop-icon" aria-hidden="true">
                        +
                      </span>
                      <span>{editingFileDragActive ? 'Drop files to upload' : 'Drag and drop files here'}</span>
                    </div>
                    <span className="file-upload-name">
                      {summarizeSelection(editingQueuedFiles, 'No files selected', 'files')}
                    </span>
                  </div>
                  <div className="file-upload-actions">
                    <div className="file-upload-controls">
                      <input
                        id="lead-edit-upload"
                        className="file-upload-input"
                        type="file"
                        multiple
                        onChange={(event) => {
                          addEditingQueuedFiles(event.target.files || []);
                          event.target.value = '';
                        }}
                      />
                      <label htmlFor="lead-edit-upload" className="ghost file-upload-button">
                        Choose files
                      </label>
                      <button
                        className="primary"
                        type="button"
                        onClick={handleUploadEditingFiles}
                        disabled={!editingQueuedFiles.length || editingFilesLoading}
                      >
                        Upload files
                      </button>
                    </div>
                    <span className="file-upload-selected">
                      {summarizeSelection(editingQueuedFiles, 'No files selected', 'files')}
                    </span>
                  </div>
                </div>
                {editingFilesStatus ? <p className="muted">{editingFilesStatus}</p> : null}
                <div className="photo-gallery-panel">
                  {editingFilesLoading ? (
                    <p className="muted">Loading files...</p>
                  ) : editingFiles.length ? (
                    <div className="photo-gallery upload-card-gallery">
                      {editingFiles.map((fileRecord) => (
                        <div key={fileRecord.id} className="photo-card file-card compact-upload-card">
                          <div className="photo-thumb-wrap file-thumb-wrap">
                            <div className="file-thumb-placeholder">
                              <span className="file-thumb-type">{getFileTypeLabel(fileRecord.filename)}</span>
                            </div>
                          </div>
                          <div className="photo-meta">
                            <div className="photo-name" title={fileRecord.filename}>
                              {fileRecord.filename}
                            </div>
                            <div className="photo-sub muted">
                              <span>{new Date(fileRecord.created_at).toLocaleString()}</span>
                              <span>{formatBytes(fileRecord.size_bytes)}</span>
                            </div>
                          </div>
                          <div className="lead-file-card-actions">
                            <button
                              className="ghost tiny-button"
                              type="button"
                              onClick={() => handleDownloadEditingFile(fileRecord)}
                            >
                              Download
                            </button>
                            <button
                              className="ghost tiny-button"
                              type="button"
                              onClick={() => handleDeleteEditingFile(fileRecord)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No files uploaded yet.</p>
                  )}
                </div>
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
      {dialogPortal}
    </>
  );
}
