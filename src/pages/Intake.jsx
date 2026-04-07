import React, { useEffect, useMemo, useState } from 'react';
import { createProject, listContractors, listProjects, uploadProjectFile } from '../api.js';
import { buildEmptyRequiredDocs, buildProjectSummary } from '../utils/requiredDocs.js';

function todayLocalIso() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.heic'];
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

function isImageUploadFile(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  const name = String(file.name || '').toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext));
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

function buildEmptyScottsdaleReadiness() {
  return SCOTTSDALE_READINESS_OPTIONS.reduce((acc, option) => {
    acc[option.id] = false;
    return acc;
  }, {});
}

function buildAdditionalRequirements(form) {
  const lines = [];
  const add = (label, value) => {
    const text = String(value || '').trim();
    if (text) lines.push(`${label}: ${text}`);
  };
  add('Project Type', form.project_type);
  add('Project Location (Address)', form.project_location_address);
  add('Project Location (State)', form.project_location_state);
  add('ZIP Code', form.project_location_zip);
  add('GPS Coordinates', form.gps_coordinates);
  add('Contractor Name', form.contractor_name);
  add('Owner Name', form.owner_name);
  add('Primary Contact Name', form.primary_contact_name);
  add('Contact Address', form.contact_address);
  add('Contact Phone', form.contact_phone);
  add('Contact Email', form.contact_email);
  add('Delivery Address', form.delivery_address);
  add('Delivery Contact Name', form.delivery_contact_name);
  add('Delivery Contact Phone/Email', form.delivery_contact_info);
  const readinessProvided = SCOTTSDALE_READINESS_OPTIONS.filter((option) =>
    Boolean(form.scottsdale_readiness?.[option.id])
  ).map((option) => option.label);
  const readinessMissing = SCOTTSDALE_READINESS_OPTIONS.filter(
    (option) => !Boolean(form.scottsdale_readiness?.[option.id])
  ).map((option) => option.label);
  const blocks = [];
  if (lines.length) {
    blocks.push(`Project details:\n${lines.map((line) => `- ${line}`).join('\n')}`);
  }
  blocks.push(
    `Scottsdale readiness checklist:\n${
      readinessProvided.length
        ? `- Ready:\n  - ${readinessProvided.join('\n  - ')}`
        : '- Ready:\n  - None listed'
    }\n${
      readinessMissing.length
        ? `- Pending:\n  - ${readinessMissing.join('\n  - ')}`
        : '- Pending:\n  - None'
    }`
  );
  const freeNotes = String(form.summary || '').trim();
  if (freeNotes) {
    blocks.push(freeNotes);
  }
  return blocks.join('\n\n').trim();
}

export default function Intake() {
  const emptyRequiredDocs = useMemo(() => buildEmptyRequiredDocs(), []);
  const emptyScottsdaleReadiness = useMemo(() => buildEmptyScottsdaleReadiness(), []);
  const [form, setForm] = useState({
    name: '',
    project_type: '',
    project_location_address: '',
    project_location_state: '',
    project_location_zip: '',
    gps_coordinates: '',
    contractor_name: '',
    owner_name: '',
    primary_contact_name: '',
    contact_address: '',
    contact_phone: '',
    contact_email: '',
    delivery_address: '',
    delivery_contact_name: '',
    delivery_contact_info: '',
    urgency: 'standard',
    budget: '',
    slab_work: false,
    scottsdale_ready_files: false,
    scottsdale_readiness: { ...emptyScottsdaleReadiness },
    summary: '',
    required_docs: { ...emptyRequiredDocs }
  });
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [partyOptions, setPartyOptions] = useState([]);
  const [uploadFiles, setUploadFiles] = useState([]);
  const [photoUploads, setPhotoUploads] = useState([]);
  const [uploadAllowCustomer, setUploadAllowCustomer] = useState(false);
  const [uploadAllowContractor, setUploadAllowContractor] = useState(false);
  const [uploadPhotoAllowContractor, setUploadPhotoAllowContractor] = useState(false);
  const [fileDragActive, setFileDragActive] = useState(false);
  const [photoDragActive, setPhotoDragActive] = useState(false);
  const [photoError, setPhotoError] = useState('');

  const updateField = (key) => (event) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
  };

  const toggleRequiredDoc = (id) => (event) => {
    const checked = Boolean(event.target.checked);
    setForm((prev) => ({
      ...prev,
      required_docs: { ...(prev.required_docs || {}), [id]: checked }
    }));
  };

  const toggleScottsdaleReadiness = (id) => (event) => {
    const checked = Boolean(event.target.checked);
    setForm((prev) => ({
      ...prev,
      scottsdale_readiness: { ...(prev.scottsdale_readiness || {}), [id]: checked }
    }));
  };

  useEffect(() => {
    let active = true;
    const loadPartyOptions = async () => {
      try {
        const [projectsResult, contractorsResult] = await Promise.allSettled([
          listProjects('include_deleted=true'),
          listContractors()
        ]);
        if (!active) return;
        const unique = new Map();
        (Array.isArray(projectsResult?.value) ? projectsResult.value : []).forEach((project) => {
          const value = String(project?.requester || '').trim();
          if (!value) return;
          const key = value.toLowerCase();
          if (!unique.has(key)) unique.set(key, value);
        });
        (Array.isArray(contractorsResult?.value) ? contractorsResult.value : []).forEach((contractor) => {
          const value = String(contractor?.company || '').trim();
          if (!value) return;
          const key = value.toLowerCase();
          if (!unique.has(key)) unique.set(key, value);
        });
        setPartyOptions(Array.from(unique.values()).sort((a, b) => a.localeCompare(b)));
      } catch (_err) {
        if (active) setPartyOptions([]);
      }
    };
    loadPartyOptions();
    return () => {
      active = false;
    };
  }, []);

  const requesterListId = useMemo(() => 'shared-party-options', []);
  const photoPreviews = useMemo(
    () =>
      photoUploads.map((item) => ({
        id: item.id,
        file: item.file,
        previewUrl: window.URL.createObjectURL(item.file)
      })),
    [photoUploads]
  );

  useEffect(
    () => () => {
      photoPreviews.forEach((item) => {
        window.URL.revokeObjectURL(item.previewUrl);
      });
    },
    [photoPreviews]
  );

  const handleSelectFiles = (event) => {
    const incoming = Array.from(event.target.files || []);
    if (incoming.length) {
      setUploadFiles((prev) => [...prev, ...toUploadItems(incoming)]);
    }
    event.target.value = '';
  };

  const handleSelectPhotos = (event) => {
    const picked = Array.from(event.target.files || []);
    const imageFiles = picked.filter(isImageUploadFile);
    if (imageFiles.length) {
      setPhotoUploads((prev) => [...prev, ...toUploadItems(imageFiles)]);
      setPhotoError('');
    } else if (picked.length) {
      setPhotoError('Please select image files only.');
    }
    event.target.value = '';
  };

  const removeQueuedFile = (id) => {
    setUploadFiles((prev) => prev.filter((item) => item.id !== id));
  };

  const removeQueuedPhoto = (id) => {
    setPhotoUploads((prev) => prev.filter((item) => item.id !== id));
  };

  const handleFileDrop = (event) => {
    event.preventDefault();
    const dropped = Array.from(event.dataTransfer.files || []);
    if (dropped.length) {
      setUploadFiles((prev) => [...prev, ...toUploadItems(dropped)]);
    }
    setFileDragActive(false);
  };

  const handlePhotoDrop = (event) => {
    event.preventDefault();
    const dropped = Array.from(event.dataTransfer.files || []);
    const imageFiles = dropped.filter(isImageUploadFile);
    if (imageFiles.length) {
      setPhotoUploads((prev) => [...prev, ...toUploadItems(imageFiles)]);
      setPhotoError('');
    } else if (dropped.length) {
      setPhotoError('Please drop image files only.');
    }
    setPhotoDragActive(false);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const contractorName = form.contractor_name.trim();
    if (!form.name.trim() || !contractorName) {
      setStatus('Project name and contractor name are required.');
      return;
    }
    setSaving(true);
    setStatus('');
    try {
      const createdProject = await createProject({
        name: form.name.trim(),
        requester: contractorName,
        project_location_state: form.project_location_state.trim(),
        due_date: todayLocalIso(),
        urgency: form.urgency,
        budget: form.budget.trim(),
        slab_work: Boolean(form.slab_work),
        scottsdale_ready_files: Boolean(form.scottsdale_ready_files),
        summary: buildProjectSummary(form.required_docs, buildAdditionalRequirements(form))
      });
      const projectId = String(createdProject?.id || '').trim();
      const pendingFiles = [...uploadFiles];
      const pendingPhotos = [...photoUploads];
      if (projectId && (pendingFiles.length || pendingPhotos.length)) {
        const uploadTasks = [
          ...pendingFiles.map((item) =>
            uploadProjectFile(projectId, item.file, {
              filename: item.file.name,
              content_type: item.file.type || undefined,
              customer_visible: uploadAllowCustomer,
              contractor_visible: uploadAllowContractor
            })
          ),
          ...pendingPhotos.map((item) =>
            uploadProjectFile(projectId, item.file, {
              filename: item.file.name,
              content_type: item.file.type || undefined,
              customer_visible: true,
              contractor_visible: uploadPhotoAllowContractor
            })
          )
        ];
        const results = await Promise.allSettled(uploadTasks);
        const failedCount = results.filter((result) => result.status === 'rejected').length;
        const uploadedCount = uploadTasks.length - failedCount;
        if (failedCount > 0) {
          setStatus(
            `Project request submitted. ${uploadedCount} upload(s) completed and ${failedCount} failed. You can retry from project details.`
          );
        } else {
          setStatus(`Project request submitted. Uploaded ${uploadedCount} file(s).`);
        }
      } else {
        setStatus('Project request submitted.');
      }
      setPartyOptions((prev) => {
        const exists = prev.some((item) => item.toLowerCase() === contractorName.toLowerCase());
        if (exists) return prev;
        return [...prev, contractorName].sort((a, b) => a.localeCompare(b));
      });
      setForm({
        name: '',
        project_type: '',
        project_location_address: '',
        project_location_state: '',
        project_location_zip: '',
        gps_coordinates: '',
        contractor_name: '',
        owner_name: '',
        primary_contact_name: '',
        contact_address: '',
        contact_phone: '',
        contact_email: '',
        delivery_address: '',
        delivery_contact_name: '',
        delivery_contact_info: '',
        urgency: 'standard',
        budget: '',
        slab_work: false,
        scottsdale_ready_files: false,
        scottsdale_readiness: { ...emptyScottsdaleReadiness },
        summary: '',
        required_docs: { ...emptyRequiredDocs }
      });
      setUploadFiles([]);
      setPhotoUploads([]);
      setUploadAllowCustomer(false);
      setUploadAllowContractor(false);
      setUploadPhotoAllowContractor(false);
      setPhotoError('');
    } catch (err) {
      setStatus('Unable to submit the project intake.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Project intake</h2>
          <p className="muted">Create a new project request.</p>
        </div>
      </div>
      <form className="intake-form" onSubmit={handleSubmit}>
        <div className="intake-fields form-grid">
          <div className="intake-section span-2">
            <div className="intake-section-title">1. Project Overview</div>
            <div className="intake-section-grid">
              <label>
                Project Name
                <input value={form.name} onChange={updateField('name')} placeholder="Project name" />
              </label>
              <label>
                Project Type
                <input
                  value={form.project_type}
                  onChange={updateField('project_type')}
                  placeholder="Type"
                />
              </label>
              <label className="span-2">
                Project Location (Address)
                <input
                  value={form.project_location_address}
                  onChange={updateField('project_location_address')}
                  placeholder="Address"
                />
              </label>
              <label>
                Project Location (State)
                <input
                  value={form.project_location_state}
                  onChange={updateField('project_location_state')}
                  placeholder="AZ"
                />
              </label>
              <label>
                ZIP Code
                <input
                  value={form.project_location_zip}
                  onChange={updateField('project_location_zip')}
                  placeholder="85260"
                />
              </label>
              <label>
                GPS Coordinates
                <input
                  value={form.gps_coordinates}
                  onChange={updateField('gps_coordinates')}
                  placeholder="33.4942, -111.9261"
                />
              </label>
              <label>
                Urgency
                <select value={form.urgency} onChange={updateField('urgency')}>
                  <option value="standard">Standard</option>
                  <option value="rush">Rush</option>
                  <option value="critical">Critical</option>
                </select>
              </label>
              <label className="span-2">
                Budget
                <input value={form.budget} onChange={updateField('budget')} placeholder="Budget target" />
              </label>
              <div className="intake-toggle-grid span-2">
                <label className="intake-slab-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(form.slab_work)}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        slab_work: event.target.checked
                      }))
                    }
                  />
                  <span>Slab work required</span>
                </label>
                <label className="intake-slab-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(form.scottsdale_ready_files)}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        scottsdale_ready_files: event.target.checked
                      }))
                    }
                  />
                  <span>Scottsdale Ready Files workflow</span>
                </label>
              </div>
            </div>
          </div>

          <div className="intake-section span-2">
            <div className="intake-section-title">2. Architectural &amp; Technical Plans</div>
            <p className="muted intake-section-intro">Please attach or confirm availability of the following:</p>
            <div className="intake-docs-grid">
              {ARCHITECTURAL_PLAN_OPTIONS.map((option) => (
                <label key={option.id} className="intake-doc-option">
                  <input
                    type="checkbox"
                    checked={Boolean(form.required_docs?.[option.id])}
                    onChange={toggleRequiredDoc(option.id)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="intake-section span-2">
            <div className="intake-section-title">3. Project Stakeholders</div>
            <div className="intake-section-grid">
              <label>
                Contractor Name
                <input
                  value={form.contractor_name}
                  onChange={updateField('contractor_name')}
                  placeholder="Contractor"
                  list={requesterListId}
                />
                <datalist id={requesterListId}>
                  {partyOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </label>
              <label>
                Owner Name
                <input
                  value={form.owner_name}
                  onChange={updateField('owner_name')}
                  placeholder="Owner"
                />
              </label>
            </div>
          </div>

          <div className="intake-section span-2">
            <div className="intake-section-title">4. Contact Information</div>
            <div className="intake-section-grid">
              <label>
                Primary Contact Name
                <input
                  value={form.primary_contact_name}
                  onChange={updateField('primary_contact_name')}
                  placeholder="Primary contact"
                />
              </label>
              <label>
                Address
                <input
                  value={form.contact_address}
                  onChange={updateField('contact_address')}
                  placeholder="Address"
                />
              </label>
              <label>
                Phone
                <input
                  value={form.contact_phone}
                  onChange={updateField('contact_phone')}
                  placeholder="Phone"
                />
              </label>
              <label>
                Email
                <input
                  value={form.contact_email}
                  onChange={updateField('contact_email')}
                  placeholder="Email"
                />
              </label>
            </div>
          </div>

          <div className="intake-section span-2">
            <div className="intake-section-title">5. Delivery Information</div>
            <div className="intake-section-grid">
              <label className="span-2">
                Delivery Address
                <input
                  value={form.delivery_address}
                  onChange={updateField('delivery_address')}
                  placeholder="Delivery address"
                />
              </label>
              <label>
                Delivery Contact Name
                <input
                  value={form.delivery_contact_name}
                  onChange={updateField('delivery_contact_name')}
                  placeholder="Delivery contact"
                />
              </label>
              <label>
                Delivery Contact Phone/Email
                <input
                  value={form.delivery_contact_info}
                  onChange={updateField('delivery_contact_info')}
                  placeholder="Phone or email"
                />
              </label>
            </div>
          </div>

          <div className="intake-section span-2">
            <div className="intake-section-title">6. Scottsdale Readiness Checklist</div>
            <p className="muted intake-section-intro">(For internal/project readiness tracking)</p>
            <div className="intake-docs-grid">
              {SCOTTSDALE_READINESS_OPTIONS.map((option) => (
                <label key={option.id} className="intake-doc-option">
                  <input
                    type="checkbox"
                    checked={Boolean(form.scottsdale_readiness?.[option.id])}
                    onChange={toggleScottsdaleReadiness(option.id)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>

          <label className="span-2">
            7. Notes / Additional Requirements
            <textarea value={form.summary} onChange={updateField('summary')} placeholder="Notes" rows={3} />
          </label>
          <div className="intake-upload-section span-2">
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
                onDrop={handleFileDrop}
              >
                <div className="file-drop-hint">
                  <span className="file-drop-icon" aria-hidden="true">
                    +
                  </span>
                  <span>{fileDragActive ? 'Drop files to upload' : 'Drag and drop files here'}</span>
                </div>
                <span className="file-upload-name">{summarizeSelection(uploadFiles, 'No files selected', 'files')}</span>
              </div>
              <div className="file-upload-actions">
                <div className="file-upload-controls">
                  <input
                    id="intake-file-upload"
                    className="file-upload-input"
                    type="file"
                    multiple
                    onChange={handleSelectFiles}
                  />
                  <label htmlFor="intake-file-upload" className="ghost file-upload-button">
                    Choose files
                  </label>
                </div>
                <label className="switch-field">
                  <input
                    type="checkbox"
                    checked={uploadAllowCustomer}
                    onChange={(event) => setUploadAllowCustomer(event.target.checked)}
                  />
                  <span className="switch-track" aria-hidden="true">
                    <span className="switch-thumb" />
                  </span>
                  <span className="switch-text">Allow customer view</span>
                </label>
                <label className="switch-field">
                  <input
                    type="checkbox"
                    checked={uploadAllowContractor}
                    onChange={(event) => setUploadAllowContractor(event.target.checked)}
                  />
                  <span className="switch-track" aria-hidden="true">
                    <span className="switch-thumb" />
                  </span>
                  <span className="switch-text">Allow contractor view</span>
                </label>
                <span className="file-upload-selected">
                  {summarizeSelection(uploadFiles, 'No files selected', 'files')}
                </span>
              </div>
            </div>
            <div className="photo-gallery-panel">
              {uploadFiles.length ? (
                <div className="photo-gallery upload-card-gallery">
                  {uploadFiles.map((item) => (
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
                      <button className="ghost tiny-button" type="button" onClick={() => removeQueuedFile(item.id)}>
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
          <div className="intake-upload-section span-2">
            <div className="intake-docs-title">Photos</div>
            <div className="file-upload-form">
              <div
                className={`file-upload-row${photoDragActive ? ' drag-active' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'copy';
                }}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setPhotoDragActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setPhotoDragActive(false);
                }}
                onDrop={handlePhotoDrop}
              >
                <div className="file-drop-hint">
                  <span className="file-drop-icon" aria-hidden="true">
                    +
                  </span>
                  <span>{photoDragActive ? 'Drop photos to upload' : 'Drag and drop photos here'}</span>
                </div>
                <span className="file-upload-name">{summarizeSelection(photoUploads, 'No photos selected', 'photos')}</span>
              </div>
              <div className="file-upload-actions">
                <div className="file-upload-controls">
                  <input
                    id="intake-photo-upload"
                    className="file-upload-input"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleSelectPhotos}
                  />
                  <label htmlFor="intake-photo-upload" className="ghost file-upload-button">
                    Choose photos
                  </label>
                </div>
                <label className="switch-field">
                  <input
                    type="checkbox"
                    checked={uploadPhotoAllowContractor}
                    onChange={(event) => setUploadPhotoAllowContractor(event.target.checked)}
                  />
                  <span className="switch-track" aria-hidden="true">
                    <span className="switch-thumb" />
                  </span>
                  <span className="switch-text">Allow contractor view</span>
                </label>
                <span className="muted">Photos are visible to the linked customer.</span>
                <span className="file-upload-selected">
                  {summarizeSelection(photoUploads, 'No photos selected', 'photos')}
                </span>
              </div>
            </div>
            {photoError ? <p className="muted">{photoError}</p> : null}
            <div className="photo-gallery-panel">
              {photoPreviews.length ? (
                <div className="photo-gallery upload-card-gallery">
                  {photoPreviews.map((item) => (
                    <div key={item.id} className="photo-card compact-upload-card">
                      <div className="photo-thumb-wrap">
                        <img className="photo-thumb" src={item.previewUrl} alt={item.file.name} />
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
                      <button className="ghost tiny-button" type="button" onClick={() => removeQueuedPhoto(item.id)}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">No photos selected yet.</p>
              )}
            </div>
          </div>
        </div>
        <div className="intake-actions">
          <span className="muted">{status}</span>
          <button className="primary" type="submit" disabled={saving}>
            {saving ? 'Submitting...' : 'Intake project'}
          </button>
        </div>
      </form>
    </section>
  );
}
