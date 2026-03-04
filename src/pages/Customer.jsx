import React, { useEffect, useState } from 'react';
import { listProjects } from '../api.js';

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

export default function Customer() {
  const [project, setProject] = useState(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');

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
        setProject(item);
        setProgress(completionPercent(item.stages));
      })
      .catch(() => {
        if (!active) return;
        setStatus('Unable to load project progress.');
      });
    return () => {
      active = false;
    };
  }, []);

  const stage = project ? currentStage(project.stages) : null;

  return (
    <section className="panel customer-progress-panel">
      <div className="panel-header">
        <div>
          <h2>Progress</h2>
          <p className="muted">Your project progress and current phase.</p>
        </div>
      </div>
      {status ? <div className="alert">{status}</div> : null}
      <div className="customer-progress-card">
        <div>
          <div className="customer-progress-title">{project?.name || 'No project linked yet'}</div>
          <p className="muted customer-progress-sub">
            {stage?.name ? `Current area: ${stage.name}` : 'Waiting for project assignment.'}
          </p>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="progress-meta">
          <div className="muted">Progress</div>
          <div className="progress-pill">{`${progress}%`}</div>
        </div>
      </div>
    </section>
  );
}
