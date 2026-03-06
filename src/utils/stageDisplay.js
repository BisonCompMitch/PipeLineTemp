function normalizeValue(value) {
  return String(value || '').trim();
}

function normalizeId(value) {
  return normalizeValue(value).toLowerCase();
}

export const STAGE_FLOW = [
  { id: 'plans_received', name: 'Plans Recieved', owner: 'Admin', default_duration_hours: 1 },
  { id: 'budget', name: 'CFS Budget', owner: 'CFS', default_duration_hours: 24 },
  { id: 'money_design', name: 'Money - D&E', owner: 'Admin', default_duration_hours: 1 },
  { id: 'design', name: 'Design', owner: 'Design Lead', default_duration_hours: 24 },
  { id: 'engineering', name: 'Engineering', owner: 'Engineering Lead', default_duration_hours: 24 },
  { id: 'estimating', name: 'Estimating', owner: 'Estimating Lead', default_duration_hours: 24 },
  { id: 'money_production', name: 'Money - Production', owner: 'Admin', default_duration_hours: 1 },
  { id: 'manufacturing', name: 'Manufacturing', owner: 'Manufacturing Lead', default_duration_hours: 24 },
  { id: 'money_shipping', name: 'Money - Shipping', owner: 'Admin', default_duration_hours: 1 },
  { id: 'shipping', name: 'Shipping', owner: 'Shipping Lead', default_duration_hours: 24 },
  { id: 'final_payment', name: 'Collect Final Payment', owner: 'Admin', default_duration_hours: 1 },
  { id: 'completed', name: 'Completed', owner: 'Archive', default_duration_hours: 1 }
];

export function formatStageName(name, stageId = '') {
  const rawName = normalizeValue(name);
  const id = normalizeId(stageId);
  if (id === 'money_design') return 'Money - D&E';
  if (/^money\s*(check\s*)?-\s*design$/i.test(rawName)) return 'Money - D&E';
  if (/^money\s*design$/i.test(rawName)) return 'Money - D&E';
  return rawName;
}

export function formatMoneyStageGlyph(name, stageId = '') {
  const displayName = formatStageName(name, stageId);
  const id = normalizeId(stageId);
  if (id.startsWith('money_') || /^money\s*(check\s*)?-\s*/i.test(displayName)) {
    return '$';
  }
  return displayName;
}

export function normalizeProjectStages(stages = []) {
  const rawStages = Array.isArray(stages) ? stages : [];
  if (!rawStages.length) return [];

  const byId = new Map();
  rawStages.forEach((stage) => {
    const id = normalizeId(stage?.id || stage?.stage_id);
    if (!id) return;
    byId.set(id, stage);
  });

  const activeStage = rawStages.find((stage) => String(stage?.status || '').toLowerCase() !== 'complete') || rawStages[rawStages.length - 1];
  const activeId = normalizeId(activeStage?.id || activeStage?.stage_id);
  const activeIndex = STAGE_FLOW.findIndex((entry) => entry.id === activeId);

  const normalized = STAGE_FLOW.map((entry, index) => {
    const existing = byId.get(entry.id);
    if (existing) {
      return {
        ...existing,
        id: entry.id,
        name: formatStageName(existing.name || entry.name, entry.id)
      };
    }

    let inferredStatus = 'pending';
    if (activeIndex >= 0) {
      if (index < activeIndex) inferredStatus = 'complete';
      if (index === activeIndex) inferredStatus = entry.id === 'completed' ? 'complete' : 'in_progress';
    }

    return {
      id: entry.id,
      name: entry.name,
      owner: entry.owner,
      status: inferredStatus,
      notice: inferredStatus === 'complete' ? 'green' : 'neutral',
      default_duration_hours: entry.default_duration_hours,
      expected_hours: entry.default_duration_hours,
      started_at: null,
      completed_at: null
    };
  });

  const known = new Set(STAGE_FLOW.map((entry) => entry.id));
  rawStages.forEach((stage) => {
    const id = normalizeId(stage?.id || stage?.stage_id);
    if (!id || known.has(id)) return;
    normalized.push({
      ...stage,
      id,
      name: formatStageName(stage?.name, id)
    });
  });

  return normalized;
}
