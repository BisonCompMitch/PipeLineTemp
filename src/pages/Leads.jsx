
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
import ModalPortal from '../components/ModalPortal.jsx';
import useSiteDialog from '../utils/useSiteDialog.jsx';
import { REQUIRED_DOC_OPTIONS, buildEmptyRequiredDocs } from '../utils/requiredDocs.js';

const STATUS_OPTIONS = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];
const PRIORITY_OPTIONS = ['high', 'mid', 'low'];
const FILTER_ALL = '__all__';
const CREATOR_COMPANY_ALL = '__all__';
const ARCHITECTURAL_PLAN_OPTIONS = [
  { id: 'building_elevations', label: 'Elevations (4 minimum)' },
  { id: 'framing_plans', label: 'Framing Plans' },
  { id: 'dimensioned_floor_plans', label: 'Dimensioned Floor Plans' },
  { id: 'roof_plans', label: 'Roof Plans' },
  { id: 'building_sections', label: 'Building Sections' },
  { id: 'foundation_plans', label: 'Foundation Plans & Details' },
  { id: 'hvac_layouts', label: 'Intended HVAC System' },
  { id: 'soils_report', label: 'Soils Report' }
];
const SCOTTSDALE_READINESS_OPTIONS = [
  { id: 'sdp_file', label: 'SDP File' },
  { id: 'ifc_issued', label: 'IFC (Issued for Construction)' },
  { id: 'production_files', label: 'Production Files' },
  { id: 'engineering_complete', label: 'Engineering Complete' }
];
const LEAD_DETAILS_START = '[Lead details]';
const LEAD_DETAILS_END = '[/Lead details]';
const LEAD_DETAIL_TABS = [
  { id: 'lead', label: 'Lead' },
  { id: 'files', label: 'Files' }
];

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

function buildEmptyScottsdaleReadiness() {
  return SCOTTSDALE_READINESS_OPTIONS.reduce((acc, option) => {
    acc[option.id] = false;
    return acc;
  }, {});
}

function buildLeadDetailState() {
  return {
    project_type: '',
    project_location_address: '',
    gps_coordinates: '',
    owner_name: '',
    primary_contact_name: '',
    contact_address: '',
    delivery_address: '',
    delivery_contact_name: '',
    delivery_contact_info: '',
    scottsdale_readiness: buildEmptyScottsdaleReadiness()
  };
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
    ...buildLeadDetailState(),
    notes: ''
  };
}

function serializeLeadDetails(form) {
  const readinessSelected = SCOTTSDALE_READINESS_OPTIONS.filter((option) =>
    Boolean(form.scottsdale_readiness?.[option.id])
  ).map((option) => option.id);
  const lines = [
    `Project Type: ${String(form.project_type || '').trim()}`,
    `Project Location (Address): ${String(form.project_location_address || '').trim()}`,
    `GPS Coordinates: ${String(form.gps_coordinates || '').trim()}`,
    `Owner Name: ${String(form.owner_name || '').trim()}`,
    `Primary Contact Name: ${String(form.primary_contact_name || '').trim()}`,
    `Contact Address: ${String(form.contact_address || '').trim()}`,
    `Delivery Address: ${String(form.delivery_address || '').trim()}`,
    `Delivery Contact Name: ${String(form.delivery_contact_name || '').trim()}`,
    `Delivery Contact Phone/Email: ${String(form.delivery_contact_info || '').trim()}`,
    `Scottsdale Readiness: ${readinessSelected.join(',')}`
  ];
  return `${LEAD_DETAILS_START}\n${lines.join('\n')}\n${LEAD_DETAILS_END}`;
}

function parseLeadDetails(notesValue) {
  const defaults = buildLeadDetailState();
  const notesText = String(notesValue || '').replace(/\r\n/g, '\n');
  const match = notesText.match(/\[Lead details\]\n([\s\S]*?)\n\[\/Lead details\]/);
  if (!match) {
    return { details: defaults, notes: notesText.trim() };
  }
  const parsed = { ...defaults };
  match[1].split('\n').forEach((rawLine) => {
    const line = String(rawLine || '').trim();
    if (!line) return;
    const [label, ...rest] = line.split(':');
    const value = rest.join(':').trim();
    if (!label) return;
    switch (label.trim().toLowerCase()) {
      case 'project type':
        parsed.project_type = value;
        break;
      case 'project location (address)':
        parsed.project_location_address = value;
        break;
      case 'gps coordinates':
        parsed.gps_coordinates = value;
        break;
      case 'owner name':
        parsed.owner_name = value;
        break;
      case 'primary contact name':
        parsed.primary_contact_name = value;
        break;
      case 'contact address':
        parsed.contact_address = value;
        break;
      case 'delivery address':
        parsed.delivery_address = value;
        break;
      case 'delivery contact name':
        parsed.delivery_contact_name = value;
        break;
      case 'delivery contact phone/email':
        parsed.delivery_contact_info = value;
        break;
      case 'scottsdale readiness': {
        const selected = value
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean);
        parsed.scottsdale_readiness = SCOTTSDALE_READINESS_OPTIONS.reduce((acc, option) => {
          acc[option.id] = selected.includes(option.id);
          return acc;
        }, {});
        break;
      }
      default:
        break;
    }
  });
  const cleanedNotes = notesText.replace(match[0], '').trim();
  return { details: parsed, notes: cleanedNotes };
}

function buildLeadNotesPayload(form) {
  const detailsBlock = serializeLeadDetails(form);
  const additionalNotes = String(form.notes || '').trim();
  if (!additionalNotes) return detailsBlock;
  return `${detailsBlock}\n\n${additionalNotes}`;
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
  const parsed = parseLeadDetails(lead?.notes);
  return {
    ...lead,
    owner: lead?.owner || '',
    priority: normalizePriority(lead?.priority, 'mid'),
    square_footage: lead?.square_footage || '',
    estimated_value: lead?.estimated_value || '',
    zip_code: lead?.zip_code || '',
    project_location_state: lead?.project_location_state || '',
    required_docs: normalizeRequiredDocs(lead?.required_docs),
    ...parsed.details,
    notes: parsed.notes
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
  const [editingTab, setEditingTab] = useState('lead');
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
      setMessage('Project name is required.');
      return;
    }
    setSaving(true);
    try {
      const created = await createLead({
        name: form.name.trim(),
        company: String(form.company || '').trim(),
        project_location_state: String(form.project_location_state || '').trim(),
        zip_code: String(form.zip_code || '').trim(),
        email: String(form.email || '').trim(),
        phone: String(form.phone || '').trim(),
        owner: String(form.owner || '').trim(),
        status: form.status,
        square_footage: form.square_footage,
        estimated_value: form.estimated_value,
        priority: normalizePriority(form.priority, 'mid'),
        required_docs: normalizeRequiredDocs(form.required_docs),
        notes: buildLeadNotesPayload(form)
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
        notes: buildLeadNotesPayload(editing)
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
    const acknowledgeCharges = await confirmDialog(
      'Disclaimer: incomplete document packages may incur additional charges. Continue and request this quote?',
      { title: 'Quote request disclaimer', confirmText: 'I Understand' }
    );
    if (!acknowledgeCharges) return;
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
            <p className="muted">Track client leads.</p>
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
              <div className="intake-section lead-section-span-full">
                <div className="intake-section-title">1. Project Overview</div>
                <div className="intake-section-grid">
                  <label>
                    Project Name
                    <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
                  </label>
                  <label>
                    Project Type
                    <input
                      value={form.project_type}
                      onChange={(event) => setForm((prev) => ({ ...prev, project_type: event.target.value }))}
                    />
                  </label>
                  <label className="span-2">
                    Project Location (Address)
                    <input
                      value={form.project_location_address}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, project_location_address: event.target.value }))
                      }
                    />
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
                    ZIP Code
                    <input
                      value={form.zip_code}
                      placeholder="85260"
                      onChange={(event) => setForm((prev) => ({ ...prev, zip_code: event.target.value }))}
                    />
                  </label>
                  <label>
                    GPS Coordinates
                    <input
                      value={form.gps_coordinates}
                      onChange={(event) => setForm((prev) => ({ ...prev, gps_coordinates: event.target.value }))}
                    />
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
                </div>
              </div>

              <div className="intake-section lead-section-span-full">
                <div className="intake-section-title">2. Architectural &amp; Technical Plans</div>
                <p className="muted intake-section-intro">
                  Docs required for each check or the project may be charged for incomplete packages.
                </p>
                <div className="intake-docs-grid">
                  {ARCHITECTURAL_PLAN_OPTIONS.map((option) => (
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

              <div className="intake-section lead-section-span-full">
                <div className="intake-section-title">3. Project Stakeholders</div>
                <div className="intake-section-grid">
                  <label>
                    Client
                    <input value={form.company} onChange={(event) => setForm((prev) => ({ ...prev, company: event.target.value }))} />
                  </label>
                  <label>
                    Owner Name
                    <input
                      value={form.owner_name}
                      onChange={(event) => setForm((prev) => ({ ...prev, owner_name: event.target.value }))}
                    />
                  </label>
                  <label className="span-2">
                    Lead ownership
                    <input value={form.owner} onChange={(event) => setForm((prev) => ({ ...prev, owner: event.target.value }))} />
                  </label>
                </div>
              </div>

              <div className="intake-section lead-section-span-full">
                <div className="intake-section-title">4. Contact Information</div>
                <div className="intake-section-grid">
                  <label>
                    Primary Contact Name
                    <input
                      value={form.primary_contact_name}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, primary_contact_name: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Address
                    <input
                      value={form.contact_address}
                      onChange={(event) => setForm((prev) => ({ ...prev, contact_address: event.target.value }))}
                    />
                  </label>
                  <label>
                    Phone
                    <input value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} />
                  </label>
                  <label>
                    Email
                    <input value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} />
                  </label>
                </div>
              </div>

              <div className="intake-section lead-section-span-full">
                <div className="intake-section-title">5. Delivery Information</div>
                <div className="intake-section-grid">
                  <label className="span-2">
                    Delivery Address
                    <input
                      value={form.delivery_address}
                      onChange={(event) => setForm((prev) => ({ ...prev, delivery_address: event.target.value }))}
                    />
                  </label>
                  <label>
                    Delivery Contact Name
                    <input
                      value={form.delivery_contact_name}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, delivery_contact_name: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Delivery Contact Phone/Email
                    <input
                      value={form.delivery_contact_info}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, delivery_contact_info: event.target.value }))
                      }
                    />
                  </label>
                </div>
              </div>

              <div className="intake-section lead-section-span-full">
                <div className="intake-section-title">6. Scottsdale Readiness Checklist</div>
                <p className="muted intake-section-intro">(For internal/project readiness tracking)</p>
                <div className="intake-docs-grid">
                  {SCOTTSDALE_READINESS_OPTIONS.map((option) => (
                    <label key={option.id} className="intake-doc-option">
                      <input
                        type="checkbox"
                        checked={Boolean(form.scottsdale_readiness?.[option.id])}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            scottsdale_readiness: {
                              ...(prev.scottsdale_readiness || {}),
                              [option.id]: event.target.checked
                            }
                          }))
                        }
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="intake-section lead-section-span-full">
                <div className="intake-section-title">Lead Workflow</div>
                <div className="intake-section-grid">
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
                </div>
              </div>

              <label className="lead-notes-field">
                7. Notes / Additional Requirements
                <textarea value={form.notes} rows={5} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} />
              </label>

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
                      setEditingTab('lead');
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
          <ModalPortal>
            <div className="modal-backdrop preview-backdrop pipeline-detail-backdrop" onClick={() => setEditing(null)}>
              <div className="modal pipeline-detail-modal lead-detail-modal" onClick={(event) => event.stopPropagation()}>
                <div className="detail-card-header pipeline-detail-header">
                  <div className="pipeline-detail-title">
                    {editing?.name || 'Lead details'}
                  </div>
                  <div className="detail-header-actions">
                    <button className="ghost" type="button" onClick={() => setEditing(null)}>
                      Close
                    </button>
                  </div>
                  <div className="stage-tabs detail-tabs pipeline-detail-tabs-wrap" role="tablist" aria-label="Lead detail sections">
                    {LEAD_DETAIL_TABS.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={editingTab === tab.id}
                        className={`stage-tab${editingTab === tab.id ? ' active' : ''}`}
                        onClick={() => setEditingTab(tab.id)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="pipeline-detail-body">
                  <div className="lead-edit-card lead-detail-card">
                    {editingTab === 'lead' ? (
                      <>
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
                    Project Name
                    <input value={editing.name} onChange={(event) => setEditing((prev) => ({ ...prev, name: event.target.value }))} />
                  </label>
                  <label>
                    Client
                    <input value={editing.company || ''} onChange={(event) => setEditing((prev) => ({ ...prev, company: event.target.value }))} />
                  </label>
                  <label>
                    Project Type
                    <input
                      value={editing.project_type || ''}
                      onChange={(event) => setEditing((prev) => ({ ...prev, project_type: event.target.value }))}
                    />
                  </label>
                  <label className="span-2">
                    Project Location (Address)
                    <input
                      value={editing.project_location_address || ''}
                      onChange={(event) =>
                        setEditing((prev) => ({ ...prev, project_location_address: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Project Location (State)
                    <input
                      value={editing.project_location_state || ''}
                      onChange={(event) => setEditing((prev) => ({ ...prev, project_location_state: event.target.value }))}
                    />
                  </label>
                  <label>
                    ZIP Code
                    <input value={editing.zip_code || ''} onChange={(event) => setEditing((prev) => ({ ...prev, zip_code: event.target.value }))} />
                  </label>
                  <label>
                    GPS Coordinates
                    <input
                      value={editing.gps_coordinates || ''}
                      onChange={(event) => setEditing((prev) => ({ ...prev, gps_coordinates: event.target.value }))}
                    />
                  </label>
                  <label>
                    Owner Name
                    <input
                      value={editing.owner_name || ''}
                      onChange={(event) => setEditing((prev) => ({ ...prev, owner_name: event.target.value }))}
                    />
                  </label>
                  <label>
                    Primary Contact Name
                    <input
                      value={editing.primary_contact_name || ''}
                      onChange={(event) =>
                        setEditing((prev) => ({ ...prev, primary_contact_name: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Contact Address
                    <input
                      value={editing.contact_address || ''}
                      onChange={(event) => setEditing((prev) => ({ ...prev, contact_address: event.target.value }))}
                    />
                  </label>
                  <label>
                    Email
                    <input value={editing.email || ''} onChange={(event) => setEditing((prev) => ({ ...prev, email: event.target.value }))} />
                  </label>
                  <label>
                    Phone
                    <input value={editing.phone || ''} onChange={(event) => setEditing((prev) => ({ ...prev, phone: event.target.value }))} />
                  </label>
                  <label className="span-2">
                    Delivery Address
                    <input
                      value={editing.delivery_address || ''}
                      onChange={(event) => setEditing((prev) => ({ ...prev, delivery_address: event.target.value }))}
                    />
                  </label>
                  <label>
                    Delivery Contact Name
                    <input
                      value={editing.delivery_contact_name || ''}
                      onChange={(event) =>
                        setEditing((prev) => ({ ...prev, delivery_contact_name: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Delivery Contact Phone/Email
                    <input
                      value={editing.delivery_contact_info || ''}
                      onChange={(event) =>
                        setEditing((prev) => ({ ...prev, delivery_contact_info: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Lead ownership
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
                            {ARCHITECTURAL_PLAN_OPTIONS.map((option) => (
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
                        <div className="intake-docs lead-docs-block">
                          <div className="intake-docs-title">Scottsdale readiness checklist</div>
                          <div className="intake-docs-grid">
                            {SCOTTSDALE_READINESS_OPTIONS.map((option) => (
                              <label key={option.id} className="intake-doc-option">
                                <input
                                  type="checkbox"
                                  checked={Boolean(editing.scottsdale_readiness?.[option.id])}
                                  onChange={(event) =>
                                    setEditing((prev) => ({
                                      ...prev,
                                      scottsdale_readiness: {
                                        ...(prev.scottsdale_readiness || {}),
                                        [option.id]: event.target.checked
                                      }
                                    }))
                                  }
                                />
                                <span>{option.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : null}

                    {editingTab === 'files' ? (
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
                    ) : null}

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
            </div>
          </ModalPortal>
        ) : null}
      </section>
      {dialogPortal}
    </>
  );
}
