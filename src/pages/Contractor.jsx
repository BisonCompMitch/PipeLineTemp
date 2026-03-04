import React, { useEffect, useState } from 'react';
import { listProjects } from '../api.js';

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

function currentStage(stages = []) {
  if (!Array.isArray(stages) || stages.length === 0) return null;
  return stages.find((stage) => stage.status !== 'complete') || stages[stages.length - 1];
}

function stageNoticeTone(stage) {
  if (!stage) return 'neutral';
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

export default function Contractor() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    listProjects()
      .then((projects) => {
        if (!active) return;
        const mapped = (projects || []).map((project) => {
          const stage = currentStage(project.stages);
          return {
            id: project.id,
            projectNumber: project.project_number || '',
            name: project.name || 'Unnamed project',
            area: stage?.name || 'Pending',
            progress: completionPercent(project.stages),
            statusTone: stageNoticeTone(stage)
          };
        });
        setRows(mapped);
        setError('');
      })
      .catch(() => {
        if (!active) return;
        setRows([]);
        setError('Unable to load contractor dashboard.');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Dashboard</h2>
          <p className="muted">Project progress across the pipeline.</p>
        </div>
      </div>
      {loading ? <p className="muted">Loading projects...</p> : null}
      {error ? <div className="alert">{error}</div> : null}
      <div className="table-scroll">
        <table className="project-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Project</th>
              <th>Current Area</th>
              <th>% Complete</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => {
                const tone = row.statusTone || 'neutral';
                const statusLabel = TONE_LABELS[tone] || 'On Time';
                const statusColor = TONE_COLORS[tone] || TONE_COLORS.neutral;
                return (
                  <tr key={row.id}>
                    <td>{row.projectNumber || '-'}</td>
                    <td>{row.name}</td>
                    <td>{row.area}</td>
                    <td>{`${row.progress || 0}%`}</td>
                    <td>
                      <span className="status-pill" style={{ backgroundColor: statusColor, color: '#111827' }}>
                        {statusLabel}
                      </span>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr className="empty-row">
                <td colSpan={5}>No projects available.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
