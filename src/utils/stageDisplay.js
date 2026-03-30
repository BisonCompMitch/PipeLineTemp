function normalizeValue(value) {
  return String(value || '').trim();
}

function normalizeId(value) {
  return normalizeValue(value).toLowerCase();
}

function normalizeStageStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function isActiveStageStatus(value) {
  const status = normalizeStageStatus(value);
  return status === 'in_progress' || status === 'awaiting_approval';
}

export function coerceSlabWorkFlag(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (['true', '1', 'yes', 'y', 't'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'f'].includes(normalized)) return false;
  }
  return undefined;
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

export const BASE_STAGE_FLOW = [
  { id: 'plans_received', name: 'Plans Received', owner: 'Admin', default_duration_hours: 1 },
  { id: 'budget', name: 'Rough Estimate / Sales Tax Certificate', owner: 'CFS', default_duration_hours: 24 },
  { id: 'invoice_design', name: 'Invoice Sent - D&E', owner: 'Admin', default_duration_hours: 1 },
  { id: 'money_design', name: 'Money - D&E', owner: 'Admin', default_duration_hours: 1 },
  { id: 'design', name: 'Design', owner: 'Design Lead', default_duration_hours: 24 },
  { id: 'engineering', name: 'Engineering', owner: 'Engineering Lead', default_duration_hours: 24 },
  { id: 'estimating', name: 'Estimating', owner: 'Estimating Lead', default_duration_hours: 24 },
  { id: 'invoice_production', name: 'Invoice Sent - Production', owner: 'Admin', default_duration_hours: 1 },
  { id: 'money_production', name: 'Money - Production', owner: 'Admin', default_duration_hours: 1 },
  { id: 'manufacturing', name: 'Manufacturing', owner: 'Manufacturing Lead', default_duration_hours: 24 },
  { id: 'invoice_shipping', name: 'Manufacturing - Invoice Sent', owner: 'Admin', default_duration_hours: 1 },
  { id: 'money_shipping', name: 'Money - Shipping', owner: 'Admin', default_duration_hours: 1 },
  { id: 'shipping', name: 'Shipping', owner: 'Shipping Lead', default_duration_hours: 24 },
  { id: 'final_payment', name: 'Collect Final Payment', owner: 'Admin', default_duration_hours: 1 },
  { id: 'completed', name: 'Completed', owner: 'Archive', default_duration_hours: 1 }
];

export const SLAB_STAGE_FLOW = [
  { id: 'plans_received', name: 'Plans Received', owner: 'Admin', default_duration_hours: 1 },
  { id: 'money_slab', name: 'Money - Slab', owner: 'Admin', default_duration_hours: 1 },
  { id: 'slab_work', name: 'Slab Work', owner: 'Manufacturing Lead', default_duration_hours: 24 },
  { id: 'budget', name: 'Rough Estimate / Sales Tax Certificate', owner: 'CFS', default_duration_hours: 24 },
  { id: 'invoice_design', name: 'Invoice Sent - D&E', owner: 'Admin', default_duration_hours: 1 },
  { id: 'money_design', name: 'Money - D&E', owner: 'Admin', default_duration_hours: 1 },
  { id: 'design', name: 'Design', owner: 'Design Lead', default_duration_hours: 24 },
  { id: 'engineering', name: 'Engineering', owner: 'Engineering Lead', default_duration_hours: 24 },
  { id: 'estimating', name: 'Estimating', owner: 'Estimating Lead', default_duration_hours: 24 },
  { id: 'invoice_production', name: 'Invoice Sent - Production', owner: 'Admin', default_duration_hours: 1 },
  { id: 'money_production', name: 'Money - Production', owner: 'Admin', default_duration_hours: 1 },
  { id: 'manufacturing', name: 'Manufacturing', owner: 'Manufacturing Lead', default_duration_hours: 24 },
  { id: 'invoice_shipping', name: 'Manufacturing - Invoice Sent', owner: 'Admin', default_duration_hours: 1 },
  { id: 'money_shipping', name: 'Money - Shipping', owner: 'Admin', default_duration_hours: 1 },
  { id: 'shipping', name: 'Shipping', owner: 'Shipping Lead', default_duration_hours: 24 },
  { id: 'final_payment', name: 'Collect Final Payment', owner: 'Admin', default_duration_hours: 1 },
  { id: 'completed', name: 'Completed', owner: 'Archive', default_duration_hours: 1 }
];

export const STAGE_FLOW = SLAB_STAGE_FLOW;

const SLAB_STAGE_IDS = new Set(['money_slab', 'slab_work']);
const MONEY_STAGE_IDS = new Set(['money_design', 'money_slab', 'money_production', 'money_shipping', 'final_payment']);
const INVOICE_STAGE_IDS = new Set(['invoice_design', 'invoice_production', 'invoice_shipping']);

const COLOR_PLANS = '#E5E7EB';
const COLOR_BUDGET = '#86EFAC';
const COLOR_MONEY = '#FCA5A5';
const COLOR_INVOICE = '#FDE68A';
const COLOR_DESIGN = '#BBF7D0';
const COLOR_ENGINEERING = '#BFDBFE';
const COLOR_ESTIMATING = '#FDE68A';
const COLOR_MANUFACTURING = '#FDBA74';
const COLOR_SHIPPING = '#99F6E4';
const COLOR_COMPLETED = '#CBD5E1';
const COLOR_SLAB_MONEY = COLOR_MONEY;
const COLOR_SLAB_WORK = '#FBCFE8';

export const STAGE_COLORS = {
  plans_received: COLOR_PLANS,
  budget: COLOR_BUDGET,
  invoice_design: COLOR_INVOICE,
  money_design: COLOR_MONEY,
  design: COLOR_DESIGN,
  engineering: COLOR_ENGINEERING,
  estimating: COLOR_ESTIMATING,
  money_slab: COLOR_SLAB_MONEY,
  slab_work: COLOR_SLAB_WORK,
  invoice_production: COLOR_INVOICE,
  money_production: COLOR_MONEY,
  manufacturing: COLOR_MANUFACTURING,
  invoice_shipping: COLOR_INVOICE,
  money_shipping: COLOR_MONEY,
  shipping: COLOR_SHIPPING,
  final_payment: COLOR_MONEY,
  completed: COLOR_COMPLETED
};

function resolveFlow(rawStages, options = {}) {
  const explicit = coerceSlabWorkFlag(options?.hasSlabWork);
  if (typeof explicit === 'boolean') {
    return explicit ? SLAB_STAGE_FLOW : BASE_STAGE_FLOW;
  }
  const hasSlabStage = (rawStages || []).some((stage) => {
    const id = normalizeId(stage?.id || stage?.stage_id);
    return SLAB_STAGE_IDS.has(id);
  });
  return hasSlabStage ? SLAB_STAGE_FLOW : BASE_STAGE_FLOW;
}

export function getStageColor(stageId = '') {
  const id = normalizeId(stageId);
  return STAGE_COLORS[id] || 'rgba(148, 163, 184, 0.25)';
}

export function getStageBadgeStyle(stageId = '') {
  const backgroundColor = getStageColor(stageId);
  return { backgroundColor, color: textColorForHex(backgroundColor) };
}

export function formatStageName(name, stageId = '', options = {}) {
  const rawName = normalizeValue(name);
  const id = normalizeId(stageId);
  const audience = options?.audience === 'external' ? 'external' : 'internal';

  if (id === 'plans_received') return 'Plans Received';
  if (/^plans\s+recieved$/i.test(rawName)) return 'Plans Received';
  if (/^plans\s+revieved$/i.test(rawName)) return 'Plans Received';
  if (/^plans\s+received$/i.test(rawName)) return 'Plans Received';

  if (id === 'budget') return 'Rough Estimate / Sales Tax Certificate';
  if (/^cfs\s+budget$/i.test(rawName)) return 'Rough Estimate / Sales Tax Certificate';
  if (/^rough\s+estimate$/i.test(rawName)) return 'Rough Estimate / Sales Tax Certificate';
  if (/^rough\s+estimate\s*\/\s*sales\s+tax\s+certificate$/i.test(rawName)) return 'Rough Estimate / Sales Tax Certificate';

  if (id === 'money_design') return 'Money - D&E';
  if (/^money\s*(check\s*)?-\s*(design|d&e|de)$/i.test(rawName)) return 'Money - D&E';
  if (/^money\s*design$/i.test(rawName)) return 'Money - D&E';

  if (id === 'invoice_design') return 'Invoice Sent - D&E';
  if (/^invoice\s*sent\s*-\s*(d&e|de|design)$/i.test(rawName)) return 'Invoice Sent - D&E';
  if (/^invoice\s*sent\s*(d&e|de|design)$/i.test(rawName)) return 'Invoice Sent - D&E';

  if (id === 'money_slab') return 'Money - Slab';
  if (/^money\s*(check\s*)?-\s*slab$/i.test(rawName)) return 'Money - Slab';
  if (/^money\s*slab$/i.test(rawName)) return 'Money - Slab';

  if (id === 'invoice_production') return 'Invoice Sent - Production';
  if (/^invoice\s*sent\s*-\s*production$/i.test(rawName)) return 'Invoice Sent - Production';
  if (/^invoice\s*sent\s*production$/i.test(rawName)) return 'Invoice Sent - Production';

  if (id === 'invoice_shipping') return 'Manufacturing - Invoice Sent';
  if (/^manufacturing\s*-\s*invoice\s*sent$/i.test(rawName)) return 'Manufacturing - Invoice Sent';
  if (/^manufacturing\s*invoice\s*sent$/i.test(rawName)) return 'Manufacturing - Invoice Sent';

  if (id === 'money_shipping') return 'Money - Shipping';
  if (/^money\s*(check\s*)?-\s*shipping$/i.test(rawName)) return 'Money - Shipping';
  if (/^money\s*shipping$/i.test(rawName)) return 'Money - Shipping';

  if (id === 'slab_work') return 'Slab Work';
  if (/^slab\s*work$/i.test(rawName)) return 'Slab Work';

  if (audience === 'external') {
    if (id === 'design') return 'Design';
    if (id === 'engineering') return 'Engineering';
    if (/^design\s*&\s*engineering$/i.test(rawName)) {
      return id === 'engineering' ? 'Engineering' : 'Design';
    }
  }

  return rawName;
}

export function formatMoneyStageGlyph(name, stageId = '', options = {}) {
  const displayName = formatStageName(name, stageId, options);
  const id = normalizeId(stageId);
  if (id === 'budget') return 'Rough Estimate';
  if (INVOICE_STAGE_IDS.has(id)) return 'Invoice Sent';
  if (MONEY_STAGE_IDS.has(id) || /^money\s*(check\s*)?-\s*/i.test(displayName)) {
    return '$';
  }
  return displayName;
}

export function normalizeProjectStages(stages = [], options = {}) {
  const rawStages = Array.isArray(stages) ? stages : [];
  if (!rawStages.length) return [];

  const flow = resolveFlow(rawStages, options);
  const formatOptions = options?.formatOptions || undefined;
  const byId = new Map();
  rawStages.forEach((stage) => {
    const id = normalizeId(stage?.id || stage?.stage_id);
    if (!id) return;
    byId.set(id, stage);
  });

  const activeStage =
    rawStages.find((stage) => isActiveStageStatus(stage?.status)) ||
    rawStages.find((stage) => normalizeStageStatus(stage?.status) !== 'complete') ||
    rawStages[rawStages.length - 1];
  const activeId = normalizeId(activeStage?.id || activeStage?.stage_id);
  const activeIndex = flow.findIndex((entry) => entry.id === activeId);

  const normalized = flow.map((entry, index) => {
    const existing = byId.get(entry.id);
    if (existing) {
      const existingStatus = normalizeStageStatus(existing?.status);
      let nextStatus = existingStatus || 'pending';
      if (activeIndex >= 0) {
        if (index < activeIndex) {
          nextStatus = 'complete';
        } else if (index === activeIndex && nextStatus === 'pending') {
          nextStatus = 'in_progress';
        }
      }
      return {
        ...existing,
        id: entry.id,
        name: formatStageName(existing.name || entry.name, entry.id, formatOptions),
        status: nextStatus
      };
    }

    let inferredStatus = 'pending';
    if (activeIndex >= 0) {
      if (index < activeIndex) inferredStatus = 'complete';
      if (index === activeIndex) inferredStatus = entry.id === 'completed' ? 'complete' : 'in_progress';
    }

    return {
      id: entry.id,
      name: formatStageName(entry.name, entry.id, formatOptions),
      owner: entry.owner,
      status: inferredStatus,
      notice: inferredStatus === 'complete' ? 'green' : 'neutral',
      default_duration_hours: entry.default_duration_hours,
      expected_hours: entry.default_duration_hours,
      started_at: null,
      completed_at: null
    };
  });

  const known = new Set(flow.map((entry) => entry.id));
  rawStages.forEach((stage) => {
    const id = normalizeId(stage?.id || stage?.stage_id);
    if (!id || known.has(id)) return;
    normalized.push({
      ...stage,
      id,
      name: formatStageName(stage?.name, id, formatOptions)
    });
  });

  return normalized;
}
