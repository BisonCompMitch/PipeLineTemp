import React, { useEffect, useMemo, useState } from 'react';
import { listProjects } from '../api.js';
import useSiteDialog from '../utils/useSiteDialog.jsx';
import {
  coerceSlabWorkFlag,
  formatMoneyStageGlyph,
  formatStageName,
  normalizeProjectStages
} from '../utils/stageDisplay.js';

function completionPercent(stages = []) {
  if (!Array.isArray(stages) || stages.length === 0) return 0;
  const relevant = stages.filter((stage) => stage.id !== 'completed');
  const total = relevant.length || stages.length;
  const done = relevant.filter((stage) => stage.status === 'complete').length;
  return Math.round((done / total) * 100);
}

function currentStage(stages = []) {
  if (!Array.isArray(stages) || stages.length === 0) return null;
  return stages.find((stage) => stage.status !== 'complete') || stages[stages.length - 1];
}

function stageStatusClass(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'complete') return 'complete';
  if (normalized === 'in_progress' || normalized === 'awaiting_approval') return 'in-progress';
  return 'pending';
}

export default function Customer() {
  const [project, setProject] = useState(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const { alertDialog, dialogPortal } = useSiteDialog();
  const [isTabletView, setIsTabletView] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 1100px) and (min-width: 761px)').matches;
  });

  useEffect(() => {
    let active = true;
    listProjects()
      .then((projects) => {
        if (!active) return;
        const item = Array.isArray(projects) ? projects[0] : null;
        if (!item) {
          setProject(null);
          setProgress(0);
          return;
        }
        const normalizedStages = normalizeProjectStages(item.stages || [], {
          hasSlabWork: coerceSlabWorkFlag(item?.slab_work)
        });
        setProject(item);
        setProgress(completionPercent(normalizedStages));
      })
      .catch(() => {
        if (!active) return;
        setStatus('Unable to load project progress.');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia('(max-width: 1100px) and (min-width: 761px)');
    const onChange = (event) => setIsTabletView(event.matches);
    setIsTabletView(media.matches);
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  useEffect(() => {
    if (!status) return;
    let active = true;
    (async () => {
      await alertDialog(status, { title: 'Progress error', confirmText: 'OK' });
      if (active) setStatus('');
    })();
    return () => {
      active = false;
    };
  }, [status, alertDialog]);

  const stages = useMemo(
    () =>
      normalizeProjectStages(project?.stages || [], {
        hasSlabWork: coerceSlabWorkFlag(project?.slab_work)
      }),
    [project?.stages, project?.slab_work]
  );
  const stage = currentStage(stages);
  const stageRows = useMemo(() => {
    const rowCount = isTabletView ? 3 : 2;
    const rowSize = Math.ceil(stages.length / rowCount);
    return Array.from({ length: rowCount }, (_, index) =>
      stages.slice(index * rowSize, (index + 1) * rowSize)
    ).filter((row) => row.length > 0);
  }, [stages, isTabletView]);

  return (
    <section className="panel customer-progress-panel">
      <div className="panel-header">
        <div>
          <h2>Progress</h2>
          <p className="muted">Your project progress and current phase.</p>
        </div>
      </div>
      <div className="customer-progress-card">
        <div className="customer-progress-top">
          <div className="customer-progress-title">{project?.name || 'No project linked yet'}</div>
          <div className="muted customer-current-stage-label">Your Project Is In</div>
          <p className="customer-current-stage">
            {stage ? formatStageName(stage.name, stage.id, { audience: 'external' }) : 'Waiting for project assignment.'}
          </p>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="progress-meta">
          <div className="muted">Progress</div>
          <div className="progress-pill">{`${progress}%`}</div>
        </div>
        {stages.length ? (
          <div className="customer-stage-table-wrap">
            <div className="customer-stage-table-scroll">
              <div className="customer-stage-grid">
                {stageRows.map((row, rowIndex) => {
                  const cells = row.map((item) => {
                    const fullName = formatStageName(item?.name, item?.id, { audience: 'external' });
                    const compactName = formatMoneyStageGlyph(item?.name, item?.id, { audience: 'external' });
                    const isMoneyGlyph = compactName.trim().endsWith('$');
                    return { item, fullName, compactName, isMoneyGlyph };
                  });
                  const columnTemplate = cells
                    .map((cell) => (cell.isMoneyGlyph ? 'minmax(56px, 0.42fr)' : 'minmax(130px, 1fr)'))
                    .join(' ');
                  return (
                    <div
                      key={`stage-row-${rowIndex}`}
                      className="customer-stage-row"
                      style={{ gridTemplateColumns: columnTemplate }}
                    >
                      {cells.map(({ item, fullName, compactName, isMoneyGlyph }) => (
                        <div
                          key={item.id}
                          className={`customer-stage-cell ${stageStatusClass(item.status)}${isMoneyGlyph ? ' money-glyph' : ''}`}
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
      {dialogPortal}
    </section>
  );
}
