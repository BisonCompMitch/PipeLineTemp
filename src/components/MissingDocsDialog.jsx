import React, { useEffect, useMemo, useState } from 'react';
import ModalPortal from './ModalPortal.jsx';
import { REQUIRED_DOC_OPTIONS, parseProjectSummary } from '../utils/requiredDocs.js';

function buildProjectLabel(projectName = '', projectNumber = '') {
  const name = String(projectName || '').trim() || 'Project';
  const number = String(projectNumber || '').trim();
  return number ? `${name} - ${number}` : name;
}

export default function MissingDocsDialog({
  open = false,
  projectName = '',
  projectNumber = '',
  projectSummary = '',
  beforeStageName = '',
  saving = false,
  onCancel,
  onConfirm
}) {
  const parsedSummary = useMemo(() => parseProjectSummary(projectSummary), [projectSummary]);
  const defaultSelectedIds = useMemo(
    () =>
      REQUIRED_DOC_OPTIONS.filter((option) => !Boolean(parsedSummary.requiredDocs?.[option.id])).map(
        (option) => option.id
      ),
    [parsedSummary]
  );
  const [selectedIds, setSelectedIds] = useState(defaultSelectedIds);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!open) return;
    setSelectedIds(defaultSelectedIds);
    setStatus('');
  }, [open, defaultSelectedIds]);

  const toggleDoc = (docId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return Array.from(next);
    });
  };

  const handleConfirm = () => {
    if (!selectedIds.length) {
      setStatus('Select at least one missing document.');
      return;
    }
    setStatus('');
    if (typeof onConfirm === 'function') {
      onConfirm(selectedIds);
    }
  };

  if (!open) return null;

  const projectLabel = buildProjectLabel(projectName, projectNumber);

  return (
    <ModalPortal>
      <div className="modal-backdrop preview-backdrop" onClick={() => (saving ? null : onCancel?.())}>
        <div className="modal notify-modal missing-docs-modal" onClick={(event) => event.stopPropagation()}>
          <div className="modal-header">
            <div className="modal-title">Missing Documents Confirmation</div>
            <button className="ghost" type="button" onClick={onCancel} disabled={saving}>
              Close
            </button>
          </div>
          <div className="notify-body">
            <div className="notify-fields">
              <label className="span-2">
                Project
                <div className="field-static">{projectLabel}</div>
              </label>
              <label className="span-2">
                Action
                <div className="field-static">
                  Move to Invoice Needed{beforeStageName ? ` before ${beforeStageName}` : ''}
                </div>
              </label>
            </div>
            <div className="notify-users">
              <div className="notify-users-title">Select missing documents</div>
              <div className="notify-users-list">
                {REQUIRED_DOC_OPTIONS.map((option) => (
                  <label key={option.id} className="notify-user">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(option.id)}
                      onChange={() => toggleDoc(option.id)}
                      disabled={saving}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </div>
            {status ? <p className="site-dialog-message">{status}</p> : null}
            <div className="actions">
              <button className="ghost" type="button" onClick={onCancel} disabled={saving}>
                Cancel
              </button>
              <button className="primary" type="button" onClick={handleConfirm} disabled={saving || !selectedIds.length}>
                {saving ? 'Saving...' : 'Move to Invoice Needed'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
