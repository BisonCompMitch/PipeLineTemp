import React, { useEffect, useMemo, useState } from 'react';
import { createProject, listContractors, listProjects } from '../api.js';
import { REQUIRED_DOC_OPTIONS, buildEmptyRequiredDocs, buildProjectSummary } from '../utils/requiredDocs.js';

function todayLocalIso() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export default function Intake() {
  const emptyRequiredDocs = useMemo(() => buildEmptyRequiredDocs(), []);
  const [form, setForm] = useState({
    name: '',
    requester: '',
    urgency: 'standard',
    budget: '',
    summary: '',
    required_docs: emptyRequiredDocs
  });
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [partyOptions, setPartyOptions] = useState([]);

  const updateField = (key) => (event) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
  };

  const toggleRequiredDoc = (id) => (event) => {
    const checked = Boolean(event.target.checked);
    setForm((prev) => ({
      ...prev,
      required_docs: { ...(prev.required_docs || {}), [id]: checked }
    }));
  };

  useEffect(() => {
    let active = true;
    const loadPartyOptions = async () => {
      try {
        const [projectsResult, contractorsResult] = await Promise.allSettled([
          listProjects('include_deleted=true'),
          listContractors()
        ]);
        if (!active) return;
        const unique = new Map();
        (Array.isArray(projectsResult?.value) ? projectsResult.value : []).forEach((project) => {
          const value = String(project?.requester || '').trim();
          if (!value) return;
          const key = value.toLowerCase();
          if (!unique.has(key)) unique.set(key, value);
        });
        (Array.isArray(contractorsResult?.value) ? contractorsResult.value : []).forEach((contractor) => {
          const value = String(contractor?.company || '').trim();
          if (!value) return;
          const key = value.toLowerCase();
          if (!unique.has(key)) unique.set(key, value);
        });
        setPartyOptions(Array.from(unique.values()).sort((a, b) => a.localeCompare(b)));
      } catch (_err) {
        if (active) setPartyOptions([]);
      }
    };
    loadPartyOptions();
    return () => {
      active = false;
    };
  }, []);

  const requesterListId = useMemo(() => 'shared-party-options', []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const requester = form.requester.trim();
    if (!form.name.trim() || !requester) {
      setStatus('Project name and requester are required.');
      return;
    }
    setSaving(true);
    setStatus('');
    try {
      await createProject({
        name: form.name.trim(),
        requester,
        due_date: todayLocalIso(),
        urgency: form.urgency,
        budget: form.budget.trim(),
        summary: buildProjectSummary(form.required_docs, form.summary)
      });
      setPartyOptions((prev) => {
        const exists = prev.some((item) => item.toLowerCase() === requester.toLowerCase());
        if (exists) return prev;
        return [...prev, requester].sort((a, b) => a.localeCompare(b));
      });
      setStatus('Project request submitted.');
      setForm({
        name: '',
        requester: '',
        urgency: 'standard',
        budget: '',
        summary: '',
        required_docs: emptyRequiredDocs
      });
    } catch (err) {
      setStatus('Unable to submit the project intake.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Project intake</h2>
          <p className="muted">Create a new project request.</p>
        </div>
      </div>
      <form className="intake-form" onSubmit={handleSubmit}>
        <div className="intake-fields form-grid">
          <label>
            Project name
            <input value={form.name} onChange={updateField('name')} placeholder="Project name" />
          </label>
          <label>
            Requester
            <input
              value={form.requester}
              onChange={updateField('requester')}
              placeholder="Requester"
              list={requesterListId}
            />
            <datalist id={requesterListId}>
              {partyOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </label>
          <label>
            Urgency
            <select value={form.urgency} onChange={updateField('urgency')}>
              <option value="standard">Standard</option>
              <option value="rush">Rush</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label className="span-2">
            Budget
            <input value={form.budget} onChange={updateField('budget')} placeholder="Budget target" />
          </label>
          <div className="intake-docs span-2" role="group" aria-labelledby="required-docs-title">
            <div id="required-docs-title" className="intake-docs-title">
              Required docs
            </div>
            <div className="intake-docs-grid">
              {REQUIRED_DOC_OPTIONS.map((option) => (
                <label key={option.id} className="intake-doc-option">
                  <input
                    type="checkbox"
                    checked={Boolean(form.required_docs?.[option.id])}
                    onChange={toggleRequiredDoc(option.id)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>
          <label className="span-2">
            Notes
            <textarea value={form.summary} onChange={updateField('summary')} placeholder="Notes" rows={3} />
          </label>
        </div>
        <div className="intake-actions">
          <span className="muted">{status}</span>
          <button className="primary" type="submit" disabled={saving}>
            {saving ? 'Submitting...' : 'Start budget request'}
          </button>
        </div>
      </form>
    </section>
  );
}
