import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteProjectFile,
  downloadProjectFile,
  handoffStage,
  listProjectAreaNotes,
  listProjectFiles,
  listProjects,
  setProjectFileVisibility,
  updateStage,
  uploadProjectFile
} from '../api.js';
import ModalPortal from '../components/ModalPortal.jsx';
import BlockingOverlay from '../components/BlockingOverlay.jsx';
import useSiteDialog from '../utils/useSiteDialog.jsx';
import { formatStageName, normalizeProjectStages, STAGE_FLOW } from '../utils/stageDisplay.js';
import { REQUIRED_DOC_OPTIONS, parseProjectSummary } from '../utils/requiredDocs.js';

const ALL_AREA_STAGE_IDS = STAGE_FLOW.map((stage) => stage.id);

const AREA_STAGE_MAP = {
  'plans recieved': ['plans_received'],
  'plans revieved': ['plans_received'],
  'plans received': ['plans_received'],
  plans_received: ['plans_received'],
  budget: ['budget'],
  'cfs budget': ['budget'],
  'money - d&e': ['money_design'],
  'money - de': ['money_design'],
  'money - design': ['money_design'],
  'money design': ['money_design'],
  money_design: ['money_design'],
  design: ['design'],
  engineering: ['engineering'],
  estimating: ['estimating'],
  'money - production': ['money_production'],
  'money production': ['money_production'],
  money_production: ['money_production'],
  manufacturing: ['manufacturing'],
  'money - shipping': ['money_shipping'],
  'money shipping': ['money_shipping'],
  money_shipping: ['money_shipping'],
  shipping: ['shipping'],
  'final payment': ['final_payment'],
  final_payment: ['final_payment'],
  completed: ['completed'],
  management: ALL_AREA_STAGE_IDS,
  manager: ALL_AREA_STAGE_IDS,
  admin: ALL_AREA_STAGE_IDS,
  'admin area': ALL_AREA_STAGE_IDS,
  administrator: ALL_AREA_STAGE_IDS
};

const AREA_FLOW_ORDER = [...STAGE_FLOW.map((stage) => formatStageName(stage.name, stage.id)), 'Management', 'Admin'];

const ADMIN_AREA_OPTIONS = ['Admin', ...STAGE_FLOW.map((stage) => formatStageName(stage.name, stage.id))];

const DETAIL_TABS = [
  { id: 'details', label: 'Details' },
  { id: 'stages', label: 'Stages' },
  { id: 'files', label: 'Files & Photos' }
];

const STATUS_LABELS = {
  pending: 'Pending',
  awaiting_approval: 'Awaiting',
  in_progress: 'In Progress',
  complete: 'Complete'
};

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function formatAcceptedAt(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString();
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

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.heic'];
const TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.tsv', '.log', '.json', '.yaml', '.yml', '.xml'];
const PDF_EXTENSIONS = ['.pdf'];
const TEXT_PREVIEW_LIMIT_BYTES = 1024 * 1024;

function isImageFile(fileRecord) {
  const type = String(fileRecord?.content_type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  const name = String(fileRecord?.filename || '').toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function isTextFile(fileRecord) {
  const type = String(fileRecord?.content_type || '').toLowerCase();
  if (type.startsWith('text/')) return true;
  if (
    [
      'application/json',
      'application/xml',
      'application/x-yaml',
      'text/csv',
      'application/vnd.ms-excel'
    ].includes(type)
  ) {
    return true;
  }
  const name = String(fileRecord?.filename || '').toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function isPdfFile(fileRecord) {
  const type = String(fileRecord?.content_type || '').toLowerCase();
  if (type === 'application/pdf' || type.includes('/pdf')) return true;
  const name = String(fileRecord?.filename || '').toLowerCase();
  return PDF_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function coerceBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['true', '1', 'yes', 'y', 't'].includes(normalized);
  }
  return false;
}

function formatDuration(totalMinutes) {
  const safeMinutes = Math.max(0, totalMinutes);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function countdownForStage(stage, nowMs) {
  if (stage?.id === 'final_payment' && stage.status !== 'complete') {
    return { label: 'Critical', tone: 'red' };
  }
  const expected = Number(stage?.expected_hours ?? stage?.default_duration_hours ?? 0);
  if (!stage || stage.status !== 'in_progress' || !stage.started_at || expected <= 0) {
    return { label: '-', tone: 'neutral' };
  }
  const acceptedAtMs = new Date(stage.started_at).getTime();
  if (Number.isNaN(acceptedAtMs)) {
    return { label: '-', tone: 'neutral' };
  }

  const dueAtMs = acceptedAtMs + expected * 3600000;
  const remainingMs = dueAtMs - nowMs;
  const absMinutes = Math.round(Math.abs(remainingMs) / 60000);
  if (remainingMs < 0) {
    return { label: `${formatDuration(absMinutes)} overdue`, tone: 'red' };
  }
  if (remainingMs <= 4 * 3600000) {
    return { label: `${formatDuration(absMinutes)} left`, tone: 'yellow' };
  }
  return { label: `${formatDuration(absMinutes)} left`, tone: 'green' };
}

function stageStatusClass(status) {
  if (status === 'complete') return 'complete';
  if (status === 'in_progress') return 'progress';
  if (status === 'awaiting_approval') return 'warning';
  return 'neutral';
}

function compareRowsByProjectNumber(a, b) {
  const aRaw = String(a?.project?.project_number || '').trim();
  const bRaw = String(b?.project?.project_number || '').trim();
  if (!aRaw && !bRaw) return 0;
  if (!aRaw) return 1;
  if (!bRaw) return -1;
  const aNum = Number.parseInt(aRaw, 10);
  const bNum = Number.parseInt(bRaw, 10);
  if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
    return aNum - bNum;
  }
  return aRaw.localeCompare(bRaw);
}

function currentProjectStage(stages = []) {
  if (!Array.isArray(stages) || stages.length === 0) return null;
  return stages.find((stage) => stage.status !== 'complete') || stages[stages.length - 1];
}

function triggerBrowserDownload(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'download';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
}

function isImageUploadFile(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  const name = String(file.name || '').toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function summarizeSelection(fileList, emptyLabel, noun) {
  if (!fileList.length) return emptyLabel;
  if (fileList.length === 1) return fileList[0].name;
  return `${fileList.length} ${noun} selected`;
}

function getFileTypeLabel(filename) {
  const name = String(filename || '').trim();
  if (!name.includes('.')) return 'FILE';
  const ext = name.split('.').pop();
  if (!ext) return 'FILE';
  return ext.slice(0, 5).toUpperCase();
}

export default function Areas({ userAreas = [], canEditExpectedTime = false }) {
  const hasAdminArea = useMemo(
    () =>
      userAreas.some((area) => {
        const key = normalize(area);
        return key === 'admin' || key === 'admin area' || key === 'administrator';
      }),
    [userAreas]
  );

  const areaOptions = useMemo(() => {
    const assignedAreas = userAreas.map((area) => String(area || '').trim()).filter(Boolean);
    if (hasAdminArea) {
      return [...ADMIN_AREA_OPTIONS];
    }
    const base = assignedAreas.length ? assignedAreas : ['Design', 'Engineering', 'Estimating'];
    const flowIndex = new Map(AREA_FLOW_ORDER.map((area, index) => [normalize(area), index]));
    return [...new Set(base)].sort((a, b) => {
      const aIndex = flowIndex.has(normalize(a)) ? flowIndex.get(normalize(a)) : 999;
      const bIndex = flowIndex.has(normalize(b)) ? flowIndex.get(normalize(b)) : 999;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return a.localeCompare(b);
    });
  }, [userAreas]);
  const [selectedArea, setSelectedArea] = useState(
    hasAdminArea && areaOptions.includes('Admin') ? 'Admin' : areaOptions[0] || ''
  );
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [savingExpectedId, setSavingExpectedId] = useState('');
  const [selectedRow, setSelectedRow] = useState(null);
  const [detailTab, setDetailTab] = useState('details');
  const [areaNoteDraft, setAreaNoteDraft] = useState('');
  const [areaNoteSaving, setAreaNoteSaving] = useState(false);
  const [areaNoteHistory, setAreaNoteHistory] = useState([]);
  const [areaNoteHistoryLoading, setAreaNoteHistoryLoading] = useState(false);
  const [areaNoteHistoryError, setAreaNoteHistoryError] = useState('');
  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState('');
  const [uploadFiles, setUploadFiles] = useState([]);
  const [uploadAllowCustomer, setUploadAllowCustomer] = useState(false);
  const [uploadAllowContractor, setUploadAllowContractor] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoUploads, setPhotoUploads] = useState([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [fileDragActive, setFileDragActive] = useState(false);
  const [photoDragActive, setPhotoDragActive] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRecord, setPreviewRecord] = useState(null);
  const [cardPreviewUrls, setCardPreviewUrls] = useState({});
  const [cardPreviewStatus, setCardPreviewStatus] = useState({});
  const [stageMoveLoading, setStageMoveLoading] = useState(false);
  const [preview, setPreview] = useState({
    open: false,
    url: '',
    name: '',
    kind: '',
    text: ''
  });
  const cardPreviewUrlRef = useRef({});
  const previewBlobCacheRef = useRef(new Map());
  const { confirmDialog, promptDialog, alertDialog, dialogPortal } = useSiteDialog();
  const photoFiles = useMemo(() => files.filter(isImageFile), [files]);
  const documentFiles = useMemo(() => files.filter((fileRecord) => !isImageFile(fileRecord)), [files]);
  const selectedAreaStageIds = useMemo(() => {
    const key = normalize(selectedArea);
    return AREA_STAGE_MAP[key] || [];
  }, [selectedArea]);

  const closePreview = () => {
    if (preview.url) {
      window.URL.revokeObjectURL(preview.url);
    }
    setPreviewLoading(false);
    setPreviewRecord(null);
    setPreview({ open: false, url: '', name: '', kind: '', text: '' });
  };

  const replaceCardPreviewUrls = useCallback((nextMap) => {
    const previousMap = cardPreviewUrlRef.current || {};
    const nextValues = new Set(Object.values(nextMap));
    Object.values(previousMap).forEach((url) => {
      if (url && !nextValues.has(url)) {
        window.URL.revokeObjectURL(url);
      }
    });
    cardPreviewUrlRef.current = nextMap;
    setCardPreviewUrls(nextMap);
  }, []);

  useEffect(() => {
    return () => {
      if (preview.url) {
        window.URL.revokeObjectURL(preview.url);
      }
    };
  }, [preview.url]);

  useEffect(() => {
    const projectId = selectedRow?.project?.id;
    if (!projectId) {
      previewBlobCacheRef.current.clear();
      replaceCardPreviewUrls({});
      setCardPreviewStatus({});
      return;
    }
    const prefix = `${projectId}:`;
    Array.from(previewBlobCacheRef.current.keys()).forEach((key) => {
      if (!key.startsWith(prefix)) {
        previewBlobCacheRef.current.delete(key);
      }
    });
  }, [selectedRow?.project?.id, replaceCardPreviewUrls]);

  useEffect(() => {
    let cancelled = false;
    const projectId = selectedRow?.project?.id;
    const loadCardPreviews = async () => {
      if (!projectId || !files.length) {
        replaceCardPreviewUrls({});
        setCardPreviewStatus({});
        return;
      }
      const imageFiles = files.filter((fileRecord) => isImageFile(fileRecord));
      if (!imageFiles.length) {
        replaceCardPreviewUrls({});
        setCardPreviewStatus({});
        return;
      }
      setCardPreviewStatus(
        imageFiles.reduce((acc, fileRecord) => {
          if (fileRecord?.id) acc[fileRecord.id] = 'loading';
          return acc;
        }, {})
      );
      const entries = await Promise.all(
        imageFiles.map(async (fileRecord) => {
          if (!fileRecord?.id) return [null, ''];
          const key = `${projectId}:${fileRecord.id}`;
          try {
            let blob = previewBlobCacheRef.current.get(key);
            if (!blob) {
              blob = await downloadProjectFile(projectId, fileRecord.id);
              previewBlobCacheRef.current.set(key, blob);
            }
            return [fileRecord.id, window.URL.createObjectURL(blob)];
          } catch (_error) {
            return [fileRecord.id, ''];
          }
        })
      );
      if (cancelled) {
        entries.forEach(([, url]) => {
          if (url) window.URL.revokeObjectURL(url);
        });
        return;
      }
      const nextMap = {};
      const nextStatus = {};
      entries.forEach(([id, url]) => {
        if (!id) return;
        if (url) {
          nextMap[id] = url;
          nextStatus[id] = 'ready';
        } else {
          nextStatus[id] = 'error';
        }
      });
      replaceCardPreviewUrls(nextMap);
      setCardPreviewStatus(nextStatus);
    };

    loadCardPreviews();
    return () => {
      cancelled = true;
    };
  }, [files, selectedRow?.project?.id, replaceCardPreviewUrls]);

  useEffect(() => {
    return () => {
      const map = cardPreviewUrlRef.current || {};
      Object.values(map).forEach((url) => {
        if (url) window.URL.revokeObjectURL(url);
      });
      cardPreviewUrlRef.current = {};
      previewBlobCacheRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!areaOptions.includes(selectedArea)) {
      setSelectedArea(areaOptions[0] || '');
    }
  }, [areaOptions, selectedArea]);

  useEffect(() => {
    if (!areaNoteHistoryError) return;
    let active = true;
    (async () => {
      await alertDialog(areaNoteHistoryError, { title: 'Notes error', confirmText: 'OK' });
      if (active) setAreaNoteHistoryError('');
    })();
    return () => {
      active = false;
    };
  }, [areaNoteHistoryError, alertDialog]);

  useEffect(() => {
    if (!filesError) return;
    let active = true;
    (async () => {
      await alertDialog(filesError, { title: 'Files notice', confirmText: 'OK' });
      if (active) setFilesError('');
    })();
    return () => {
      active = false;
    };
  }, [filesError, alertDialog]);

  useEffect(() => {
    if (!photoError) return;
    let active = true;
    (async () => {
      await alertDialog(photoError, { title: 'Photos notice', confirmText: 'OK' });
      if (active) setPhotoError('');
    })();
    return () => {
      active = false;
    };
  }, [photoError, alertDialog]);

  const loadProjects = async () => {
    if (!selectedArea) return;
    setLoading(true);
    try {
      const projects = await listProjects();
      const selectedKey = normalize(selectedArea);
      const stageIds = AREA_STAGE_MAP[selectedKey] || [];
      const visibleStatuses =
        selectedKey === 'admin'
          ? new Set(['awaiting_approval', 'in_progress', 'complete'])
          : selectedKey === 'completed'
            ? new Set(['complete'])
            : new Set(['awaiting_approval', 'in_progress']);
      const filtered = selectedKey === 'admin'
        ? (Array.isArray(projects) ? projects : []).flatMap((project) => {
            const stage = currentProjectStage(normalizeProjectStages(project.stages || []));
            if (!stage || !visibleStatuses.has(stage.status)) return [];
            return [{ project, stage }];
          })
        : (Array.isArray(projects) ? projects : [])
            .flatMap((project) =>
              normalizeProjectStages(project.stages || [])
                .filter((stage) => stageIds.includes(stage.id) && visibleStatuses.has(stage.status))
                .map((stage) => ({ project, stage }))
            );
      setRows(filtered.sort(compareRowsByProjectNumber));
    } catch (err) {
      await alertDialog('Unable to load projects for this area.', {
        title: 'Load failed',
        confirmText: 'OK'
      });
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, [selectedArea]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const loadFiles = async (projectId) => {
    if (!projectId) {
      setFiles([]);
      return;
    }
    setFilesLoading(true);
    setFilesError('');
    try {
      const data = await listProjectFiles(projectId);
      setFiles(Array.isArray(data) ? data : []);
    } catch (_err) {
      setFiles([]);
      setFilesError('Unable to load project files.');
    } finally {
      setFilesLoading(false);
    }
  };

  const loadAreaNotes = async (projectId) => {
    if (!projectId) {
      setAreaNoteHistory([]);
      setAreaNoteHistoryError('');
      return;
    }
    const stageIds = selectedAreaStageIds.filter(Boolean);
    setAreaNoteHistoryLoading(true);
    setAreaNoteHistoryError('');
    try {
      const params = new URLSearchParams();
      if (stageIds.length) {
        params.set('stage_ids', stageIds.join(','));
      }
      params.set('limit', '1000');
      const data = await listProjectAreaNotes(projectId, params.toString());
      setAreaNoteHistory(Array.isArray(data) ? data : []);
    } catch (_err) {
      setAreaNoteHistory([]);
      setAreaNoteHistoryError('Unable to load notes.');
    } finally {
      setAreaNoteHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (selectedRow?.project?.id) {
      loadFiles(selectedRow.project.id);
      loadAreaNotes(selectedRow.project.id);
    } else {
      setFiles([]);
      setFilesError('');
      setAreaNoteHistory([]);
      setAreaNoteHistoryError('');
    }
    setDetailTab('details');
    setUploadFiles([]);
    setUploadAllowCustomer(false);
    setUploadAllowContractor(false);
    setUploading(false);
    setPhotoUploads([]);
    setPhotoError('');
    setPhotoUploading(false);
    setFileDragActive(false);
    setPhotoDragActive(false);
    setAreaNoteSaving(false);
    setAreaNoteDraft('');
  }, [selectedRow?.project?.id]);

  useEffect(() => {
    if (selectedRow?.project?.id) {
      loadAreaNotes(selectedRow.project.id);
    }
  }, [selectedAreaStageIds.join(','), selectedRow?.project?.id]);

  useEffect(() => {
    setAreaNoteDraft('');
  }, [selectedRow?.stage?.id]);

  const handleAccept = async (projectId, stageId) => {
    const expected = await promptDialog('Expected time in hours for this stage?', {
      title: 'Set expected time',
      confirmText: 'Save'
    });
    if (expected === null) return;
    const hours = Number(expected);
    if (!Number.isFinite(hours) || hours <= 0) {
      await alertDialog('Enter a valid expected time in hours.', {
        title: 'Invalid expected time',
        confirmText: 'OK'
      });
      return;
    }
    try {
      await updateStage(projectId, stageId, {
        status: 'in_progress',
        expected_hours: hours,
        event_title: 'Stage accepted',
        event_meta: { action: 'accept' }
      });
      await loadProjects();
      await alertDialog('Stage accepted.', { title: 'Stage accepted', confirmText: 'OK' });
    } catch (err) {
      await alertDialog('Unable to accept the project.', { title: 'Action failed', confirmText: 'OK' });
    }
  };

  const handleComplete = async (projectId, stageId) => {
    let moved = false;
    setStageMoveLoading(true);
    try {
      await handoffStage(projectId, stageId);
      await loadProjects();
      setSelectedRow(null);
      setDetailTab('details');
      moved = true;
    } catch (err) {
      await alertDialog('Unable to send to next step.', { title: 'Action failed', confirmText: 'OK' });
    } finally {
      setStageMoveLoading(false);
    }
    if (moved) {
      await alertDialog('Project sent successfully.', { title: 'Project moved', confirmText: 'OK' });
    }
  };

  const handleSaveAreaNote = async () => {
    if (!selectedRow?.project?.id || !selectedRow?.stage?.id) return;
    const noteText = areaNoteDraft.trim();
    if (!noteText) {
      await alertDialog('Enter a note to add.', { title: 'Note required', confirmText: 'OK' });
      return;
    }
    setAreaNoteSaving(true);
    try {
      const updatedStage = await updateStage(selectedRow.project.id, selectedRow.stage.id, {
        area_note: noteText,
        event_title: 'Area note updated',
        event_meta: { stage: formatStageName(selectedRow.stage.name, selectedRow.stage.id) }
      });
      setRows((prev) =>
        prev.map((entry) => {
          if (entry.project.id !== selectedRow.project.id || entry.stage.id !== selectedRow.stage.id) {
            return entry;
          }
          return {
            ...entry,
            stage: {
              ...entry.stage,
              ...(updatedStage || {}),
              area_note: noteText
            }
          };
        })
      );
      setSelectedRow((prev) =>
        prev
          ? {
              ...prev,
              stage: {
                ...prev.stage,
                ...(updatedStage || {}),
                area_note: noteText
              }
            }
          : prev
      );
      setAreaNoteDraft('');
      await loadAreaNotes(selectedRow.project.id);
      await alertDialog('Note added.', { title: 'Note saved', confirmText: 'OK' });
    } catch (_err) {
      await alertDialog('Unable to add note.', { title: 'Action failed', confirmText: 'OK' });
    } finally {
      setAreaNoteSaving(false);
    }
  };

  const handleEditExpected = async (projectId, stage) => {
    const current = Number(stage?.expected_hours ?? stage?.default_duration_hours ?? 0);
    const expected = await promptDialog('Expected time in hours for this stage?', {
      title: 'Edit expected time',
      confirmText: 'Save',
      defaultValue: current > 0 ? String(current) : ''
    });
    if (expected === null) return;
    const hours = Number(expected);
    if (!Number.isFinite(hours) || hours <= 0) {
      await alertDialog('Enter a valid expected time in hours.', {
        title: 'Invalid expected time',
        confirmText: 'OK'
      });
      return;
    }
    setSavingExpectedId(`${projectId}-${stage.id}`);
    try {
      await updateStage(projectId, stage.id, {
        expected_hours: hours,
        event_title: 'Expected time updated',
        event_meta: { action: 'update_expected_hours' }
      });
      await loadProjects();
      await alertDialog('Expected time updated.', { title: 'Expected time saved', confirmText: 'OK' });
    } catch (_error) {
      await alertDialog('Unable to update expected time.', { title: 'Action failed', confirmText: 'OK' });
    } finally {
      setSavingExpectedId('');
    }
  };

  const handleUploadFile = async (event) => {
    event.preventDefault();
    if (!selectedRow?.project?.id) return;
    if (!uploadFiles.length) {
      setFilesError('Select files to upload.');
      return;
    }
    setUploading(true);
    setFilesError('');
    try {
      for (const file of uploadFiles) {
        await uploadProjectFile(selectedRow.project.id, file, {
          filename: file.name,
          customer_visible: uploadAllowCustomer,
          contractor_visible: uploadAllowContractor
        });
      }
      const uploadedCount = uploadFiles.length;
      setUploadFiles([]);
      setUploadAllowCustomer(false);
      setUploadAllowContractor(false);
      await loadFiles(selectedRow.project.id);
      await alertDialog(uploadedCount === 1 ? 'File uploaded.' : `${uploadedCount} files uploaded.`, {
        title: 'Upload complete',
        confirmText: 'OK'
      });
    } catch (err) {
      setFilesError(err?.message || 'Unable to upload file.');
    } finally {
      setUploading(false);
    }
  };

  const handleFileDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setFileDragActive(false);
    const dropped = Array.from(event.dataTransfer?.files || []);
    if (dropped.length) setUploadFiles(dropped);
  };

  const handleUploadPhoto = async (event) => {
    event.preventDefault();
    if (!selectedRow?.project?.id) return;
    if (!photoUploads.length) {
      setPhotoError('Select photos to upload.');
      return;
    }
    setPhotoUploading(true);
    setPhotoError('');
    try {
      for (const file of photoUploads) {
        await uploadProjectFile(selectedRow.project.id, file, {
          filename: file.name,
          customer_visible: true,
          content_type: file.type || undefined
        });
      }
      const uploadedCount = photoUploads.length;
      setPhotoUploads([]);
      await loadFiles(selectedRow.project.id);
      await alertDialog(uploadedCount === 1 ? 'Photo uploaded.' : `${uploadedCount} photos uploaded.`, {
        title: 'Upload complete',
        confirmText: 'OK'
      });
    } catch (err) {
      setPhotoError(err?.message || 'Unable to upload photo.');
    } finally {
      setPhotoUploading(false);
    }
  };

  const handlePhotoDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setPhotoDragActive(false);
    const dropped = Array.from(event.dataTransfer?.files || []);
    if (!dropped.length) return;
    const images = dropped.filter(isImageUploadFile);
    if (!images.length) {
      setPhotoError('Please drop image files only.');
      return;
    }
    if (images.length < dropped.length) {
      setPhotoError('Some non-image files were ignored.');
    } else {
      setPhotoError('');
    }
    setPhotoUploads(images);
  };

  const handleToggleFileVisibility = async (fileRecord, field, nextValue) => {
    if (!selectedRow?.project?.id || !fileRecord?.id) return;
    if (!['customer_visible', 'contractor_visible'].includes(field)) return;
    try {
      const updated = await setProjectFileVisibility(selectedRow.project.id, fileRecord.id, {
        [field]: nextValue
      });
      setFiles((prev) =>
        prev.map((item) =>
          item.id === fileRecord.id
            ? { ...item, ...(updated || {}), [field]: nextValue }
            : item
        )
      );
    } catch (_err) {
      setFilesError('Unable to update file visibility.');
    }
  };

  const handleViewFile = async (fileRecord) => {
    if (!selectedRow?.project?.id || !fileRecord?.id) return;
    setFilesError('');
    const name = fileRecord.filename || 'File preview';
    setPreviewRecord(fileRecord);
    setPreview({ open: true, url: '', name, kind: 'loading', text: '' });
    setPreviewLoading(true);
    try {
      const blob = await downloadProjectFile(selectedRow.project.id, fileRecord.id);
      if (isImageFile(fileRecord)) {
        const url = window.URL.createObjectURL(blob);
        setPreview({ open: true, url, name, kind: 'image', text: '' });
        return;
      }
      if (isTextFile(fileRecord)) {
        const isTruncated = blob.size > TEXT_PREVIEW_LIMIT_BYTES;
        const textBlob = isTruncated ? blob.slice(0, TEXT_PREVIEW_LIMIT_BYTES) : blob;
        const text = await textBlob.text();
        setPreview({ open: true, url: '', name, kind: 'text', text });
        if (isTruncated) {
          setFilesError('Showing partial text preview (first 1 MB). Download for full file.');
        }
        return;
      }
      if (isPdfFile(fileRecord)) {
        const url = window.URL.createObjectURL(blob);
        setPreview({ open: true, url, name, kind: 'pdf', text: '' });
        return;
      }
      setPreview({ open: false, url: '', name: '', kind: '', text: '' });
      setPreviewRecord(null);
      setFilesError('Preview unavailable for this file type. Use Download.');
    } catch (_err) {
      setPreview({ open: false, url: '', name: '', kind: '', text: '' });
      setPreviewRecord(null);
      setFilesError('Unable to open file.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDownloadFile = async (fileRecord) => {
    if (!selectedRow?.project?.id || !fileRecord?.id) return;
    setFilesError('');
    try {
      const blob = await downloadProjectFile(selectedRow.project.id, fileRecord.id);
      triggerBrowserDownload(blob, fileRecord.filename);
    } catch (_err) {
      setFilesError('Unable to download file.');
    }
  };

  const handleDeleteFile = async (fileRecord) => {
    if (!selectedRow?.project?.id || !fileRecord?.id) return;
    const shouldDelete = await confirmDialog(`Delete ${fileRecord.filename}? This cannot be undone.`, {
      title: 'Delete file',
      confirmText: 'Delete'
    });
    if (!shouldDelete) return false;
    try {
      await deleteProjectFile(selectedRow.project.id, fileRecord.id);
      setFiles((prev) => prev.filter((item) => item.id !== fileRecord.id));
      return true;
    } catch (_err) {
      setFilesError('Unable to delete file.');
      return false;
    }
  };

  const handleDeletePreviewFile = async () => {
    if (!previewRecord) return;
    const deleted = await handleDeleteFile(previewRecord);
    if (deleted) {
      closePreview();
    }
  };

  const getRowAction = (project, stage) => {
    if (!stage) return null;
    if (stage.status === 'awaiting_approval') {
      return {
        label: 'Accept',
        className: 'primary',
        onClick: () => handleAccept(project.id, stage.id)
      };
    }
    if (stage.status === 'in_progress') {
      return {
        label: 'Send to next step',
        className: 'ghost',
        onClick: () => handleComplete(project.id, stage.id)
      };
    }
    return null;
  };

  const notesHistoryText = areaNoteHistory.length
    ? [...areaNoteHistory]
        .sort((a, b) => new Date(a?.created_at || 0).getTime() - new Date(b?.created_at || 0).getTime())
        .map((entry) => {
          const when = formatAcceptedAt(entry.created_at);
          const user = entry.created_by || '-';
          const area = entry.stage_name || entry.stage_id || '-';
          const note = String(entry.note || '').trim() || '-';
          return `When: ${when}\nUser: ${user}\nArea: ${area}\nNote:\n${note}`;
        })
        .join('\n\n')
    : '';
  const detailSummary = useMemo(
    () => parseProjectSummary(selectedRow?.project?.summary || ''),
    [selectedRow?.project?.summary]
  );
  const sortedRows = useMemo(() => [...rows].sort(compareRowsByProjectNumber), [rows]);
  return (
    <>
      <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Areas</h2>
          <p className="muted">Accept projects and send them to the next step.</p>
        </div>
        <div className="pipeline-area-select">
          <span className="muted">Area</span>
          <select value={selectedArea} onChange={(event) => setSelectedArea(event.target.value)}>
            {areaOptions.map((area) => (
              <option key={area} value={area}>{area}</option>
            ))}
          </select>
        </div>
      </div>
      {loading ? <p className="muted">Loading area queue...</p> : null}
      <div className="table-scroll">
        <table className="project-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Project</th>
              <th>Status</th>
              <th>Accepted</th>
              <th>Countdown</th>
              <th>Expected</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length ? (
              sortedRows.map(({ project, stage }) => {
                const countdown = countdownForStage(stage, nowMs);
                const action = getRowAction(project, stage);

                return (
                  <tr
                    key={`${project.id}-${stage.id}`}
                    onDoubleClick={() => {
                      setSelectedRow({ project, stage });
                      setDetailTab('details');
                    }}
                  >
                    <td>{project.project_number || '-'}</td>
                    <td>{project.name}</td>
                    <td>{STATUS_LABELS[stage.status] || stage.status}</td>
                    <td>{formatAcceptedAt(stage.started_at)}</td>
                    <td>
                      <span className={`status-pill ${countdown.tone}`}>{countdown.label}</span>
                    </td>
                    <td>
                      <div className="expected-cell">
                        <span>{stage.expected_hours ? `${stage.expected_hours}h` : '-'}</span>
                        {canEditExpectedTime ? (
                          <button
                            type="button"
                            className="ghost tiny-button"
                            onClick={() => handleEditExpected(project.id, stage)}
                            disabled={savingExpectedId === `${project.id}-${stage.id}`}
                          >
                            {savingExpectedId === `${project.id}-${stage.id}` ? 'Saving...' : 'Edit'}
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      {action ? (
                        <div className="actions-grid">
                          <button type="button" className={action.className} onClick={action.onClick}>
                            {action.label}
                          </button>
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr className="empty-row">
                <td colSpan={7}>No projects ready for this area.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      </section>

      {selectedRow ? (
        <section className="panel">
          <div className="detail-card-header">
            <div>
              <h3>{selectedRow.project.name}</h3>
              <p className="muted">{selectedRow.project.project_number || '-'}</p>
            </div>
          </div>
          <div className="stage-tabs detail-tabs" role="tablist" aria-label="Area detail sections">
            {DETAIL_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={detailTab === tab.id}
                className={`stage-tab${detailTab === tab.id ? ' active' : ''}`}
                onClick={() => setDetailTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="detail-grid">
            {detailTab === 'details' ? (
            <div className="detail-card">
              <div className="form-grid project-detail-form">
                <label>
                  Requester
                  <input value={selectedRow.project.requester || ''} readOnly />
                </label>
                <label>
                  Due date
                  <input value={selectedRow.project.due_date || ''} readOnly />
                </label>
                <label>
                  Urgency
                  <input value={selectedRow.project.urgency || ''} readOnly />
                </label>
                <label>
                  Budget
                  <input value={selectedRow.project.budget || ''} readOnly />
                </label>
                <div className="intake-docs span-2" role="group" aria-labelledby="area-required-docs-title">
                  <div id="area-required-docs-title" className="intake-docs-title">
                    Required docs
                  </div>
                  <div className="intake-docs-grid">
                    {REQUIRED_DOC_OPTIONS.map((option) => (
                      <label key={option.id} className="intake-doc-option">
                        <input type="checkbox" checked={Boolean(detailSummary.requiredDocs?.[option.id])} readOnly disabled />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <label className="span-2">
                  Notes
                  <textarea value={detailSummary.notes || ''} rows={3} readOnly placeholder="No notes." />
                </label>
              </div>
              <div className="area-notes-history">
                <div className="detail-card-header">
                  <h3>All notes ({selectedArea})</h3>
                </div>
                {areaNoteHistoryLoading ? <p className="muted">Loading notes...</p> : null}
                <textarea
                  className="notes-history-window"
                  value={notesHistoryText}
                  readOnly
                  rows={12}
                  placeholder="No notes yet for this area."
                />
              </div>
              <div className="area-notes-editor">
                <label>
                  Add note
                  <textarea
                    value={areaNoteDraft}
                    onChange={(event) => setAreaNoteDraft(event.target.value)}
                    rows={3}
                    placeholder="Type a new note for this area stage"
                  />
                </label>
                <div className="actions-grid">
                  <button
                    type="button"
                    className="ghost"
                    onClick={handleSaveAreaNote}
                    disabled={areaNoteSaving}
                  >
                    {areaNoteSaving ? 'Saving...' : 'Add note'}
                  </button>
                </div>
              </div>
            </div>
            ) : null}

            {detailTab === 'stages' ? (
            <div className="detail-card">
              <h3>Current stage</h3>
              <div className="table-scroll project-stage-table">
                <table className="project-table">
                  <thead>
                    <tr>
                      <th>Stage</th>
                      <th>Owner</th>
                      <th>Status</th>
                      <th>Accepted</th>
                      <th>Expected</th>
                      <th>Countdown</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{formatStageName(selectedRow.stage.name, selectedRow.stage.id)}</td>
                      <td>{selectedRow.stage.owner}</td>
                      <td>
                        <span className={`status-pill ${stageStatusClass(selectedRow.stage.status)}`}>
                          {STATUS_LABELS[selectedRow.stage.status] || selectedRow.stage.status}
                        </span>
                      </td>
                      <td>{formatAcceptedAt(selectedRow.stage.started_at)}</td>
                      <td>
                        <div className="expected-cell">
                          <span>
                            {selectedRow.stage.expected_hours
                              ? `${selectedRow.stage.expected_hours}h`
                              : '-'}
                          </span>
                          {canEditExpectedTime ? (
                            <button
                              type="button"
                              className="ghost tiny-button"
                              onClick={() => handleEditExpected(selectedRow.project.id, selectedRow.stage)}
                              disabled={savingExpectedId === `${selectedRow.project.id}-${selectedRow.stage.id}`}
                            >
                              {savingExpectedId === `${selectedRow.project.id}-${selectedRow.stage.id}`
                                ? 'Saving...'
                                : 'Edit'}
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <span className={`status-pill ${countdownForStage(selectedRow.stage, nowMs).tone}`}>
                          {countdownForStage(selectedRow.stage, nowMs).label}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="actions-grid">
                {getRowAction(selectedRow.project, selectedRow.stage) ? (
                  <button
                    type="button"
                    className={getRowAction(selectedRow.project, selectedRow.stage).className}
                    onClick={getRowAction(selectedRow.project, selectedRow.stage).onClick}
                  >
                    {getRowAction(selectedRow.project, selectedRow.stage).label}
                  </button>
                ) : (
                  <span className="muted">No actions available for your role.</span>
                )}
              </div>
            </div>
            ) : null}

            {detailTab === 'files' ? (
            <div className="detail-card">
              <div className="detail-card-header">
                <h3>Files</h3>
              </div>
              <form className="file-upload-form" onSubmit={handleUploadFile}>
                <input
                  id="areas-file-upload"
                  className="file-upload-input"
                  type="file"
                  multiple
                  onChange={(event) => setUploadFiles(Array.from(event.target.files || []))}
                />
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
                    <span className="file-drop-icon" aria-hidden="true">+</span>
                    <span>{fileDragActive ? 'Drop files to upload' : 'Drag and drop files here'}</span>
                  </div>
                  <span className="file-upload-name">
                    {summarizeSelection(uploadFiles, 'No files selected', 'files')}
                  </span>
                </div>
                <div className="file-upload-actions">
                  <div className="file-upload-controls">
                    <label htmlFor="areas-file-upload" className="ghost file-upload-button">
                      Choose files
                    </label>
                    <button className="primary" type="submit" disabled={!uploadFiles.length || uploading}>
                      {uploading ? 'Uploading...' : 'Upload files'}
                    </button>
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
              </form>
              {filesLoading ? <p className="muted">Loading files...</p> : null}
              <div className="photo-gallery-panel">
                {documentFiles.length ? (
                  <div className="photo-gallery upload-card-gallery">
                    {documentFiles.map((fileRecord) => (
                      <div key={fileRecord.id} className="photo-card file-card compact-upload-card">
                        <button
                          className="file-card-open"
                          type="button"
                          onClick={() => handleViewFile(fileRecord)}
                        >
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
                              <span>{formatAcceptedAt(fileRecord.created_at)}</span>
                              <span>{formatBytes(fileRecord.size_bytes)}</span>
                            </div>
                          </div>
                        </button>
                        <label className="switch-field compact-card-switch">
                          <input
                            type="checkbox"
                            checked={coerceBool(fileRecord.customer_visible)}
                            onChange={(event) =>
                              handleToggleFileVisibility(fileRecord, 'customer_visible', event.target.checked)
                            }
                          />
                          <span className="switch-track" aria-hidden="true">
                            <span className="switch-thumb" />
                          </span>
                          <span className="switch-text">Customer view</span>
                        </label>
                        <label className="switch-field compact-card-switch">
                          <input
                            type="checkbox"
                            checked={coerceBool(fileRecord.contractor_visible)}
                            onChange={(event) =>
                              handleToggleFileVisibility(fileRecord, 'contractor_visible', event.target.checked)
                            }
                          />
                          <span className="switch-track" aria-hidden="true">
                            <span className="switch-thumb" />
                          </span>
                          <span className="switch-text">Contractor view</span>
                        </label>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <p className="muted">No files uploaded yet.</p>
                  </div>
                )}
              </div>
            </div>
            ) : null}

            {detailTab === 'files' ? (
            <div className="detail-card">
              <div className="detail-card-header">
                <h3>Photos</h3>
                <span className="muted">Shared with the customer.</span>
              </div>
              <form className="file-upload-form" onSubmit={handleUploadPhoto}>
                <input
                  id="areas-photo-upload"
                  className="file-upload-input"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => {
                    const images = Array.from(event.target.files || []).filter(isImageUploadFile);
                    setPhotoUploads(images);
                    if (!images.length && (event.target.files || []).length) {
                      setPhotoError('Please select image files only.');
                    } else {
                      setPhotoError('');
                    }
                  }}
                />
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
                    <span className="file-drop-icon" aria-hidden="true">+</span>
                    <span>{photoDragActive ? 'Drop photos to upload' : 'Drag and drop photos here'}</span>
                  </div>
                  <span className="file-upload-name">
                    {summarizeSelection(photoUploads, 'No photos selected', 'photos')}
                  </span>
                </div>
                <div className="file-upload-actions">
                  <div className="file-upload-controls">
                    <label htmlFor="areas-photo-upload" className="ghost file-upload-button">
                      Choose photos
                    </label>
                    <button className="primary" type="submit" disabled={!photoUploads.length || photoUploading}>
                      {photoUploading ? 'Uploading...' : 'Upload photos'}
                    </button>
                  </div>
                  <span className="muted">Photos are visible to the linked customer.</span>
                  <span className="file-upload-selected">
                    {summarizeSelection(photoUploads, 'No photos selected', 'photos')}
                  </span>
                </div>
              </form>
              <div className="photo-gallery-panel">
                {photoFiles.length ? (
                  <div className="photo-gallery upload-card-gallery">
                    {photoFiles.map((fileRecord) => (
                      <div key={fileRecord.id} className="photo-card compact-upload-card">
                        <button
                          className="file-card-open"
                          type="button"
                          onClick={() => handleViewFile(fileRecord)}
                        >
                          <div className="photo-thumb-wrap">
                            {cardPreviewUrls[fileRecord.id] ? (
                              <img className="photo-thumb" src={cardPreviewUrls[fileRecord.id]} alt={fileRecord.filename} />
                            ) : (
                              <div className="photo-thumb-placeholder">
                                {cardPreviewStatus[fileRecord.id] === 'loading' ? 'Loading...' : 'No preview'}
                              </div>
                            )}
                          </div>
                          <div className="photo-meta">
                            <div className="photo-name" title={fileRecord.filename}>
                              {fileRecord.filename}
                            </div>
                            <div className="photo-sub muted">
                              <span>{formatAcceptedAt(fileRecord.created_at)}</span>
                              <span>{formatBytes(fileRecord.size_bytes)}</span>
                            </div>
                          </div>
                        </button>
                        <label className="switch-field compact-card-switch">
                          <input
                            type="checkbox"
                            checked={coerceBool(fileRecord.customer_visible)}
                            onChange={(event) =>
                              handleToggleFileVisibility(fileRecord, 'customer_visible', event.target.checked)
                            }
                          />
                          <span className="switch-track" aria-hidden="true">
                            <span className="switch-thumb" />
                          </span>
                          <span className="switch-text">Customer view</span>
                        </label>
                        <label className="switch-field compact-card-switch">
                          <input
                            type="checkbox"
                            checked={coerceBool(fileRecord.contractor_visible)}
                            onChange={(event) =>
                              handleToggleFileVisibility(fileRecord, 'contractor_visible', event.target.checked)
                            }
                          />
                          <span className="switch-track" aria-hidden="true">
                            <span className="switch-thumb" />
                          </span>
                          <span className="switch-text">Contractor view</span>
                        </label>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <p className="muted">No photos uploaded yet.</p>
                  </div>
                )}
              </div>
            </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {preview.open ? (
        <ModalPortal>
          <div className="modal-backdrop preview-backdrop" onClick={closePreview}>
            <div className="modal file-preview-modal" onClick={(event) => event.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">{preview.name}</div>
                <div className="file-preview-header-actions">
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => previewRecord && handleDownloadFile(previewRecord)}
                    disabled={!previewRecord}
                  >
                    Download
                  </button>
                  {canEditExpectedTime ? (
                    <button
                      className="ghost danger"
                      type="button"
                      onClick={handleDeletePreviewFile}
                      disabled={!previewRecord}
                    >
                      Delete
                    </button>
                  ) : null}
                  <button className="ghost" type="button" onClick={closePreview}>
                    Close
                  </button>
                </div>
              </div>
              <div className="file-preview-body">
                {previewLoading || preview.kind === 'loading' ? (
                  <div className="file-preview-loading">
                    <div className="file-preview-spinner" aria-hidden="true" />
                    <p>Opening file preview...</p>
                  </div>
                ) : preview.kind === 'image' ? (
                  <img src={preview.url} alt={preview.name} />
                ) : preview.kind === 'text' ? (
                  <pre className="file-preview-text">{preview.text || 'No preview available.'}</pre>
                ) : preview.kind === 'pdf' ? (
                  <object className="file-preview-frame" data={preview.url} type="application/pdf">
                    <div className="file-preview-fallback">PDF preview unavailable. Download to open.</div>
                  </object>
                ) : (
                  <div className="file-preview-fallback">Preview unavailable for this file type.</div>
                )}
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}

      <BlockingOverlay
        open={stageMoveLoading}
        title="Moving project to next stage..."
        message="Please wait while the handoff completes."
      />

      {dialogPortal}

    </>
  );
}
