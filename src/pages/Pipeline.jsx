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
  updateMoneySubstage,
  updateProject,
  uploadProjectFile
} from '../api.js';
import ModalPortal from '../components/ModalPortal.jsx';
import useSiteDialog from '../utils/useSiteDialog.jsx';
import {
  coerceSlabWorkFlag,
  formatMoneyStageGlyph,
  formatStageName,
  getEffectiveMoneySubstage,
  getMoneySubstageLabel,
  getStageBadgeStyle,
  isMoneyTrackingStage,
  MONEY_SUBSTAGE_OPTIONS,
  normalizeProjectStages,
  STAGE_FLOW
} from '../utils/stageDisplay.js';
import {
  REQUIRED_DOC_OPTIONS,
  buildEmptyRequiredDocs,
  buildProjectSummary,
  parseProjectSummary
} from '../utils/requiredDocs.js';

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
const DETAIL_TABS = [
  { id: 'project', label: 'Project' },
  { id: 'files', label: 'Files & Photos' }
];

const DASHBOARD_FILTER_ALL = '__all__';
const MONEY_STATUS_STAGE_IDS = new Set([
  'invoice_design',
  'invoice_slab',
  'money_design',
  'money_slab',
  'invoice_production',
  'money_production',
  'invoice_shipping',
  'money_shipping',
  'misc_money',
  'final_payment'
]);

const ALL_AREA_STAGE_IDS = STAGE_FLOW.map((stage) => stage.id);

const AREA_FILTER_TO_STAGE_IDS = {
  'plans recieved': ['plans_received'],
  'plans revieved': ['plans_received'],
  'plans received': ['plans_received'],
  plans_received: ['plans_received'],
  budget: ['budget'],
  'cfs budget': ['budget'],
  'rough estimate': ['budget'],
  'rough estimate / sales tax certificate': ['budget'],
  'budgetary number / sales tax certificate': ['budget'],
  'budgetary number/ sales tax certificate': ['budget'],
  'budgetary number': ['budget'],
  rough_estimate: ['budget'],
  'money - d&e': ['money_design'],
  'money - de': ['money_design'],
  'money - design': ['money_design'],
  'money design': ['money_design'],
  money_design: ['money_design'],
  'invoice sent - d&e': ['invoice_design'],
  'invoice sent - de': ['invoice_design'],
  'invoice sent - design': ['invoice_design'],
  invoice_design: ['invoice_design'],
  'invoice sent - slab': ['invoice_slab'],
  'invoice sent slab': ['invoice_slab'],
  invoice_slab: ['invoice_slab'],
  'money - slab': ['money_slab'],
  'money slab': ['money_slab'],
  money_slab: ['money_slab'],
  'slab work': ['slab_work'],
  slab_work: ['slab_work'],
  'design & engineering': ['design', 'engineering'],
  'design and engineering': ['design', 'engineering'],
  design: ['design'],
  engineering: ['engineering'],
  estimating: ['estimating'],
  'money - production': ['money_production'],
  'money production': ['money_production'],
  money_production: ['money_production'],
  'invoice sent - production': ['invoice_production'],
  invoice_production: ['invoice_production'],
  manufacturing: ['manufacturing'],
  'invoice sent - shipping': ['invoice_shipping'],
  'invoice sent shipping': ['invoice_shipping'],
  invoice_shipping: ['invoice_shipping'],
  'manufacturing - invoice sent': ['invoice_shipping'],
  'manufacturing - final invoice sent': ['invoice_shipping'],
  'manufacturing final invoice sent': ['invoice_shipping'],
  'manufacturing invoice sent': ['invoice_shipping'],
  'money - shipping': ['money_shipping'],
  'money shipping': ['money_shipping'],
  money_shipping: ['money_shipping'],
  'invoice sent': ['invoice_design', 'invoice_slab', 'invoice_production', 'invoice_shipping'],
  acceptance: ['acceptance'],
  'acceptance - proof of delivery': ['acceptance'],
  'proof of delivery': ['acceptance'],
  'misc money': ['misc_money'],
  misc_money: ['misc_money'],
  shipping: ['shipping'],
  'collect final payment': ['final_payment'],
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

function resolveStageWaitingSince(stages = [], stage = null, projectCreatedAt = null) {
  if (!stage) return null;
  const status = String(stage.status || '').trim().toLowerCase();
  const waitingForReceipt = ['pending', 'awaiting_approval'].includes(status);
  if (!waitingForReceipt) return null;
  const candidates = [];
  if (stage.approved_at) candidates.push(stage.approved_at);
  if (stage.accepted_at) candidates.push(stage.accepted_at);
  const stageIndex = stages.findIndex((entry) => String(entry?.id || '') === String(stage.id || ''));
  if (stageIndex > 0) {
    for (let index = stageIndex - 1; index >= 0; index -= 1) {
      const previous = stages[index];
      if (previous?.completed_at) {
        candidates.push(previous.completed_at);
        break;
      }
      if (previous?.approved_at) {
        candidates.push(previous.approved_at);
        break;
      }
    }
  }
  if (projectCreatedAt) candidates.push(projectCreatedAt);
  const firstValid = candidates.find((value) => !Number.isNaN(new Date(value).getTime()));
  return firstValid || null;
}

function toRow(project, formatStageNameFn = formatStageName) {
  const normalizedStages = normalizeProjectStages(project.stages || [], {
    hasSlabWork: coerceSlabWorkFlag(project?.slab_work),
    hasScottsdaleReadyFiles: project?.scottsdale_ready_files === true
  });
  const stage = currentStage(normalizedStages);
  const waitingSince = resolveStageWaitingSince(normalizedStages, stage, project?.created_at || null);
  return {
    id: project.id,
    projectNumber: project.project_number || '',
    name: project.name || 'Unnamed project',
    area: formatStageNameFn(stage?.name, stage?.id) || 'Pending',
    moneyStageName: formatStageName(stage?.name, stage?.id, { audience: 'internal' }) || 'Pending',
    areaId: stage?.id || '',
    areaNote: String(stage?.area_note || '').trim(),
    areaNoteUpdatedBy: String(stage?.area_note_updated_by || '').trim(),
    areaNoteUpdatedAt: stage?.area_note_updated_at || null,
    stage,
    moneySubstage: getEffectiveMoneySubstage(stage),
    moneySubstageLabel: getMoneySubstageLabel(getEffectiveMoneySubstage(stage)) || '',
    stageWaitingSince: waitingSince,
    progress: completionPercent(normalizedStages),
    statusTone: stageNoticeTone(stage),
    isDeleted: Boolean(project.is_deleted),
    project
  };
}

function toEditForm(project) {
  const parsedSummary = parseProjectSummary(project?.summary || '');
  return {
    project_number: project?.project_number || '',
    name: project?.name || '',
    requester: project?.requester || '',
    project_location_state: project?.project_location_state || '',
    due_date: project?.due_date || '',
    urgency: project?.urgency || 'standard',
    budget: project?.budget || '',
    slab_work: Boolean(project?.slab_work),
    summary: parsedSummary.notes,
    required_docs: parsedSummary.requiredDocs || buildEmptyRequiredDocs()
  };
}

function stageStatusClass(status) {
  if (status === 'complete') return 'complete';
  if (status === 'in_progress') return 'progress';
  if (status === 'awaiting_approval') return 'warning';
  return 'neutral';
}

function progressStageStatusClass(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'complete') return 'complete';
  if (normalized === 'in_progress' || normalized === 'awaiting_approval') return 'in-progress';
  return 'pending';
}

function formatDateTime(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString();
}

function formatDateOnly(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString();
}

function formatTimeOnly(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleTimeString();
}

function formatDurationMinutes(totalMinutes) {
  const minutes = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins || !parts.length) parts.push(`${mins}m`);
  return parts.join(' ');
}

function formatExpectedHours(hours) {
  const value = Number(hours || 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}` : `${rounded}`;
}

function formatStageEstimateTooltip(stage, waitingSince = null, nowMs = Date.now(), formatStageNameFn = formatStageName) {
  if (!stage) return 'No stage timing available.';
  const stageName = formatStageNameFn(stage.name, stage.id) || 'Current stage';
  if (waitingSince) {
    const waitStartMs = new Date(waitingSince).getTime();
    if (!Number.isNaN(waitStartMs)) {
      const elapsedMinutes = Math.max(0, Math.round((nowMs - waitStartMs) / 60000));
      return `${stageName}\nWaiting to be received: ${formatDurationMinutes(elapsedMinutes)}.`;
    }
  }
  const expected = Number(stage.expected_hours ?? stage.default_duration_hours ?? 0);
  const expectedText = formatExpectedHours(expected);
  if (!expectedText) {
    return `${stageName}\nNo estimated duration.`;
  }
  const startedAt = stage.started_at ? new Date(stage.started_at) : null;
  if (!startedAt || Number.isNaN(startedAt.getTime())) {
    return `${stageName}\nEstimate: ${expectedText}h\nNot started yet.`;
  }
  const elapsedMinutes = Math.max(0, Math.round((nowMs - startedAt.getTime()) / 60000));
  const remainingMinutes = Math.round(expected * 60) - elapsedMinutes;
  if (remainingMinutes > 0) {
    return `${stageName}\n${formatDurationMinutes(remainingMinutes)} left of ${expectedText}h estimate.`;
  }
  if (remainingMinutes === 0) {
    return `${stageName}\nDue now (${expectedText}h estimate).`;
  }
  return `${stageName}\n${formatDurationMinutes(Math.abs(remainingMinutes))} overdue (${expectedText}h estimate).`;
}

function stageTimingAlertTone(stage, waitingSince = null, nowMs = Date.now()) {
  if (!stage) return '';
  const attentionWindowMs = 48 * 3600000;
  const expected = Number(stage.expected_hours ?? stage.default_duration_hours ?? 0);
  const startedAtMs = stage.started_at ? new Date(stage.started_at).getTime() : Number.NaN;
  if (
    ['in_progress', 'awaiting_approval'].includes(String(stage.status || '').trim().toLowerCase()) &&
    Number.isFinite(expected) &&
    expected > 0 &&
    !Number.isNaN(startedAtMs)
  ) {
    const dueAtMs = startedAtMs + expected * 3600000;
    const remainingMs = dueAtMs - nowMs;
    if (remainingMs <= 0) return 'red';
    if (remainingMs <= attentionWindowMs) return 'yellow';
    return '';
  }
  if (waitingSince) {
    const waitingSinceMs = new Date(waitingSince).getTime();
    if (!Number.isNaN(waitingSinceMs) && nowMs - waitingSinceMs >= attentionWindowMs) {
      return 'yellow';
    }
  }
  return '';
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
const SPREADSHEET_EXTENSIONS = ['.csv', '.tsv', '.xlsx', '.xls'];
const TEXT_PREVIEW_LIMIT_BYTES = 1024 * 1024;
const SPREADSHEET_PREVIEW_MAX_ROWS = 200;
const SPREADSHEET_PREVIEW_MAX_COLUMNS = 30;

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

function isSpreadsheetFile(fileRecord) {
  const type = String(fileRecord?.content_type || '').toLowerCase();
  if (
    [
      'text/csv',
      'text/tab-separated-values',
      'application/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ].includes(type)
  ) {
    return true;
  }
  const name = String(fileRecord?.filename || '').toLowerCase();
  return SPREADSHEET_EXTENSIONS.some((ext) => name.endsWith(ext));
}

async function buildSpreadsheetPreview(fileRecord, blob) {
  const name = String(fileRecord?.filename || '').toLowerCase();
  const type = String(fileRecord?.content_type || '').toLowerCase();
  const isDelimited =
    name.endsWith('.csv') ||
    name.endsWith('.tsv') ||
    type === 'text/csv' ||
    type === 'text/tab-separated-values' ||
    type === 'application/csv';
  if (isDelimited) {
    const Papa = (await import('papaparse')).default;
    const raw = await blob.text();
    const delimiter = name.endsWith('.tsv') || type === 'text/tab-separated-values' ? '\t' : undefined;
    const parsed = Papa.parse(raw, {
      header: false,
      skipEmptyLines: true,
      dynamicTyping: false,
      delimiter
    });
    if (parsed?.errors?.length) {
      throw new Error('Unable to parse CSV/TSV preview.');
    }
    const data = Array.isArray(parsed.data) ? parsed.data : [];
    const rowCount = data.length;
    const safeRows = data.slice(0, SPREADSHEET_PREVIEW_MAX_ROWS).map((row) => {
      const values = Array.isArray(row) ? row : [row];
      return values.slice(0, SPREADSHEET_PREVIEW_MAX_COLUMNS).map((value) => String(value ?? ''));
    });
    const maxColumns = safeRows.reduce((max, row) => Math.max(max, row.length), 0);
    const headers = Array.from({ length: maxColumns }, (_, index) => `Col ${index + 1}`);
    return {
      rows: safeRows,
      headers,
      note:
        rowCount > SPREADSHEET_PREVIEW_MAX_ROWS
          ? `Showing first ${SPREADSHEET_PREVIEW_MAX_ROWS} rows. Download for full file.`
          : ''
    };
  }

  const XLSX = await import('xlsx');
  const buffer = await blob.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', dense: true });
  const sheetName = workbook?.SheetNames?.[0];
  if (!sheetName) throw new Error('Spreadsheet has no sheets to preview.');
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    raw: false
  });
  const tableRows = Array.isArray(rawRows) ? rawRows : [];
  const rowCount = tableRows.length;
  const safeRows = tableRows.slice(0, SPREADSHEET_PREVIEW_MAX_ROWS).map((row) => {
    const values = Array.isArray(row) ? row : [row];
    return values.slice(0, SPREADSHEET_PREVIEW_MAX_COLUMNS).map((value) => String(value ?? ''));
  });
  const maxColumns = safeRows.reduce((max, row) => Math.max(max, row.length), 0);
  const headers = Array.from({ length: maxColumns }, (_, index) => `Col ${index + 1}`);
  return {
    rows: safeRows,
    headers,
    note:
      rowCount > SPREADSHEET_PREVIEW_MAX_ROWS
        ? `Showing first ${SPREADSHEET_PREVIEW_MAX_ROWS} rows from sheet "${sheetName}". Download for full file.`
        : `Sheet: ${sheetName}`
  };
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

function formatStageNotesTooltip(entries = [], stageName = '') {
  const safeStageName = String(stageName || '').trim() || 'Stage';
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

function formatDashboardProjectNotesTooltip(summaryText) {
  const raw = String(summaryText || '').trim();
  if (!raw) {
    return 'Notes:\nNo notes yet.';
  }
  const parsed = parseProjectSummary(raw);
  const providedDocs = REQUIRED_DOC_OPTIONS.filter((option) => Boolean(parsed.requiredDocs?.[option.id])).map(
    (option) => option.label
  );
  const missingDocs = REQUIRED_DOC_OPTIONS.filter((option) => !Boolean(parsed.requiredDocs?.[option.id])).map(
    (option) => option.label
  );
  const hasDocContent = Boolean(parsed.hasDocsSection || providedDocs.length);
  if (!hasDocContent) {
    return `Notes:\n${parsed.notes || raw}`;
  }

  const blocks = [
    'Notes:',
    providedDocs.length
      ? `Provided docs:\n- ${providedDocs.join('\n- ')}`
      : 'Provided docs:\n- None listed',
    missingDocs.length ? `Missing docs:\n- ${missingDocs.join('\n- ')}` : 'Missing docs:\n- None'
  ];
  const trimmedNotes = String(parsed.notes || '').trim();
  if (trimmedNotes) {
    blocks.push(trimmedNotes);
  }
  return blocks.join('\n\n');
}

function moneySubstageToneClass(value) {
  switch (String(value || '').trim()) {
    case 'money_ordered':
      return 'yellow';
    case 'client_paid':
      return 'progress';
    case 'payment_sent_to_bison':
      return 'complete';
    default:
      return 'neutral';
  }
}

export default function Pipeline({
  canEditProjects = false,
  canEditProjectDetails = false,
  canUploadProjectFiles = false,
  canEditMoneySubstages = false,
  dashboardMode = 'all',
  applyAreaFilter = false,
  allowedAreas = [],
  canViewAllAreas = false,
  showHoverNotes = false,
  showRequesterFilter = true,
  showArchivedFilter = true
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
  const [moneySubstageBusy, setMoneySubstageBusy] = useState(false);
  const [detailForm, setDetailForm] = useState(toEditForm(null));
  const [detailStageNoteDraft, setDetailStageNoteDraft] = useState('');
  const [detailStageNoteSaving, setDetailStageNoteSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [areaSelection, setAreaSelection] = useState('');
  const [stageNotesHistory, setStageNotesHistory] = useState([]);
  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState('');
  const [uploadFiles, setUploadFiles] = useState([]);
  const [uploadAllowCustomer, setUploadAllowCustomer] = useState(false);
  const [uploadAllowContractor, setUploadAllowContractor] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoUploads, setPhotoUploads] = useState([]);
  const [uploadPhotoAllowContractor, setUploadPhotoAllowContractor] = useState(false);
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
    text: '',
    table: null
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
  const [isDetailTabletView, setIsDetailTabletView] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(max-width: 1100px) and (min-width: 761px)').matches;
  });
  const [dashboardClockMs, setDashboardClockMs] = useState(() => Date.now());
  const { confirmDialog, alertDialog, dialogPortal } = useSiteDialog();
  const externalStageLabels = Boolean(canUploadProjectFiles) && !canEditProjects;
  const formatDisplayStageName = useCallback(
    (name, stageId) => formatStageName(name, stageId, { audience: externalStageLabels ? 'external' : 'internal' }),
    [externalStageLabels]
  );
  const formatMoneyStageName = useCallback(
    (name, stageId) => formatStageName(name, stageId, { audience: 'internal' }),
    []
  );

  const closePreview = useCallback(() => {
    if (preview.url) {
      window.URL.revokeObjectURL(preview.url);
    }
    setPreviewLoading(false);
    setPreviewRecord(null);
    setPreview({ open: false, url: '', name: '', kind: '', text: '', table: null });
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
    if (!showRequesterFilter) return [];
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
  }, [rows, contractorCompanies, showRequesterFilter]);
  const visibleRows = useMemo(() => {
    if (!showRequesterFilter) return rows;
    if (dashboardRequesterFilter === DASHBOARD_FILTER_ALL) return rows;
    const selected = String(dashboardRequesterFilter || '').trim().toLowerCase();
    if (!selected) return rows;
    return rows.filter((row) => String(row?.project?.requester || '').trim().toLowerCase() === selected);
  }, [rows, dashboardRequesterFilter, showRequesterFilter]);
  const scopedDashboardRows = useMemo(() => {
    if (dashboardMode !== 'money') return visibleRows;
    return visibleRows.filter((row) => MONEY_STATUS_STAGE_IDS.has(String(row?.areaId || '').trim().toLowerCase()));
  }, [visibleRows, dashboardMode]);
  const dashboardRows = useMemo(() => {
    const ordered = [...scopedDashboardRows].sort(sortByProjectNumber);
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
  }, [scopedDashboardRows]);
  const dashboardColumns = useMemo(() => {
    if (!dashboardRows.length) return [[], []];
    const splitIndex = Math.ceil(dashboardRows.length / 2);
    return [dashboardRows.slice(0, splitIndex), dashboardRows.slice(splitIndex)];
  }, [dashboardRows]);

  const photoFiles = useMemo(() => files.filter(isImageFile), [files]);
  const documentFiles = useMemo(() => files.filter((fileRecord) => !isImageFile(fileRecord)), [files]);
  const detailStages = useMemo(
    () =>
      normalizeProjectStages(detailProject?.stages || [], {
        hasSlabWork: coerceSlabWorkFlag(detailProject?.slab_work),
        hasScottsdaleReadyFiles: detailProject?.scottsdale_ready_files === true
      }),
    [detailProject?.stages, detailProject?.slab_work, detailProject?.scottsdale_ready_files]
  );
  const canUploadInFilesTab = canEditProjects || canUploadProjectFiles;
  const projectIsComplete = useMemo(() => {
    const stages = detailStages;
    if (!stages.length) return false;
    return stages.every((stage) => String(stage.status || '').toLowerCase() === 'complete');
  }, [detailStages]);
  const detailCurrentStage = useMemo(
    () => currentStage(detailStages),
    [detailStages]
  );
  const detailCurrentStageDisplayName = useMemo(() => {
    if (!detailCurrentStage) return '';
    return dashboardMode === 'money'
      ? formatMoneyStageName(detailCurrentStage.name, detailCurrentStage.id)
      : formatDisplayStageName(detailCurrentStage.name, detailCurrentStage.id);
  }, [dashboardMode, detailCurrentStage, formatDisplayStageName, formatMoneyStageName]);
  const detailCurrentMoneySubstage = useMemo(
    () => getEffectiveMoneySubstage(detailCurrentStage),
    [detailCurrentStage]
  );
  const detailCurrentMoneySubstageLabel = useMemo(
    () => getMoneySubstageLabel(detailCurrentMoneySubstage) || 'Not started',
    [detailCurrentMoneySubstage]
  );
  const detailProgress = useMemo(
    () => completionPercent(detailStages),
    [detailStages]
  );
  const detailStageRows = useMemo(() => {
    const rowCount = isDetailTabletView ? 3 : 2;
    const rowSize = Math.ceil(detailStages.length / rowCount);
    return Array.from({ length: rowCount }, (_, index) =>
      detailStages.slice(index * rowSize, (index + 1) * rowSize)
    ).filter((row) => row.length > 0);
  }, [detailStages, isDetailTabletView]);
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
      tooltips.set(stage.id, formatStageNotesTooltip(entries, formatDisplayStageName(stage.name, stage.id)));
    });
    return tooltips;
  }, [stageNotesHistory, detailStages, formatDisplayStageName]);
  const stageNoteCountByStageId = useMemo(() => {
    const counts = new Map();
    stageNotesHistory.forEach((entry) => {
      const key = String(entry?.stage_id || '').trim();
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [stageNotesHistory]);
  const currentAreaNotes = useMemo(() => {
    const stageId = String(detailCurrentStage?.id || '').trim();
    if (!stageId) return [];
    return stageNotesHistory
      .filter((entry) => String(entry?.stage_id || '').trim() === stageId)
      .sort((a, b) => new Date(a?.created_at || 0).getTime() - new Date(b?.created_at || 0).getTime());
  }, [stageNotesHistory, detailCurrentStage?.id]);
  const currentAreaNotesText = useMemo(() => {
    if (!currentAreaNotes.length) return '';
    return currentAreaNotes
      .map((entry) => {
        const user = String(entry?.created_by || '').trim() || '-';
        const note = String(entry?.note || '').trim() || '-';
        return `User: ${user}\nNote:\n${note}`;
      })
      .join('\n\n');
  }, [currentAreaNotes]);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listProjects(showArchived ? 'include_deleted=true' : '');
      const mapped = (Array.isArray(data) ? data : []).map((project) => toRow(project, formatDisplayStageName));
      const filtered =
        allowedStageIds === null
          ? mapped
          : mapped.filter((row) => row.areaId && allowedStageIds.has(row.areaId));
      setRows(filtered.sort(sortByProjectNumber));
    } catch (_err) {
      setRows([]);
      setError('Unable to reach the projects list.');
    } finally {
      setLoading(false);
    }
  }, [showArchived, allowedStageIds, formatDisplayStageName]);

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
    if (!showArchivedFilter && showArchived) {
      setShowArchived(false);
    }
  }, [showArchivedFilter, showArchived]);

  useEffect(() => {
    if (!showRequesterFilter) {
      if (dashboardRequesterFilter !== DASHBOARD_FILTER_ALL) {
        setDashboardRequesterFilter(DASHBOARD_FILTER_ALL);
      }
      return;
    }
    if (dashboardRequesterFilter === DASHBOARD_FILTER_ALL) return;
    const selected = String(dashboardRequesterFilter || '').trim().toLowerCase();
    const stillPresent = dashboardRequesterOptions.some(
      (option) => String(option || '').trim().toLowerCase() === selected
    );
    if (!stillPresent) {
      setDashboardRequesterFilter(DASHBOARD_FILTER_ALL);
    }
  }, [dashboardRequesterFilter, dashboardRequesterOptions, showRequesterFilter]);

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
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(max-width: 1100px) and (min-width: 761px)');
    const onChange = () => setIsDetailTabletView(media.matches);
    onChange();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setDashboardClockMs(Date.now()), 60000);
    return () => window.clearInterval(timer);
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

  useEffect(() => {
    if (!error) return;
    let active = true;
    (async () => {
      await alertDialog(error, { title: 'Dashboard error', confirmText: 'OK' });
      if (active) setError('');
    })();
    return () => {
      active = false;
    };
  }, [error, alertDialog]);

  useEffect(() => {
    if (!detailError) return;
    let active = true;
    (async () => {
      await alertDialog(detailError, { title: 'Project details notice', confirmText: 'OK' });
      if (active) setDetailError('');
    })();
    return () => {
      active = false;
    };
  }, [detailError, alertDialog]);

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
      setRows((prev) =>
        prev.map((item) =>
          item.id === row.id ? toRow(latest, formatDisplayStageName) : item
        )
      );
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
    setMoneySubstageBusy(false);
    setDetailProject(null);
    setDetailStageNoteDraft('');
    setDetailStageNoteSaving(false);
    setFiles([]);
    setStageNotesHistory([]);
    setFilesError('');
    setUploadFiles([]);
    setUploadAllowCustomer(false);
    setUploadAllowContractor(false);
    setPhotoUploads([]);
    setUploadPhotoAllowContractor(false);
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
      const currentStageId = detailCurrentStage?.id || '';
      const requestedStageId =
        areaSelection && stageOptions.some((stage) => stage.id === areaSelection)
          ? areaSelection
          : '';
      const payload = {
        project_number: trimOrNull(detailForm.project_number),
        name: detailForm.name.trim(),
        requester: detailForm.requester.trim(),
        project_location_state: trimOrNull(detailForm.project_location_state),
        due_date: trimOrNull(detailForm.due_date),
        urgency: trimOrNull(detailForm.urgency) || 'standard',
        budget: trimOrNull(detailForm.budget),
        slab_work: Boolean(detailForm.slab_work),
        summary: trimOrNull(buildProjectSummary(detailForm.required_docs, detailForm.summary)),
        stage_id: requestedStageId && requestedStageId !== currentStageId ? requestedStageId : undefined
      };
      const updated = await updateProject(detailProject.id, payload);
      const areaChanged = Boolean(payload.stage_id);

      setDetailProject(updated);
      setDetailForm(toEditForm(updated));
      setRows((prev) =>
        prev.map((item) =>
          item.id === updated.id ? toRow(updated, formatDisplayStageName) : item
        )
      );
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
      setRows((prev) =>
        prev.map((item) =>
          item.id === nextProject.id
            ? toRow(nextProject, formatDisplayStageName)
            : item
        )
      );
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
          customer_visible: canEditProjects ? uploadAllowCustomer : false,
          contractor_visible: canEditProjects ? uploadAllowContractor : true
        });
      }
      const uploadedCount = uploadFiles.length;
      setUploadFiles([]);
      setUploadAllowCustomer(false);
      setUploadAllowContractor(false);
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
          customer_visible: canEditProjects,
          contractor_visible: canEditProjects ? uploadPhotoAllowContractor : true,
          content_type: file.type || undefined
        });
      }
      const uploadedCount = photoUploads.length;
      setPhotoUploads([]);
      setUploadPhotoAllowContractor(false);
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

  const handleToggleFileVisibility = async (fileRecord, field, nextValue) => {
    if (!detailProject?.id || !fileRecord?.id) return;
    if (!['customer_visible', 'contractor_visible'].includes(field)) return;
    try {
      const updated = await setProjectFileVisibility(detailProject.id, fileRecord.id, {
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
    if (!detailProject?.id || !fileRecord?.id) return;
    setFilesError('');
    const name = fileRecord.filename || 'File preview';
    setPreviewRecord(fileRecord);
    setPreview({ open: true, url: '', name, kind: 'loading', text: '', table: null });
    setPreviewLoading(true);
    try {
      const blob = await downloadProjectFile(detailProject.id, fileRecord.id);
      if (isImageFile(fileRecord)) {
        const url = window.URL.createObjectURL(blob);
        setPreview({ open: true, url, name, kind: 'image', text: '', table: null });
        return;
      }
      if (isSpreadsheetFile(fileRecord)) {
        const table = await buildSpreadsheetPreview(fileRecord, blob);
        setPreview({
          open: true,
          url: '',
          name,
          kind: 'table',
          text: table.note || '',
          table
        });
        return;
      }
      if (isTextFile(fileRecord)) {
        const isTruncated = blob.size > TEXT_PREVIEW_LIMIT_BYTES;
        const textBlob = isTruncated ? blob.slice(0, TEXT_PREVIEW_LIMIT_BYTES) : blob;
        const text = await textBlob.text();
        setPreview({ open: true, url: '', name, kind: 'text', text, table: null });
        if (isTruncated) {
          setFilesError('Showing partial text preview (first 1 MB). Download for full file.');
        }
        return;
      }
      if (isPdfFile(fileRecord)) {
        const url = window.URL.createObjectURL(blob);
        setPreview({ open: true, url, name, kind: 'pdf', text: '', table: null });
        return;
      }
      setPreview({
        open: true,
        url: '',
        name,
        kind: 'unsupported',
        text: 'Preview unavailable for this file type. Use Download.',
        table: null
      });
    } catch (_err) {
      setPreview({
        open: true,
        url: '',
        name,
        kind: 'unsupported',
        text: 'Unable to load preview. You can still use Download or Delete.',
        table: null
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleMoneySubstageChange = async (nextValue) => {
    if (!detailProject?.id || !detailCurrentStage?.id || !canEditMoneySubstages) return;
    if (!isMoneyTrackingStage(detailCurrentStage.id)) return;
    if (nextValue === detailCurrentMoneySubstage) return;
    setMoneySubstageBusy(true);
    setDetailError('');
    setDetailStatus('');
    try {
      const updatedStage = await updateMoneySubstage(detailProject.id, detailCurrentStage.id, {
        money_substage: nextValue
      });
      const nextProject = {
        ...detailProject,
        stages: (detailProject.stages || []).map((stage) =>
          stage.id === detailCurrentStage.id ? { ...stage, ...(updatedStage || {}) } : stage
        )
      };
      setDetailProject(nextProject);
      setRows((prev) =>
        prev.map((item) =>
          item.id === nextProject.id ? toRow(nextProject, formatDisplayStageName) : item
        )
      );
      setDetailStatus('Payment status updated.');
    } catch (_err) {
      setDetailError('Unable to update payment status.');
    } finally {
      setMoneySubstageBusy(false);
    }
  };

  const toggleDetailRequiredDoc = (docId) => (event) => {
    const checked = Boolean(event.target.checked);
    setDetailForm((prev) => ({
      ...prev,
      required_docs: {
        ...(prev.required_docs || buildEmptyRequiredDocs()),
        [docId]: checked
      }
    }));
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
    const shouldDelete = await confirmDialog(`Delete ${fileRecord.filename}? This cannot be undone.`, {
      title: 'Delete file',
      confirmText: 'Delete'
    });
    if (!shouldDelete) return false;
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
    const shouldCompress = await confirmDialog(
      'Compress all project files into a single archive? This removes individual files.',
      { title: 'Compress files', confirmText: 'Compress' }
    );
    if (!shouldCompress) {
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
    const shouldArchive = await confirmDialog('Archive this project? You can restore it later.', {
      title: 'Archive project',
      confirmText: 'Archive'
    });
    if (!shouldArchive) return;
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
    const shouldDelete = await confirmDialog('Delete this project permanently? This cannot be undone.', {
      title: 'Delete project',
      confirmText: 'Delete'
    });
    if (!shouldDelete) return;
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
    const areaStyle = getStageBadgeStyle(row.areaId);
    const timingAlertTone = stageTimingAlertTone(row.stage, row.stageWaitingSince, dashboardClockMs);
    const stageNameFormatter = dashboardMode === 'money' ? formatMoneyStageName : formatDisplayStageName;
    const areaNoteTitle = formatStageEstimateTooltip(
      row.stage,
      row.stageWaitingSince,
      dashboardClockMs,
      stageNameFormatter
    );
    const projectNotesTitle = showHoverNotes
      ? formatDashboardProjectNotesTooltip(row.project?.summary || '')
      : undefined;
    const stageLabel = dashboardMode === 'money' ? row.moneyStageName : row.area;
    const paymentStatusLabel = row.moneySubstageLabel || 'Awaiting update';
    const paymentStatusTone = moneySubstageToneClass(row.moneySubstage);
    return (
      <tr
        key={row.id || `${row.name}-${keyPrefix}-${idx}`}
        className={row.isDeleted ? 'row-archived' : ''}
        data-tutorial-id={idx === 0 ? 'dashboard-project-row' : undefined}
        onDoubleClick={() => openDetails(row)}
      >
        <td className={showHoverNotes ? 'dashboard-name-with-notes' : ''} title={projectNotesTitle}>
          {row.projectNumber ? `${row.projectNumber} - ${row.name}` : row.name}
        </td>
        <td>
          <span
            className={`area-pill${showHoverNotes ? ' dashboard-area-with-notes' : ''}${
              timingAlertTone ? ` time-alert-${timingAlertTone}` : ''
            }`}
            style={areaStyle}
            title={areaNoteTitle}
          >
            {stageLabel}
          </span>
        </td>
        {dashboardMode === 'money' ? (
          <td>
            <span className={`status-pill ${paymentStatusTone}`}>{paymentStatusLabel}</span>
          </td>
        ) : null}
      </tr>
    );
  };

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>{dashboardMode === 'money' ? 'Money Status' : 'Dashboard'}</h2>
            <p className="muted">
              {dashboardMode === 'money'
                ? 'Double-click a project row to view details.'
                : 'Double-click a project row to view details.'}
            </p>
          </div>
          <div className="detail-header-actions">
            {showRequesterFilter ? (
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
            ) : null}
            {showArchivedFilter ? (
              <label className="switch-field switch-field--pill">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(event) => setShowArchived(event.target.checked)}
                />
                <span className="switch-track" aria-hidden="true">
                  <span className="switch-thumb" />
                </span>
                <span className="switch-text">{showArchived ? 'Archived Showing' : 'Archived Hidden'}</span>
              </label>
            ) : null}
          </div>
        </div>
        {loading ? <p className="muted">Loading projects...</p> : null}
        {dashboardRows.length ? (
          splitDashboardLayout ? (
          <div className="dashboard-columns">
            {dashboardColumns.map((columnRows, columnIdx) => (
              <div className="table-scroll dashboard-table-scroll dashboard-split-scroll" key={`dashboard-col-${columnIdx}`}>
                <table
                  className={`project-table dashboard-table dashboard-split-table${
                    dashboardMode === 'money' ? ' money-status-table' : ''
                  }`}
                >
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Current Stage</th>
                      {dashboardMode === 'money' ? <th>Payment Status</th> : null}
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
              <table className={`project-table dashboard-table${dashboardMode === 'money' ? ' money-status-table' : ''}`}>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Current Stage</th>
                    {dashboardMode === 'money' ? <th>Payment Status</th> : null}
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
            <table className={`project-table dashboard-table${dashboardMode === 'money' ? ' money-status-table' : ''}`}>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Current Stage</th>
                    {dashboardMode === 'money' ? <th>Payment Status</th> : null}
                  </tr>
                </thead>
                <tbody>
                  <tr className="empty-row">
                    <td colSpan={dashboardMode === 'money' ? 3 : 2}>
                      {dashboardMode === 'money'
                        ? 'No projects currently require payment.'
                      : showRequesterFilter && dashboardRequesterFilter !== DASHBOARD_FILTER_ALL
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
                  <button
                    className="ghost"
                    type="button"
                    data-tutorial-id="detail-close-button"
                    onClick={closeDetails}
                    disabled={saving}
                  >
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
                        data-tutorial-id={tab.id === 'project' ? 'detail-tab-project' : tab.id === 'files' ? 'detail-tab-files' : undefined}
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
                {detailStatus ? <p className="muted">{detailStatus}</p> : null}
                {detailProject ? (
                  <div className="project-detail-grid">
                {detailTab === 'project' ? (
                <div className="detail-card pipeline-progress-card">
                  <div className="detail-card-header">
                    <h3>Progress</h3>
                  </div>
                    <div className="customer-progress-top pipeline-progress-top">
                      <div className="muted customer-current-stage-label">Your Project Is In</div>
                      <p className="customer-current-stage">
                      {detailCurrentStageDisplayName || 'Waiting for stage assignment.'}
                    </p>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${detailProgress}%` }} />
                  </div>
                  <div className="progress-meta">
                    <div className="muted">Progress</div>
                    <div className="progress-pill">{`${detailProgress}%`}</div>
                  </div>
                  {detailStages.length ? (
                    <div className="customer-stage-table-wrap">
                      <div className="customer-stage-table-scroll">
                        <div className="customer-stage-grid">
                          {detailStageRows.map((row, rowIndex) => {
                            const cells = row.map((item) => {
                              const fullName = formatDisplayStageName(item?.name, item?.id);
                              const compactName = formatMoneyStageGlyph(item?.name, item?.id, {
                                audience: externalStageLabels ? 'external' : 'internal'
                              });
                              const isMoneyGlyph = compactName.trim().endsWith('$');
                              return { item, fullName, compactName, isMoneyGlyph };
                            });
                            const columnTemplate = cells
                              .map((cell) => (cell.isMoneyGlyph ? '0.65fr' : '1fr'))
                              .join(' ');
                            return (
                              <div
                                key={`detail-stage-row-${rowIndex}`}
                                className="customer-stage-row"
                                style={{ gridTemplateColumns: columnTemplate }}
                              >
                                {cells.map(({ item, fullName, compactName, isMoneyGlyph }) => (
                                  <div
                                    key={item.id}
                                    className={`customer-stage-cell ${progressStageStatusClass(item.status)}${
                                      isMoneyGlyph ? ' money-glyph' : ''
                                    }`}
                                    title={compactName !== fullName ? fullName : undefined}
                                  >
                                    <span className="customer-stage-label-desktop">{compactName}</span>
                                    <span className="customer-stage-label-mobile">{fullName}</span>
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
                ) : null}

                {detailTab === 'project' ? (
                <div className="detail-card">
                  {!canEditProjectDetails ? (
                    <p className="muted">
                      {canEditProjects
                        ? 'View only for project fields. Contractor accounts can still add stage notes.'
                        : 'View only. Add the Admin area to edit project fields.'}
                    </p>
                  ) : null}
                  <div className={`form-grid project-detail-form${canEditProjectDetails ? '' : ' detail-static-grid'}`}>
                    <label>
                      Project #
                      {canEditProjectDetails ? (
                        <input
                          value={detailForm.project_number}
                          onChange={(event) => setDetailForm({ ...detailForm, project_number: event.target.value })}
                        />
                      ) : (
                        <div className={`field-static${detailForm.project_number ? '' : ' empty'}`}>
                          {detailForm.project_number || '-'}
                        </div>
                      )}
                    </label>
                    <label>
                      Project name
                      {canEditProjectDetails ? (
                        <input
                          value={detailForm.name}
                          onChange={(event) => setDetailForm({ ...detailForm, name: event.target.value })}
                        />
                      ) : (
                        <div className={`field-static${detailForm.name ? '' : ' empty'}`}>
                          {detailForm.name || '-'}
                        </div>
                      )}
                    </label>
                    <label>
                      Requester
                      {canEditProjectDetails ? (
                        <>
                          <input
                            value={detailForm.requester}
                            list="shared-party-options"
                            onChange={(event) => setDetailForm({ ...detailForm, requester: event.target.value })}
                          />
                          <datalist id="shared-party-options">
                            {requesterOptions.map((requester) => (
                              <option key={requester} value={requester} />
                            ))}
                          </datalist>
                        </>
                      ) : (
                        <div className={`field-static${detailForm.requester ? '' : ' empty'}`}>
                          {detailForm.requester || '-'}
                        </div>
                      )}
                    </label>
                    <label>
                      Project Location (State)
                      {canEditProjectDetails ? (
                        <input
                          value={detailForm.project_location_state}
                          onChange={(event) =>
                            setDetailForm({ ...detailForm, project_location_state: event.target.value })
                          }
                          placeholder="AZ"
                        />
                      ) : (
                        <div className={`field-static${detailForm.project_location_state ? '' : ' empty'}`}>
                          {detailForm.project_location_state || '-'}
                        </div>
                      )}
                    </label>
                    <label>
                      Due date
                      {canEditProjectDetails ? (
                        <input
                          type="date"
                          value={detailForm.due_date}
                          onChange={(event) => setDetailForm({ ...detailForm, due_date: event.target.value })}
                        />
                      ) : (
                        <div className={`field-static${detailForm.due_date ? '' : ' empty'}`}>
                          {detailForm.due_date || '-'}
                        </div>
                      )}
                    </label>
                    <label>
                      Urgency
                      {canEditProjectDetails ? (
                        <select
                          value={detailForm.urgency}
                          onChange={(event) => setDetailForm({ ...detailForm, urgency: event.target.value })}
                        >
                          <option value="low">Low</option>
                          <option value="standard">Standard</option>
                          <option value="high">High</option>
                          <option value="critical">Critical</option>
                        </select>
                      ) : (
                        <div className={`field-static${detailForm.urgency ? '' : ' empty'}`}>
                          {detailForm.urgency || '-'}
                        </div>
                      )}
                    </label>
                    <label>
                      Budget
                      {canEditProjectDetails ? (
                        <input
                          value={detailForm.budget}
                          onChange={(event) => setDetailForm({ ...detailForm, budget: event.target.value })}
                        />
                      ) : (
                        <div className={`field-static${detailForm.budget ? '' : ' empty'}`}>
                          {detailForm.budget || '-'}
                        </div>
                      )}
                    </label>
                    <label className="span-2">
                      Current area
                      {canEditProjectDetails ? (
                        <select value={areaSelection} onChange={(event) => setAreaSelection(event.target.value)}>
                          {stageOptions.map((stage) => (
                            <option key={stage.id} value={stage.id}>
                            {formatDisplayStageName(stage.name, stage.id)}
                          </option>
                        ))}
                        </select>
                      ) : (
                        <div className="field-static">
                          {detailCurrentStageDisplayName || '-'}
                        </div>
                      )}
                    </label>
                    {dashboardMode === 'money' && detailCurrentStage && isMoneyTrackingStage(detailCurrentStage.id) ? (
                      <div className="span-2 detail-money-substage-card">
                        <div className="detail-money-substage-head">
                          <div>
                            <div className="detail-money-substage-title">Payment status</div>
                            <div className="muted">
                              Current money stage: {formatMoneyStageName(detailCurrentStage.name, detailCurrentStage.id)}
                            </div>
                          </div>
                          <span className={`status-pill ${moneySubstageToneClass(detailCurrentMoneySubstage)}`}>
                            {detailCurrentMoneySubstageLabel}
                          </span>
                        </div>
                        {canEditMoneySubstages ? (
                          <div className="detail-money-substage-actions">
                            {MONEY_SUBSTAGE_OPTIONS.map((option) => (
                              <button
                                key={option.id}
                                type="button"
                                className={`ghost money-substage-button${
                                  detailCurrentMoneySubstage === option.id ? ' active' : ''
                                }`}
                                onClick={() => handleMoneySubstageChange(option.id)}
                                disabled={moneySubstageBusy || saving}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {canEditProjectDetails ? (
                      <label className="span-2 intake-slab-toggle detail-slab-toggle">
                        <input
                          type="checkbox"
                          checked={Boolean(detailForm.slab_work)}
                          onChange={(event) =>
                            setDetailForm({ ...detailForm, slab_work: event.target.checked })
                          }
                        />
                        <span>
                          {detailForm.slab_work
                            ? 'Slab work required'
                            : 'Enable slab work'}
                        </span>
                      </label>
                    ) : (
                      <label className="span-2">
                        Slab work
                        <div className="field-static">
                          {detailForm.slab_work ? 'Required' : 'Not required'}
                        </div>
                      </label>
                    )}
                    <div className="intake-docs span-2" role="group" aria-labelledby="detail-required-docs-title">
                      <div id="detail-required-docs-title" className="intake-docs-title">
                        Required docs
                      </div>
                      <div className="intake-docs-grid">
                        {REQUIRED_DOC_OPTIONS.map((option) => (
                          <label key={option.id} className="intake-doc-option">
                            <input
                              type="checkbox"
                              checked={Boolean(detailForm.required_docs?.[option.id])}
                              onChange={toggleDetailRequiredDoc(option.id)}
                              disabled={!canEditProjectDetails}
                            />
                            <span>{option.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <label className="span-2">
                      Notes
                      {canEditProjectDetails ? (
                        <textarea
                          value={detailForm.summary}
                          onChange={(event) => setDetailForm({ ...detailForm, summary: event.target.value })}
                          rows={4}
                        />
                      ) : (
                        <div className={`field-static field-static-multiline${detailForm.summary ? '' : ' empty'}`}>
                          {detailForm.summary || 'No notes.'}
                        </div>
                      )}
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
                  <div className="area-notes-history">
                    <div className="detail-card-header">
                      <h3>
                        All notes ({formatDisplayStageName(detailCurrentStage?.name, detailCurrentStage?.id) || 'Current area'})
                      </h3>
                    </div>
                    <textarea
                      className="notes-history-window"
                      value={currentAreaNotesText}
                      readOnly
                      rows={8}
                      placeholder="No notes yet for this area."
                    />
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
                                  {formatDisplayStageName(stage.name, stage.id)}
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
                              <td key={`${stage.id}-started`} title={formatTimeOnly(stage.started_at)}>
                                {formatDateOnly(stage.started_at)}
                              </td>
                            ))}
                          </tr>
                          <tr>
                            <th className="stage-matrix-label">Completed</th>
                            {detailStages.map((stage) => (
                              <td key={`${stage.id}-completed`} title={formatTimeOnly(stage.completed_at)}>
                                {formatDateOnly(stage.completed_at)}
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
                  {canUploadInFilesTab ? (
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
                      {canEditProjects ? (
                        <>
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
                        </>
                      ) : (
                        <span className="muted">Contractor uploads are visible to the project team.</span>
                      )}
                      <span className="file-upload-selected">
                        {summarizeSelection(uploadFiles, 'No files selected', 'files')}
                      </span>
                    </div>
                  </form>
                  ) : (
                    <p className="muted">Showing files shared with your contractor access.</p>
                  )}
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
                            {canEditProjects ? (
                              <>
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
                              </>
                            ) : null}
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
                  {canUploadInFilesTab ? (
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
                      {canEditProjects ? (
                        <>
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
                        </>
                      ) : (
                        <span className="muted">Contractor uploads are visible to the project team.</span>
                      )}
                      <span className="file-upload-selected">
                        {summarizeSelection(photoUploads, 'No photos selected', 'photos')}
                      </span>
                    </div>
                  </form>
                  ) : (
                    <p className="muted">Showing photos shared with your contractor access.</p>
                  )}
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
                            {canEditProjects ? (
                              <>
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
                              </>
                            ) : null}
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
                ) : preview.kind === 'table' ? (
                  <div className="file-preview-table-wrap">
                    {preview.text ? <p className="muted">{preview.text}</p> : null}
                    {Array.isArray(preview.table?.rows) && preview.table.rows.length ? (
                      <div className="table-scroll">
                        <table className="project-table file-preview-table">
                          <thead>
                            <tr>
                              {(preview.table.headers || []).map((header, index) => (
                                <th key={`${header}-${index}`}>{header}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {preview.table.rows.map((row, rowIndex) => (
                              <tr key={`row-${rowIndex}`}>
                                {(preview.table.headers || []).map((_, colIndex) => (
                                  <td key={`cell-${rowIndex}-${colIndex}`}>{row[colIndex] || ''}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="file-preview-fallback">No tabular data found to preview.</div>
                    )}
                  </div>
                ) : preview.kind === 'pdf' ? (
                  <object className="file-preview-frame" data={preview.url} type="application/pdf">
                    <div className="file-preview-fallback">PDF preview unavailable. Download to open.</div>
                  </object>
                ) : (
                  <div className="file-preview-fallback">
                    {preview.text || 'Preview unavailable for this file type.'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}

      {dialogPortal}
    </>
  );
}
