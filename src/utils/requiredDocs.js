export const REQUIRED_DOC_OPTIONS = [
  { id: 'foundation_plans', label: 'Foundation Plans and details' },
  { id: 'framing_plans', label: 'Framing Plans' },
  { id: 'dimensioned_floor_plans', label: 'Dimensioned floor plans' },
  { id: 'roof_plans', label: 'Roof plans' },
  { id: 'building_sections', label: 'Building sections' },
  { id: 'building_elevations', label: 'At least four building elevations' },
  { id: 'hvac_layouts', label: 'Intended HVAC layouts or designs' },
  { id: 'soils_report', label: 'Soils report' }
];

const DOC_LABEL_TO_ID = (() => {
  const map = new Map();
  REQUIRED_DOC_OPTIONS.forEach((option) => {
    map.set(normalizeDocLabel(option.label), option.id);
  });
  map.set('foundation plans and details', 'foundation_plans');
  map.set('foundation plan and details', 'foundation_plans');
  map.set('at least 4 building elevations', 'building_elevations');
  map.set('intended hvac layout or designs', 'hvac_layouts');
  map.set('intended hvac layouts or design', 'hvac_layouts');
  return map;
})();

function normalizeDocLabel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function resolveDocIdFromLabel(label) {
  const normalized = normalizeDocLabel(label).replace(/^[\-\s]+/, '');
  return DOC_LABEL_TO_ID.get(normalized) || null;
}

export function buildEmptyRequiredDocs() {
  return REQUIRED_DOC_OPTIONS.reduce((acc, option) => {
    acc[option.id] = false;
    return acc;
  }, {});
}

export function parseProjectSummary(summary) {
  const text = String(summary || '').replace(/\r\n/g, '\n');
  const requiredDocs = buildEmptyRequiredDocs();
  const notesLines = [];

  let inProvidedDocs = false;
  let inMissingDocs = false;
  let inNotes = false;
  let sawDocsHeader = false;

  text.split('\n').forEach((line) => {
    const trimmed = line.trim();

    if (!inNotes && /^required docs\s*:?\s*$/i.test(trimmed)) {
      inProvidedDocs = true;
      inMissingDocs = false;
      sawDocsHeader = true;
      return;
    }

    if (!inNotes && /^provided docs\s*:?\s*$/i.test(trimmed)) {
      inProvidedDocs = true;
      inMissingDocs = false;
      sawDocsHeader = true;
      return;
    }

    if (!inNotes && /^missing docs?\s*:?\s*$/i.test(trimmed)) {
      inProvidedDocs = false;
      inMissingDocs = true;
      sawDocsHeader = true;
      return;
    }

    if (/^notes\s*:?\s*$/i.test(trimmed)) {
      inProvidedDocs = false;
      inMissingDocs = false;
      inNotes = true;
      return;
    }

    if (inProvidedDocs || inMissingDocs) {
      if (!trimmed) return;
      if (trimmed.startsWith('-')) {
        const docText = trimmed.replace(/^\-\s*/, '').trim();
        if (!docText || /^none selected$/i.test(docText) || /^none listed$/i.test(docText) || /^none$/i.test(docText)) return;
        const docId = resolveDocIdFromLabel(docText);
        if (docId) requiredDocs[docId] = inProvidedDocs;
        return;
      }
      return;
    }

    notesLines.push(line);
  });

  const notes = notesLines.join('\n').trim();
  if (!sawDocsHeader) {
    return { requiredDocs, notes: text.trim(), hasDocsSection: false };
  }
  return { requiredDocs, notes, hasDocsSection: true };
}

export function buildProjectSummary(requiredDocs, notes) {
  const providedDocs = REQUIRED_DOC_OPTIONS.filter((option) => Boolean(requiredDocs?.[option.id])).map(
    (option) => option.label
  );
  const missingDocs = REQUIRED_DOC_OPTIONS.filter((option) => !Boolean(requiredDocs?.[option.id])).map(
    (option) => option.label
  );
  const parts = [];
  if (providedDocs.length) {
    parts.push(`Provided docs:\n- ${providedDocs.join('\n- ')}`);
  } else {
    parts.push('Provided docs:\n- None listed');
  }

  if (missingDocs.length) {
    parts.push(`Missing docs:\n- ${missingDocs.join('\n- ')}`);
  } else {
    parts.push('Missing docs:\n- None');
  }

  const trimmedNotes = String(notes || '').trim();
  if (trimmedNotes) {
    parts.push(`Notes:\n${trimmedNotes}`);
  }
  return parts.join('\n\n');
}
