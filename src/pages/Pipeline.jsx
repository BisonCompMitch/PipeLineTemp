import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  archiveProject,
  compressProjectFiles,
  deleteProject,
  deleteProjectFile,
  downloadProjectFile,
  getProject,
  listContractors,
  listProjectAreaNotes,
  listProjectFiles,
  listProjects,
  restoreProject,
  setProjectFileVisibility,
  updateStage,
  updateProject,
  uploadProjectFile
} from '../api.js';
import ModalPortal from '../components/ModalPortal.jsx';
import { formatStageName, normalizeProjectStages, STAGE_FLOW } from '../utils/stageDisplay.js';

const NOTICE_LEVELS = ['green', 'yellow', 'red'];
const TONE_COLORS = {
  green: '#C8F2D1',
  yellow: '#FDE68A',
  red: '#FCA5A5',
  neutral: 'rgba(148, 163, 184, 0.2)'
};
const TONE_LABELS = {
  green: 'On Time',
  yellow: 'Behind',
  red: 'Critical',
  neutral: 'On Time'
};
const AREA_COLORS = {
  plans_received: '#D9D5FF',
  budget: '#C9D1DA',
  money_design: '#C4CEDB',
  design: '#A5C9FF',
  engineering: '#A6F0FF',
  estimating: '#AEEFE6',
  money_production: '#FFE08F',
  manufacturing: '#FFD2A8',
  money_shipping: '#FFD0B5',
  final_payment: '#FCA5A5',
  shipping: '#CFF4A8',
  completed: '#9FF0BD'
};

const DETAIL_TABS = [
  { id: 'project', label: 'Project' },
  { id: 'files', label: 'Files & Photos' }
];

const DASHBOARD_FILTER_ALL = '__all__';

const ALL_AREA_STAGE_IDS = STAGE_FLOW.map((stage) => stage.id);

const AREA_FILTER_TO_STAGE_IDS = {
  'plans recieved': ['plans_received'],
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

function currentStage(stages = []) {
  if (!Array.isArray(stages) || stages.length === 0) return null;
  return stages.find((stage) => stage.status !== 'complete') || stages[stages.length - 1];
}

function stageNoticeTone(stage) {
  if (!stage) return 'neutral';
  if (stage.id === 'final_payment' && stage.status !== 'complete') {
    return 'red';
  }
  if (!['in_progress', 'awaiting_approval'].includes(stage.status)) {
    return NOTICE_LEVELS.includes(stage.notice) ? stage.notice : 'neutral';
  }
  const expected = Number(stage.expected_hours ?? stage.default_duration_hours ?? 0);
  if (!stage.started_at || expected <= 0) return 'green';
  const elapsedMs = Date.now() - new Date(stage.started_at).getTime();
  const elapsedHours = elapsedMs / 3600000;
  const delta = elapsedHours - expected;
  let computed = 'green';
  if (delta >= 20) {
    computed = 'red';
  } else if (delta >= -5 && delta <= 3) {
    computed = 'yellow';
  }
  if (NOTICE_LEVELS.includes(stage.notice)) {
    const severity = { green: 0, yellow: 1, red: 2 };
    if (severity[stage.notice] > severity[computed]) {
      return stage.notice;
    }
  }
  return computed;
}

function completionPercent(stages = []) {
  if (!Array.isArray(stages) || stages.length === 0) return 0;
  const relevant = stages.filter((stage) => stage.id !== 'completed');
  const total = relevant.length || stages.length;
  const done = relevant.filter((stage) => stage.status === 'complete').length;
  return Math.round((done / total) * 100);
}

function textColorForHex(color) {
  if (!color || color[0] !== '#' || color.length !== 7) {
    return '#111827';
  }
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 140 ? '#111827' : '#f8fafc';
}

function sortByProjectNumber(a, b) {
  const aRaw = (a.projectNumber || '').toString().trim();
  const bRaw = (b.projectNumber || '').toString().trim();
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

function isCompletedDashboardRow(row) {
  const areaId = String(row?.areaId || '').trim().toLowerCase();
  const areaName = String(row?.area || '').trim().toLowerCase();
  return areaId === 'completed' || areaName === 'completed';
}

function toRow(project) {
  const normalizedStages = normalizeProjectStages(project.stages || []);
  const stage = currentStage(normalizedStages);
  return {
    id: project.id,
    projectNumber: project.project_number || '',
    name: project.name || 'Unnamed project',
    area: formatStageName(stage?.name, stage?.id) || 'Pending',
    areaId: stage?.id || '',
    areaNote: String(stage?.area_note || '').trim(),
    areaNoteUpdatedBy: String(stage?.area_note_updated_by || '').trim(),
    areaNoteUpdatedAt: stage?.area_note_updated_at || null,
    progress: completionPercent(normalizedStages),
    statusTone: stageNoticeTone(stage),
    isDeleted: Boolean(project.is_deleted),
    project
  };
}

function toEditForm(project) {
  return {
    project_number: project?.project_number || '',
    name: project?.name || '',
    requester: project?.requester || '',
    due_date: project?.due_date || '',
    urgency: project?.urgency || 'standard',
    budget: project?.budget || '',
    summary: project?.summary || ''
  };
}

function stageStatusClass(status) {
  if (status === 'complete') return 'complete';
  if (status === 'in_progress') return 'progress';
  if (status === 'awaiting_approval') return 'warning';
  return 'neutral';
}

function formatDateTime(value) {
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

function trimOrNull(value) {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed : null;
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

function dashboardAreaNotesKey(projectId, stageId) {
  const project = String(projectId || '').trim();
  const stage = String(stageId || '').trim();
  if (!project || !stage) return '';
  return `${project}:${stage}`;
}

function formatDashboardAreaNotesTooltip(entries = [], areaName = '') {
  const safeAreaName = formatStageName(areaName) || 'Area';
  if (!entries.length) {
    return `All notes (${safeAreaName})\n\nNo notes yet.`;
  }
  const body = entries
    .map((entry) => {
      const user = String(entry?.created_by || '').trim() || '-';
      const note = String(entry?.note || '').trim() || '-';
      return `User: ${user}\nNote:\n${note}`;
    })
    .join('\n\n');
  return `All notes (${safeAreaName})\n\n${body}`;
}

function formatStageNotesTooltip(entries = [], stageName = '') {
  const safeStageName = formatStageName(stageName) || 'Stage';
  if (!entries.length) {
    return `All notes (${safeStageName})\n\nNo notes yet.`;
  }
  const body = entries
    .map((entry) => {
      const user = String(entry?.created_by || '').trim() || '-';
      const note = String(entry?.note || '').trim() || '-';
      return `User: ${user}\nNote:\n${note}`;
    })
    .join('\n\n');
  return `All notes (${safeStageName})\n\n${body}`;
}

export default function Pipeline({
  canEditProjects = false,
  canEditProjectDetails = false,
  applyAreaFilter = false,
  allowedAreas = [],
  canViewAllAreas = false,
  showHoverNotes = false
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailStatus, setDetailStatus] = useState('');
  const [detailProject, setDetailProject] = useState(null);
  const [detailTab, setDetailTab] = useState('project');
  const [projectActionBusy, setProjectActionBusy] = useState('');
  const [detailForm, setDetailForm] = useState(toEditForm(null));
  const [detailStageNoteDraft, setDetailStageNoteDraft] = useState('');
  const [detailStageNoteSaving, setDetailStageNoteSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [areaSelection, setAreaSelection] = useState('');
  const [dashboardAreaNotes, setDashboardAreaNotes] = useState(() => ({}));
  const [stageNotesHistory, setStageNotesHistory] = useState([]);
  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState('');
  const [uploadFiles, setUploadFiles] = useState([]);
  const [uploadAllowCustomer, setUploadAllowCustomer] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoUploads, setPhotoUploads] = useState([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [fileDragActive, setFileDragActive] = useState(false);
  const [photoDragActive, setPhotoDragActive] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRecord, setPreviewRecord] = useState(null);
  const [cardPreviewUrls, setCardPreviewUrls] = useState({});
  const [cardPreviewStatus, setCardPreviewStatus] = useState({});
  const [preview, setPreview] = useState({
    open: false,
    url: '',
    name: '',
    kind: '',
    text: ''
  });
  const cardPreviewUrlRef = useRef({});
  const previewBlobCacheRef = useRef(new Map());
  const [contractorCompanies, setContractorCompanies] = useState([]);
  const [dashboardRequesterFilter, setDashboardRequesterFilter] = useState(DASHBOARD_FILTER_ALL);
  const [splitDashboardLayout, setSplitDashboardLayout] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 1101px)').matches
      : true
  );

  const closePreview = useCallback(() => {
    if (preview.url) {
      window.URL.revokeObjectURL(preview.url);
    }
    setPreviewLoading(false);
    setPreviewRecord(null);
    setPreview({ open: false, url: '', name: '', kind: '', text: '' });
  }, [preview.url]);

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
    if (!detailProject?.id) {
      previewBlobCacheRef.current.clear();
      replaceCardPreviewUrls({});
      setCardPreviewStatus({});
      return;
    }
    const prefix = `${detailProject.id}:`;
    Array.from(previewBlobCacheRef.current.keys()).forEach((key) => {
      if (!key.startsWith(prefix)) {
        previewBlobCacheRef.current.delete(key);
      }
    });
  }, [detailProject?.id, replaceCardPreviewUrls]);

  useEffect(() => {
    let cancelled = false;
    const loadCardPreviews = async () => {
      if (!detailProject?.id || !files.length) {
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
          const key = `${detailProject.id}:${fileRecord.id}`;
          try {
            let blob = previewBlobCacheRef.current.get(key);
            if (!blob) {
              blob = await downloadProjectFile(detailProject.id, fileRecord.id);
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
  }, [files, detailProject?.id, replaceCardPreviewUrls]);

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

  const allowedStageIds = useMemo(() => {
    if (!applyAreaFilter || canViewAllAreas) return null;
    const set = new Set();
    (allowedAreas || []).forEach((area) => {
      const key = String(area || '').trim().toLowerCase();
      (AREA_FILTER_TO_STAGE_IDS[key] || []).forEach((stageId) => set.add(stageId));
    });
    return set;
  }, [applyAreaFilter, canViewAllAreas, allowedAreas]);
  const requesterOptions = useMemo(() => {
    const unique = new Map();
    rows.forEach((row) => {
      const value = String(row?.project?.requester || '').trim();
      if (!value) return;
      const key = value.toLowerCase();
      if (!unique.has(key)) unique.set(key, value);
    });
    const detailRequester = String(detailProject?.requester || '').trim();
    if (detailRequester) {
      const key = detailRequester.toLowerCase();
      if (!unique.has(key)) unique.set(key, detailRequester);
    }
    contractorCompanies.forEach((company) => {
      const value = String(company || '').trim();
      if (!value) return;
      const key = value.toLowerCase();
      if (!unique.has(key)) unique.set(key, value);
    });
    return Array.from(unique.values()).sort((a, b) => a.localeCompare(b));
  }, [rows, detailProject, contractorCompanies]);
  const dashboardRequesterOptions = useMemo(() => {
    const unique = new Map();
    rows.forEach((row) => {
      const value = String(row?.project?.requester || '').trim();
      if (!value) return;
      const key = value.toLowerCase();
      if (!unique.has(key)) unique.set(key, value);
    });
    contractorCompanies.forEach((company) => {
      const value = String(company || '').trim();
      if (!value) return;
      const key = value.toLowerCase();
      if (!unique.has(key)) unique.set(key, value);
    });
    return Array.from(unique.values()).sort((a, b) => a.localeCompare(b));
  }, [rows, contractorCompanies]);
  const visibleRows = useMemo(() => {
    if (dashboardRequesterFilter === DASHBOARD_FILTER_ALL) return rows;
    const selected = String(dashboardRequesterFilter || '').trim().toLowerCase();
    if (!selected) return rows;
    return rows.filter((row) => String(row?.project?.requester || '').trim().toLowerCase() === selected);
  }, [rows, dashboardRequesterFilter]);
  const dashboardRows = useMemo(() => {
    const ordered = [...visibleRows].sort(sortByProjectNumber);
    const active = [];
    const completed = [];
    ordered.forEach((row) => {
      if (isCompletedDashboardRow(row)) {
        completed.push(row);
      } else {
        active.push(row);
      }
    });
    return [...active, ...completed];
  }, [visibleRows]);
  const dashboardColumns = useMemo(() => {
    if (!dashboardRows.length) return [[], []];
    const splitIndex = Math.ceil(dashboardRows.length / 2);
    return [dashboardRows.slice(0, splitIndex), dashboardRows.slice(splitIndex)];
  }, [dashboardRows]);

  const photoFiles = useMemo(() => files.filter(isImageFile), [files]);
  const documentFiles = useMemo(() => files.filter((fileRecord) => !isImageFile(fileRecord)), [files]);
  const detailStages = useMemo(
    () => normalizeProjectStages(detailProject?.stages || []),
    [detailProject?.stages]
  );
  const projectIsComplete = useMemo(() => {
    const stages = detailStages;
    if (!stages.length) return false;
    return stages.every((stage) => String(stage.status || '').toLowerCase() === 'complete');
  }, [detailStages]);
  const detailCurrentStage = useMemo(
    () => currentStage(detailStages),
    [detailStages]
  );
  const detailProgress = useMemo(
    () => completionPercent(detailStages),
    [detailStages]
  );
  const stageNoteTooltipByStageId = useMemo(() => {
    const grouped = new Map();
    stageNotesHistory.forEach((entry) => {
      const key = String(entry?.stage_id || '').trim();
      if (!key) return;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(entry);
    });
    const tooltips = new Map();
    detailStages.forEach((stage) => {
      const entries = [...(grouped.get(stage.id) || [])].sort(
        (a, b) => new Date(a?.created_at || 0).getTime() - new Date(b?.created_at || 0).getTime()
      );
      tooltips.set(stage.id, formatStageNotesTooltip(entries, formatStageName(stage.name, stage.id)));
    });
    return tooltips;
  }, [stageNotesHistory, detailStages]);
  const stageNoteCountByStageId = useMemo(() => {
    const counts = new Map();
    stageNotesHistory.forEach((entry) => {
      const key = String(entry?.stage_id || '').trim();
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [stageNotesHistory]);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listProjects(showArchived ? 'include_deleted=true' : '');
      const mapped = (Array.isArray(data) ? data : []).map(toRow);
      const filtered =
        allowedStageIds === null
          ? mapped
          : mapped.filter((row) => row.areaId && allowedStageIds.has(row.areaId));
      setRows(filtered.sort(sortByProjectNumber));
      setDashboardAreaNotes({});
    } catch (_err) {
      setRows([]);
      setError('Unable to reach the projects list.');
      setDashboardAreaNotes({});
    } finally {
      setLoading(false);
    }
  }, [showArchived, allowedStageIds]);

  const loadDashboardAreaNotes = useCallback(async (projectId, stageId, areaName) => {
    const key = dashboardAreaNotesKey(projectId, stageId);
    if (!key) return;
    const existing = dashboardAreaNotes[key];
    if (existing?.status === 'ready' || existing?.status === 'loading') return;
    setDashboardAreaNotes((prev) => ({
      ...prev,
      [key]: { status: 'loading', tooltip: `Loading notes for ${areaName || 'area'}...` }
    }));
    try {
      const params = new URLSearchParams();
      params.set('stage_ids', String(stageId));
      params.set('limit', '1000');
      const data = await listProjectAreaNotes(projectId, params.toString());
      const entries = Array.isArray(data)
        ? [...data].sort((a, b) => new Date(a?.created_at || 0).getTime() - new Date(b?.created_at || 0).getTime())
        : [];
      setDashboardAreaNotes((prev) => ({
        ...prev,
        [key]: {
          status: 'ready',
          tooltip: formatDashboardAreaNotesTooltip(entries, areaName)
        }
      }));
    } catch (_err) {
      setDashboardAreaNotes((prev) => ({
        ...prev,
        [key]: {
          status: 'error',
          tooltip: `Unable to load notes for ${areaName || 'area'}.`
        }
      }));
    }
  }, [dashboardAreaNotes]);

  const loadFiles = useCallback(async (projectId) => {
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
  }, []);

  const loadStageNotesHistory = useCallback(async (projectId) => {
    if (!projectId) {
      setStageNotesHistory([]);
      return;
    }
    try {
      const params = new URLSearchParams();
      params.set('limit', '1000');
      const data = await listProjectAreaNotes(projectId, params.toString());
      setStageNotesHistory(Array.isArray(data) ? data : []);
    } catch (_err) {
      setStageNotesHistory([]);
    }
  }, []);

  React.useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (dashboardRequesterFilter === DASHBOARD_FILTER_ALL) return;
    const selected = String(dashboardRequesterFilter || '').trim().toLowerCase();
    const stillPresent = dashboardRequesterOptions.some(
      (option) => String(option || '').trim().toLowerCase() === selected
    );
    if (!stillPresent) {
      setDashboardRequesterFilter(DASHBOARD_FILTER_ALL);
    }
  }, [dashboardRequesterFilter, dashboardRequesterOptions]);

  useEffect(() => {
    let active = true;
    const loadCompanies = async () => {
      try {
        const data = await listContractors();
        if (!active) return;
        const unique = new Map();
        (Array.isArray(data) ? data : []).forEach((contractor) => {
          const value = String(contractor?.company || '').trim();
          if (!value) return;
          const key = value.toLowerCase();
          if (!unique.has(key)) unique.set(key, value);
        });
        setContractorCompanies(Array.from(unique.values()).sort((a, b) => a.localeCompare(b)));
      } catch (_err) {
        if (active) setContractorCompanies([]);
      }
    };
    loadCompanies();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(min-width: 1101px)');
    const onChange = () => setSplitDashboardLayout(media.matches);
    onChange();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  useEffect(() => {
    if (!detailStages.length) {
      setAreaSelection('');
      return;
    }
    const current = currentStage(detailStages);
    setAreaSelection(current?.id || '');
  }, [detailStages]);

  useEffect(() => {
    setDetailStageNoteDraft('');
  }, [detailCurrentStage?.id]);

  const stageOptions = useMemo(() => [...detailStages], [detailStages]);

  const openDetails = async (row) => {
    if (!row?.id) return;
    setDetailOpen(true);
    setDetailTab('project');
    setDetailError('');
    setDetailStatus('');
    setDetailProject(row.project || null);
    setDetailForm(toEditForm(row.project));
    setDetailStageNoteSaving(false);
    setDetailStageNoteDraft('');
    setDetailLoading(true);
    try {
      const latest = await getProject(row.id);
      setDetailProject(latest);
      setDetailForm(toEditForm(latest));
      setDetailStageNoteDraft('');
      setRows((prev) => prev.map((item) => (item.id === row.id ? toRow(latest) : item)));
      await loadFiles(row.id);
      await loadStageNotesHistory(row.id);
    } catch (_err) {
      setDetailError('Unable to load project details.');
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetails = () => {
    if (saving) return;
    setDetailOpen(false);
    setDetailTab('project');
    setDetailError('');
    setDetailStatus('');
    setProjectActionBusy('');
    setDetailProject(null);
    setDetailStageNoteDraft('');
    setDetailStageNoteSaving(false);
    setFiles([]);
    setStageNotesHistory([]);
    setFilesError('');
    setUploadFiles([]);
    setUploadAllowCustomer(false);
    setPhotoUploads([]);
    setPhotoError('');
    setFileDragActive(false);
    setPhotoDragActive(false);
    setAreaSelection('');
  };

  const handleSave = async () => {
    if (!detailProject?.id || !canEditProjectDetails) return;
    if (!detailForm.name.trim() || !detailForm.requester.trim()) {
      setDetailError('Project name and requester are required.');
      return;
    }
    setSaving(true);
    setDetailError('');
    setDetailStatus('');
    try {
      const payload = {
        project_number: trimOrNull(detailForm.project_number),
        name: detailForm.name.trim(),
        requester: detailForm.requester.trim(),
        due_date: trimOrNull(detailForm.due_date),
        urgency: trimOrNull(detailForm.urgency) || 'standard',
        budget: trimOrNull(detailForm.budget),
        summary: trimOrNull(detailForm.summary)
      };
      let updated = await updateProject(detailProject.id, payload);
      const stages = updated?.stages || [];
      const targetIndex = stages.findIndex((stage) => stage.id === areaSelection);
      const currentStageId = currentStage(stages)?.id || '';
      let areaChanged = false;

      if (targetIndex >= 0 && areaSelection && currentStageId !== areaSelection) {
        for (let idx = 0; idx < stages.length; idx += 1) {
          const stage = stages[idx];
          let nextStatus = stage.status;
          if (idx < targetIndex) {
            nextStatus = 'complete';
          } else if (idx === targetIndex) {
            nextStatus = stage.id === 'completed' ? 'complete' : 'in_progress';
          } else {
            nextStatus = 'pending';
          }
          if (stage.status === nextStatus) continue;
          await updateStage(detailProject.id, stage.id, {
            status: nextStatus,
            event_title: 'Stage moved',
            event_meta: { action: 'admin_set_area', target: areaSelection }
          });
          areaChanged = true;
        }
      }

      if (areaChanged) {
        updated = await getProject(detailProject.id);
      }

      setDetailProject(updated);
      setDetailForm(toEditForm(updated));
      setRows((prev) => prev.map((item) => (item.id === updated.id ? toRow(updated) : item)));
      await loadStageNotesHistory(detailProject.id);
      setDetailStatus(areaChanged ? 'Project updated. Current area updated.' : 'Project updated.');
    } catch (_err) {
      setDetailError('Unable to update project.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDetailNotes = async () => {
    if (!detailProject?.id || !detailCurrentStage?.id || !canEditProjects) return;
    const noteText = detailStageNoteDraft.trim();
    if (!noteText) {
      setDetailError('Enter a note to add.');
      return;
    }
    setDetailStageNoteSaving(true);
    setDetailError('');
    setDetailStatus('');
    try {
      const updatedStage = await updateStage(detailProject.id, detailCurrentStage.id, {
        area_note: noteText,
        event_title: 'Area note updated',
        event_meta: { stage: detailCurrentStage.name }
      });
      const nextProject = {
        ...detailProject,
        stages: (detailProject.stages || []).map((stage) =>
          stage.id === detailCurrentStage.id
            ? { ...stage, ...(updatedStage || {}), area_note: noteText || null }
            : stage
        )
      };
      setDetailProject(nextProject);
      setDetailStageNoteDraft('');
      setRows((prev) => prev.map((item) => (item.id === nextProject.id ? toRow(nextProject) : item)));
      await loadStageNotesHistory(detailProject.id);
      setDetailStatus('Note added.');
    } catch (_err) {
      setDetailError('Unable to add note.');
    } finally {
      setDetailStageNoteSaving(false);
    }
  };

  const handleUploadFile = async (event) => {
    event.preventDefault();
    if (!detailProject?.id) return;
    if (!uploadFiles.length) {
      setFilesError('Select files to upload.');
      return;
    }
    setUploading(true);
    setFilesError('');
    try {
      for (const file of uploadFiles) {
        await uploadProjectFile(detailProject.id, file, {
          filename: file.name,
          customer_visible: uploadAllowCustomer
        });
      }
      const uploadedCount = uploadFiles.length;
      setUploadFiles([]);
      setUploadAllowCustomer(false);
      await loadFiles(detailProject.id);
      setDetailStatus(
        uploadedCount === 1 ? 'File uploaded.' : `${uploadedCount} files uploaded.`
      );
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
    if (!detailProject?.id) return;
    if (!photoUploads.length) {
      setPhotoError('Select photos to upload.');
      return;
    }
    setPhotoUploading(true);
    setPhotoError('');
    try {
      for (const file of photoUploads) {
        await uploadProjectFile(detailProject.id, file, {
          filename: file.name,
          customer_visible: true,
          content_type: file.type || undefined
        });
      }
      const uploadedCount = photoUploads.length;
      setPhotoUploads([]);
      await loadFiles(detailProject.id);
      setDetailStatus(
        uploadedCount === 1 ? 'Photo uploaded.' : `${uploadedCount} photos uploaded.`
      );
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

  const handleToggleFileVisibility = async (fileRecord, nextValue) => {
    if (!detailProject?.id || !fileRecord?.id) return;
    try {
      const updated = await setProjectFileVisibility(detailProject.id, fileRecord.id, nextValue);
      setFiles((prev) =>
        prev.map((item) =>
          item.id === fileRecord.id
            ? { ...item, ...(updated || {}), customer_visible: nextValue }
            : item
        )
      );
    } catch (_err) {
      setFilesError('Unable to update file visibility.');
    }
  };

  const handleViewFile = async (fileRecord) => {
    if (!detailProject?.id || !fileRecord?.id) return;
    setFilesError('');
    const name = fileRecord.filename || 'File preview';
    setPreviewRecord(fileRecord);
    setPreview({ open: true, url: '', name, kind: 'loading', text: '' });
    setPreviewLoading(true);
    try {
      const blob = await downloadProjectFile(detailProject.id, fileRecord.id);
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
    if (!detailProject?.id || !fileRecord?.id) return;
    setFilesError('');
    try {
      const blob = await downloadProjectFile(detailProject.id, fileRecord.id);
      triggerBrowserDownload(blob, fileRecord.filename);
    } catch (_err) {
      setFilesError('Unable to download file.');
    }
  };

  const handleDeleteFile = async (fileRecord) => {
    if (!detailProject?.id || !fileRecord?.id) return;
    if (!window.confirm(`Delete ${fileRecord.filename}? This cannot be undone.`)) return false;
    try {
      await deleteProjectFile(detailProject.id, fileRecord.id);
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

  const handleCompressProject = async () => {
    if (!detailProject?.id || !canEditProjects) return;
    if (!projectIsComplete) {
      setDetailStatus('Project must be completed before compression.');
      return;
    }
    if (!window.confirm('Compress all project files into a single archive? This removes individual files.')) {
      return;
    }
    setCompressing(true);
    setDetailError('');
    setDetailStatus('');
    try {
      await compressProjectFiles(detailProject.id);
      await loadFiles(detailProject.id);
      setDetailStatus('Project files compressed.');
    } catch (_err) {
      setDetailError('Unable to compress project files.');
    } finally {
      setCompressing(false);
    }
  };

  const handleArchiveProject = async () => {
    if (!detailProject?.id || !canEditProjects || detailProject.is_deleted) return;
    if (!window.confirm('Archive this project? You can restore it later.')) return;
    setProjectActionBusy('archive');
    setDetailError('');
    setDetailStatus('');
    try {
      await archiveProject(detailProject.id);
      setDetailProject((prev) =>
        prev
          ? {
              ...prev,
              is_deleted: true,
              deleted_at: new Date().toISOString()
            }
          : prev
      );
      setDetailStatus('Project archived.');
      await loadProjects();
    } catch (_err) {
      setDetailError('Unable to archive project.');
    } finally {
      setProjectActionBusy('');
    }
  };

  const handleRestoreProject = async () => {
    if (!detailProject?.id || !canEditProjects || !detailProject.is_deleted) return;
    setProjectActionBusy('restore');
    setDetailError('');
    setDetailStatus('');
    try {
      await restoreProject(detailProject.id);
      setDetailProject((prev) =>
        prev
          ? {
              ...prev,
              is_deleted: false,
              deleted_at: null
            }
          : prev
      );
      setDetailStatus('Project restored.');
      await loadProjects();
    } catch (_err) {
      setDetailError('Unable to restore project.');
    } finally {
      setProjectActionBusy('');
    }
  };

  const handleDeleteProject = async () => {
    if (!detailProject?.id || !canEditProjects) return;
    if (!window.confirm('Delete this project permanently? This cannot be undone.')) return;
    setProjectActionBusy('delete');
    setDetailError('');
    setDetailStatus('');
    try {
      await deleteProject(detailProject.id);
      closeDetails();
      await loadProjects();
    } catch (_err) {
      setDetailError('Unable to delete project.');
    } finally {
      setProjectActionBusy('');
    }
  };

  const renderDashboardRow = (row, idx, keyPrefix = 'row') => {
    const areaColor = AREA_COLORS[row.areaId] || 'rgba(148, 163, 184, 0.2)';
    const areaText = textColorForHex(areaColor);
    const notesKey = dashboardAreaNotesKey(row.id, row.areaId);
    const cachedAreaNotes = notesKey ? dashboardAreaNotes[notesKey] : null;
    const areaNoteTitle = showHoverNotes
      ? cachedAreaNotes?.tooltip || `All notes (${row.area})\n\nLoading notes...`
      : undefined;
    const projectSummary = String(row.project?.summary || '').trim();
    const projectNotesTitle = showHoverNotes
      ? projectSummary
        ? `Notes:\n${projectSummary}`
        : 'Notes:\nNo notes yet.'
      : undefined;
    return (
      <tr
        key={row.id || `${row.name}-${keyPrefix}-${idx}`}
        className={row.isDeleted ? 'row-archived' : ''}
        onDoubleClick={() => openDetails(row)}
      >
        <td className={showHoverNotes ? 'dashboard-name-with-notes' : ''} title={projectNotesTitle}>
          {row.projectNumber ? `${row.projectNumber} - ${row.name}` : row.name}
        </td>
        <td>
          <span
            className={`area-pill${showHoverNotes ? ' dashboard-area-with-notes' : ''}`}
            style={{ backgroundColor: areaColor, color: areaText }}
            title={areaNoteTitle}
            onMouseEnter={() => {
              if (!showHoverNotes || !row.id || !row.areaId) return;
              loadDashboardAreaNotes(row.id, row.areaId, row.area);
            }}
          >
            {row.area}
          </span>
        </td>
      </tr>
    );
  };

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Dashboard</h2>
            <p className="muted">Double-click a project row to view details.</p>
          </div>
          <div className="detail-header-actions">
            <label className="pipeline-area-select">
              <span className="muted">Requester/Contractor</span>
              <select
                value={dashboardRequesterFilter}
                onChange={(event) => setDashboardRequesterFilter(event.target.value)}
              >
                <option value={DASHBOARD_FILTER_ALL}>All</option>
                {dashboardRequesterOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="switch-field switch-field--pill">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
              />
              <span className="switch-track" aria-hidden="true">
                <span className="switch-thumb" />
              </span>
              <span className="switch-text">Show archived</span>
            </label>
          </div>
        </div>
        {loading ? <p className="muted">Loading projects...</p> : null}
        {error ? <div className="alert">{error}</div> : null}
        {dashboardRows.length ? (
          splitDashboardLayout ? (
          <div className="dashboard-columns">
            {dashboardColumns.map((columnRows, columnIdx) => (
              <div className="table-scroll dashboard-table-scroll dashboard-split-scroll" key={`dashboard-col-${columnIdx}`}>
                <table className="project-table dashboard-table dashboard-split-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Current Stage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {columnRows.map((row, idx) => renderDashboardRow(row, idx, `col-${columnIdx}`))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
          ) : (
            <div className="table-scroll dashboard-table-scroll">
              <table className="project-table dashboard-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Current Stage</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboardRows.map((row, idx) => renderDashboardRow(row, idx, 'single'))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="table-scroll dashboard-table-scroll">
            <table className="project-table dashboard-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Current Stage</th>
                </tr>
              </thead>
              <tbody>
                <tr className="empty-row">
                  <td colSpan={2}>
                    {dashboardRequesterFilter !== DASHBOARD_FILTER_ALL
                      ? 'No projects match that requester/contractor.'
                      : applyAreaFilter && !canViewAllAreas
                      ? 'No projects in your assigned areas.'
                      : 'No projects available.'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {detailOpen ? (
        <ModalPortal>
          <div className="modal-backdrop preview-backdrop pipeline-detail-backdrop" onClick={() => !saving && closeDetails()}>
            <div className="modal pipeline-detail-modal" onClick={(event) => event.stopPropagation()}>
              <div className="detail-card-header pipeline-detail-header">
                <div className="pipeline-detail-title">
                  {`${detailProject?.name || 'Project details'}${detailProject?.project_number ? ` - ${detailProject.project_number}` : ''}`}
                </div>
                <div className="detail-header-actions">
                  {canEditProjects ? (
                    detailProject?.is_deleted ? (
                      <>
                        <button
                          className="ghost"
                          type="button"
                          onClick={handleRestoreProject}
                          disabled={Boolean(projectActionBusy) || saving}
                        >
                          {projectActionBusy === 'restore' ? 'Restoring...' : 'Unarchive'}
                        </button>
                        <button
                          className="ghost danger"
                          type="button"
                          onClick={handleDeleteProject}
                          disabled={Boolean(projectActionBusy) || saving}
                        >
                          {projectActionBusy === 'delete' ? 'Deleting...' : 'Delete'}
                        </button>
                      </>
                    ) : (
                      <button
                        className="ghost"
                        type="button"
                        onClick={handleArchiveProject}
                        disabled={Boolean(projectActionBusy) || saving}
                      >
                        {projectActionBusy === 'archive' ? 'Archiving...' : 'Archive'}
                      </button>
                    )
                  ) : null}
                  <button className="ghost" type="button" onClick={closeDetails} disabled={saving}>
                    Close
                  </button>
                </div>
                {detailProject ? (
                  <div className="stage-tabs detail-tabs pipeline-detail-tabs-wrap" role="tablist" aria-label="Project detail sections">
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
                ) : null}
              </div>
              <div className="pipeline-detail-body">
                {detailLoading ? <p className="muted">Loading project details...</p> : null}
                {detailError ? <div className="alert">{detailError}</div> : null}
                {detailStatus ? <p className="muted">{detailStatus}</p> : null}
                {detailProject ? (
                  <div className="project-detail-grid">
                {detailTab === 'project' ? (
                <div className="detail-card">
                  {!canEditProjectDetails ? (
                    <p className="muted">
                      {canEditProjects
                        ? 'View only for project fields. Contractor accounts can still add stage notes.'
                        : 'View only. Add the Admin area to edit project fields.'}
                    </p>
                  ) : null}
                  <div className="form-grid project-detail-form">
                    <label>
                      Project #
                      <input
                        value={detailForm.project_number}
                        onChange={(event) => setDetailForm({ ...detailForm, project_number: event.target.value })}
                        readOnly={!canEditProjectDetails}
                      />
                    </label>
                    <label>
                      Project name
                      <input
                        value={detailForm.name}
                        onChange={(event) => setDetailForm({ ...detailForm, name: event.target.value })}
                        readOnly={!canEditProjectDetails}
                      />
                    </label>
                    <label>
                      Requester
                      <input
                        value={detailForm.requester}
                        list="shared-party-options"
                        onChange={(event) => setDetailForm({ ...detailForm, requester: event.target.value })}
                        readOnly={!canEditProjectDetails}
                      />
                      <datalist id="shared-party-options">
                        {requesterOptions.map((requester) => (
                          <option key={requester} value={requester} />
                        ))}
                      </datalist>
                    </label>
                    <label>
                      Due date
                      <input
                        type="date"
                        value={detailForm.due_date}
                        onChange={(event) => setDetailForm({ ...detailForm, due_date: event.target.value })}
                        readOnly={!canEditProjectDetails}
                      />
                    </label>
                    <label>
                      Urgency
                      <select
                        value={detailForm.urgency}
                        onChange={(event) => setDetailForm({ ...detailForm, urgency: event.target.value })}
                        disabled={!canEditProjectDetails}
                      >
                        <option value="low">Low</option>
                        <option value="standard">Standard</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </select>
                    </label>
                    <label>
                      Budget
                      <input
                        value={detailForm.budget}
                        onChange={(event) => setDetailForm({ ...detailForm, budget: event.target.value })}
                        readOnly={!canEditProjectDetails}
                      />
                    </label>
                    <label className="span-2">
                      Current area
                      {canEditProjectDetails ? (
                        <select value={areaSelection} onChange={(event) => setAreaSelection(event.target.value)}>
                          {stageOptions.map((stage) => (
                            <option key={stage.id} value={stage.id}>
                              {formatStageName(stage.name, stage.id)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input value={formatStageName(detailCurrentStage?.name, detailCurrentStage?.id) || '-'} readOnly />
                      )}
                    </label>
                    <label className="span-2">
                      Summary
                      <textarea
                        value={detailForm.summary}
                        onChange={(event) => setDetailForm({ ...detailForm, summary: event.target.value })}
                        rows={4}
                        readOnly={!canEditProjectDetails}
                      />
                    </label>
                    <label className="span-2">
                      Add note
                      <textarea
                        value={detailStageNoteDraft}
                        onChange={(event) => setDetailStageNoteDraft(event.target.value)}
                        rows={3}
                        placeholder="Type a new note for this current stage"
                        readOnly={!canEditProjects}
                      />
                    </label>
                  </div>
                  <div className="actions">
                    <button className="ghost" type="button" onClick={closeDetails} disabled={saving}>
                      {canEditProjectDetails ? 'Cancel' : 'Close'}
                    </button>
                    {canEditProjects ? (
                      <button
                        type="button"
                        className="ghost"
                        onClick={handleSaveDetailNotes}
                        disabled={detailStageNoteSaving || !detailCurrentStage?.id}
                      >
                        {detailStageNoteSaving ? 'Saving...' : 'Add note'}
                      </button>
                    ) : null}
                    {canEditProjectDetails ? (
                      <button className="primary" type="button" onClick={handleSave} disabled={saving}>
                        {saving ? 'Saving...' : 'Save changes'}
                      </button>
                    ) : null}
                  </div>
                </div>
                ) : null}

                {detailTab === 'project' ? (
                <div className="detail-card">
                  <div className="detail-card-header">
                    <h3>Progress</h3>
                    <span className="progress-pill">{`${detailProgress}%`}</span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${detailProgress}%` }} />
                  </div>
                </div>
                ) : null}

                {detailTab === 'project' ? (
                <div className="detail-card">
                  <h3>Stages</h3>
                  <div className="table-scroll project-stage-table">
                    {detailStages.length ? (
                      <table className="project-table stage-matrix-table">
                        <thead>
                          <tr>
                            <th className="stage-matrix-label">Field</th>
                            {detailStages.map((stage) => {
                              const count = stageNoteCountByStageId.get(stage.id) || 0;
                              const notesTitle = stageNoteTooltipByStageId.get(stage.id) || '';
                              return (
                                <th
                                  key={stage.id}
                                  className={`stage-matrix-stage${count ? ' has-notes' : ''}`}
                                  title={notesTitle}
                                >
                                  {formatStageName(stage.name, stage.id)}
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <th className="stage-matrix-label">Owner</th>
                            {detailStages.map((stage) => (
                              <td key={`${stage.id}-owner`} title={stageNoteTooltipByStageId.get(stage.id) || ''}>
                                {stage.owner}
                              </td>
                            ))}
                          </tr>
                          <tr>
                            <th className="stage-matrix-label">Status</th>
                            {detailStages.map((stage) => (
                              <td key={`${stage.id}-status`} title={stageNoteTooltipByStageId.get(stage.id) || ''}>
                                <span className={`status-pill ${stageStatusClass(stage.status)}`}>
                                  {String(stage.status || 'pending').replace('_', ' ')}
                                </span>
                              </td>
                            ))}
                          </tr>
                          <tr>
                            <th className="stage-matrix-label">Expected (hrs)</th>
                            {detailStages.map((stage) => (
                              <td key={`${stage.id}-expected`} title={stageNoteTooltipByStageId.get(stage.id) || ''}>
                                {Number(stage.expected_hours ?? stage.default_duration_hours ?? 0)}
                              </td>
                            ))}
                          </tr>
                          <tr>
                            <th className="stage-matrix-label">Started</th>
                            {detailStages.map((stage) => (
                              <td key={`${stage.id}-started`} title={stageNoteTooltipByStageId.get(stage.id) || ''}>
                                {formatDateTime(stage.started_at)}
                              </td>
                            ))}
                          </tr>
                          <tr>
                            <th className="stage-matrix-label">Completed</th>
                            {detailStages.map((stage) => (
                              <td key={`${stage.id}-completed`} title={stageNoteTooltipByStageId.get(stage.id) || ''}>
                                {formatDateTime(stage.completed_at)}
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    ) : (
                      <table className="project-table">
                        <tbody>
                          <tr className="empty-row">
                            <td>No stages available.</td>
                          </tr>
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
                ) : null}

                {detailTab === 'files' ? (
                <div className="detail-card">
                  <div className="detail-card-header">
                    <h3>Files</h3>
                    {canEditProjects ? (
                      <button
                        className="ghost tiny-button"
                        type="button"
                        onClick={handleCompressProject}
                        disabled={!projectIsComplete || compressing}
                        title={
                          projectIsComplete
                            ? 'Compress project files'
                            : 'Project must be completed before compression'
                        }
                      >
                        {compressing ? 'Compressing...' : 'Compress project'}
                      </button>
                    ) : null}
                  </div>
                  <form className="file-upload-form" onSubmit={handleUploadFile}>
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
                        <input
                          id="project-file-upload"
                          className="file-upload-input"
                          type="file"
                          multiple
                          onChange={(event) => setUploadFiles(Array.from(event.target.files || []))}
                        />
                        <label htmlFor="project-file-upload" className="ghost file-upload-button">
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
                      <span className="file-upload-selected">
                        {summarizeSelection(uploadFiles, 'No files selected', 'files')}
                      </span>
                    </div>
                  </form>
                  {filesError ? <div className="alert">{filesError}</div> : null}
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
                                  <span>{formatDateTime(fileRecord.created_at)}</span>
                                  <span>{formatBytes(fileRecord.size_bytes)}</span>
                                </div>
                              </div>
                            </button>
                            <label className="switch-field compact-card-switch">
                              <input
                                type="checkbox"
                                checked={coerceBool(fileRecord.customer_visible)}
                                onChange={(event) =>
                                  handleToggleFileVisibility(fileRecord, event.target.checked)
                                }
                              />
                              <span className="switch-track" aria-hidden="true">
                                <span className="switch-thumb" />
                              </span>
                              <span className="switch-text">Customer view</span>
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
                        <input
                          id="project-photo-upload"
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
                        <label htmlFor="project-photo-upload" className="ghost file-upload-button">
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
                  {photoError ? <div className="alert">{photoError}</div> : null}
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
                                  <span>{formatDateTime(fileRecord.created_at)}</span>
                                  <span>{formatBytes(fileRecord.size_bytes)}</span>
                                </div>
                              </div>
                            </button>
                            <label className="switch-field compact-card-switch">
                              <input
                                type="checkbox"
                                checked={coerceBool(fileRecord.customer_visible)}
                                onChange={(event) =>
                                  handleToggleFileVisibility(fileRecord, event.target.checked)
                                }
                              />
                              <span className="switch-track" aria-hidden="true">
                                <span className="switch-thumb" />
                              </span>
                              <span className="switch-text">Customer view</span>
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
                ) : null}
              </div>
            </div>
          </div>
        </ModalPortal>
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
                  {canEditProjects ? (
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
    </>
  );
}
