import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  createUser,
  createContractor,
  createCustomer,
  deleteContractor,
  deleteCustomer,
  deleteUser,
  forceLogoutUser,
  listContractors,
  listCustomers,
  listProjects,
  listUserActivity,
  listUsers,
  resetUserPasswords,
  updateContractor,
  updateCustomer,
  updateUser
} from '../api.js';
import PasswordToggleButton from '../components/PasswordToggleButton.jsx';
import useSiteDialog from '../utils/useSiteDialog.jsx';
import { formatStageName, STAGE_FLOW } from '../utils/stageDisplay.js';

const AREA_OPTIONS = [...STAGE_FLOW.map((stage) => formatStageName(stage.name, stage.id)), 'Management', 'Admin'];
const CREATE_USER_TYPES = [
  {
    value: 'bison',
    label: 'Bison',
    description: 'Internal team account with roles and areas.'
  },
  {
    value: 'contractor',
    label: 'Contractor',
    description: 'External contractor login tied to a company.'
  },
  {
    value: 'customer',
    label: 'Customer',
    description: 'Project account linked to selected projects.'
  },
  {
    value: 'builder',
    label: 'Builder',
    description: 'Builder access limited to assigned project models.'
  }
];

const EMPTY_BISON_FORM = {
  email: '',
  rolesText: '',
  areas: []
};
const EMPTY_CONTRACTOR_FORM = { company: '', full_name: '', email: '' };
const EMPTY_CUSTOMER_FORM = { email: '', role: 'Customer', project_ids: [] };

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function activityKey(value) {
  return normalize(value);
}

function formatLastLogin(value) {
  if (!value) {
    return { text: '-', title: '' };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { text: '-', title: '' };
  }
  return {
    text: date.toLocaleDateString(),
    title: date.toLocaleString()
  };
}

function splitRoles(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasRole(user, token) {
  return (user?.roles || []).some((role) => normalize(role).includes(token));
}

function isBisonUser(user) {
  const hasAreas = Array.isArray(user?.areas) && user.areas.length > 0;
  const bisonRole =
    hasRole(user, 'bison') ||
    hasRole(user, 'admin') ||
    hasRole(user, 'manager') ||
    hasRole(user, 'management');
  return hasAreas || bisonRole;
}

function isContractorOnly(user) {
  return hasRole(user, 'contractor') && !isBisonUser(user) && !hasRole(user, 'customer') && !hasRole(user, 'builder');
}

function isCustomerOnly(user) {
  return hasRole(user, 'customer') && !isBisonUser(user) && !hasRole(user, 'contractor') && !hasRole(user, 'builder');
}

function isBuilderOnly(user) {
  return hasRole(user, 'builder') && !isBisonUser(user) && !hasRole(user, 'customer') && !hasRole(user, 'contractor');
}

function projectLabel(project) {
  const projectNumber = String(project?.project_number || '').trim();
  const projectName = String(project?.name || '').trim();
  if (projectNumber && projectName) {
    return `${projectNumber} - ${projectName}`;
  }
  return projectName || projectNumber || project?.id || 'Unnamed project';
}

function isProjectComplete(project) {
  const stages = Array.isArray(project?.stages) ? project.stages : [];
  return stages.length > 0 && stages.every((stage) => normalize(stage?.status) === 'complete');
}

function projectStatusKey(project) {
  if (project?.is_deleted) return 'archived';
  if (isProjectComplete(project)) return 'complete';
  return 'active';
}

function projectStatusLabel(project) {
  const status = projectStatusKey(project);
  if (status === 'archived') return 'Archived';
  if (status === 'complete') return 'Complete';
  return '';
}

function projectOptionLabel(project) {
  const label = projectLabel(project);
  const status = projectStatusLabel(project);
  return status ? `${label} (${status})` : label;
}

function sortProjects(a, b) {
  const aNumber = String(a?.project_number || '').trim();
  const bNumber = String(b?.project_number || '').trim();
  if (aNumber && bNumber) {
    const aParsed = Number.parseInt(aNumber, 10);
    const bParsed = Number.parseInt(bNumber, 10);
    if (!Number.isNaN(aParsed) && !Number.isNaN(bParsed) && aParsed !== bParsed) {
      return aParsed - bParsed;
    }
    if (aNumber !== bNumber) {
      return aNumber.localeCompare(bNumber);
    }
  } else if (aNumber && !bNumber) {
    return -1;
  } else if (!aNumber && bNumber) {
    return 1;
  }
  return projectLabel(a).localeCompare(projectLabel(b));
}

function normalizeProjectIds(value) {
  const raw = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const ids = [];
  raw.forEach((item) => {
    const projectId = String(item || '').trim();
    if (!projectId || seen.has(projectId)) return;
    seen.add(projectId);
    ids.push(projectId);
  });
  return ids;
}

function projectIdsForCustomer(customer) {
  const ids = normalizeProjectIds(customer?.project_ids || []);
  if (ids.length) return ids;
  return normalizeProjectIds(customer?.project_id || []);
}

function summarizeProjectSelection(projectIds, projectMap) {
  const labels = normalizeProjectIds(projectIds)
    .map((projectId) => projectMap.get(projectId) || projectId)
    .filter(Boolean);
  if (!labels.length) {
    return { text: 'No projects selected', title: '' };
  }
  if (labels.length === 1) {
    return { text: labels[0], title: labels[0] };
  }
  if (labels.length === 2) {
    const title = labels.join(', ');
    return { text: title, title };
  }
  const title = labels.join(', ');
  return { text: `${labels[0]} +${labels.length - 1} more`, title };
}

const PROJECT_STATUS_FILTERS = [
  { key: 'active', label: 'Active' },
  { key: 'complete', label: 'Complete' },
  { key: 'archived', label: 'Archived' }
];

const DEFAULT_PROJECT_STATUS_FILTERS = {
  active: true,
  complete: true,
  archived: true
};

function ProjectMultiSelect({ projects, selectedIds, onChange, placeholder = 'No projects selected' }) {
  const [open, setOpen] = useState(false);
  const [statusFilters, setStatusFilters] = useState(DEFAULT_PROJECT_STATUS_FILTERS);
  const controlRef = useRef(null);
  const listRef = useRef(null);
  const projectList = Array.isArray(projects) ? projects : [];
  const currentIds = useMemo(() => normalizeProjectIds(selectedIds), [selectedIds]);
  const selectedSet = useMemo(() => new Set(currentIds), [currentIds]);
  const statusCounts = useMemo(
    () =>
      projectList.reduce(
        (counts, project) => {
          const key = projectStatusKey(project);
          counts[key] = (counts[key] || 0) + 1;
          return counts;
        },
        { active: 0, complete: 0, archived: 0 }
      ),
    [projectList]
  );
  const visibleProjects = useMemo(
    () => projectList.filter((project) => statusFilters[projectStatusKey(project)]),
    [projectList, statusFilters]
  );
  const selectedLabels = useMemo(
    () =>
      currentIds
        .map((projectId) => projectList.find((project) => project.id === projectId))
        .filter(Boolean)
        .map((project) => projectOptionLabel(project)),
    [currentIds, projectList]
  );
  const summary = useMemo(() => {
    if (!selectedLabels.length) {
      return { text: placeholder, title: '' };
    }
    if (selectedLabels.length === 1) {
      return { text: selectedLabels[0], title: selectedLabels[0] };
    }
    if (selectedLabels.length === 2) {
      const title = selectedLabels.join(', ');
      return { text: title, title };
    }
    const title = selectedLabels.join(', ');
    return { text: `${selectedLabels[0]} +${selectedLabels.length - 1} more`, title };
  }, [placeholder, selectedLabels]);

  useEffect(() => {
    if (!open) return undefined;
    const handleClick = (event) => {
      if (controlRef.current && !controlRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const restoreScrollAfterRender = () => {
    const listScrollTop = listRef.current?.scrollTop ?? 0;
    const modal = controlRef.current?.closest('.modal');
    const modalScrollTop = modal?.scrollTop ?? 0;
    const windowScrollX = window.scrollX;
    const windowScrollY = window.scrollY;
    return () => {
      window.requestAnimationFrame(() => {
        if (listRef.current) {
          listRef.current.scrollTop = listScrollTop;
        }
        if (modal) {
          modal.scrollTop = modalScrollTop;
        }
        window.scrollTo(windowScrollX, windowScrollY);
      });
    };
  };

  const toggleStatusFilter = (filterKey) => {
    const restoreScroll = restoreScrollAfterRender();
    setStatusFilters((current) => {
      const next = { ...current, [filterKey]: !current[filterKey] };
      return PROJECT_STATUS_FILTERS.some((filter) => next[filter.key])
        ? next
        : DEFAULT_PROJECT_STATUS_FILTERS;
    });
    restoreScroll();
  };

  const toggleProject = (projectId) => {
    const restoreScroll = restoreScrollAfterRender();
    const nextSet = new Set(currentIds);
    if (nextSet.has(projectId)) {
      nextSet.delete(projectId);
    } else {
      nextSet.add(projectId);
    }
    const nextIds = projectList
      .map((project) => project.id)
      .filter((projectId) => nextSet.has(projectId));
    onChange(nextIds);
    restoreScroll();
  };

  return (
    <div className="project-multi-select" ref={controlRef}>
      <button
        className="ghost project-multi-select-trigger"
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={summary.title || undefined}
      >
        <span className={`project-multi-select-summary${selectedLabels.length ? '' : ' muted'}`}>
          {summary.text}
        </span>
        <svg className="caret" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 7l5 6 5-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      {open ? (
        <div className="project-multi-select-panel">
          <div className="project-multi-select-panel-title">
            Select one or more projects ({visibleProjects.length} of {projectList.length})
          </div>
          <div className="project-status-filter-row" role="group" aria-label="Project status filters">
            {PROJECT_STATUS_FILTERS.map((filter) => (
              <button
                key={filter.key}
                className={`project-status-filter${statusFilters[filter.key] ? ' selected' : ''}`}
                type="button"
                aria-pressed={statusFilters[filter.key]}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => toggleStatusFilter(filter.key)}
              >
                {filter.label}
                <span>{statusCounts[filter.key] || 0}</span>
              </button>
            ))}
          </div>
          <div className="area-check-grid project-check-grid" ref={listRef}>
            {visibleProjects.length ? (
              visibleProjects.map((project) => {
                const selected = selectedSet.has(project.id);
                return (
                  <button
                    key={project.id}
                    className={`area-check project-check${selected ? ' selected' : ''}`}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    title={projectOptionLabel(project)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => toggleProject(project.id)}
                  >
                    <span className="project-check-box" aria-hidden="true" />
                    <span className="project-check-label">{projectOptionLabel(project)}</span>
                  </button>
                );
              })
            ) : (
              <div className="muted project-multi-select-empty">No projects match the selected filters.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function Users() {
  const [allUsers, setAllUsers] = useState([]);
  const [bisonUsers, setBisonUsers] = useState([]);
  const [contractors, setContractors] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [activityMap, setActivityMap] = useState(() => new Map());
  const [bisonStatus, setBisonStatus] = useState(null);
  const [contractorStatus, setContractorStatus] = useState(null);
  const [customerStatus, setCustomerStatus] = useState(null);
  const [editStatus, setEditStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createUserType, setCreateUserType] = useState('');
  const [bulkResetLoading, setBulkResetLoading] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState({
    bison: false,
    contractor: false,
    customer: false
  });
  const { confirmDialog, alertDialog, dialogPortal } = useSiteDialog();
  const [createBisonForm, setCreateBisonForm] = useState(() => ({ ...EMPTY_BISON_FORM, areas: [] }));
  const [createContractorForm, setCreateContractorForm] = useState(() => ({ ...EMPTY_CONTRACTOR_FORM }));
  const [createCustomerForm, setCreateCustomerForm] = useState(() => ({ ...EMPTY_CUSTOMER_FORM, project_ids: [] }));

  const loadAll = async ({ preserveStatus = false } = {}) => {
    setLoading(true);
    if (!preserveStatus) {
      setBisonStatus(null);
      setContractorStatus(null);
      setCustomerStatus(null);
    }
    try {
      const [usersResult, contractorsResult, customersResult, projectsResult] = await Promise.allSettled([
        listUsers(),
        listContractors(),
        listCustomers(),
        listProjects('include_deleted=true')
      ]);

      if (usersResult.status === 'fulfilled') {
        const all = Array.isArray(usersResult.value) ? usersResult.value : [];
        setAllUsers(all);
        const filtered = all.filter(
          (user) => !isCustomerOnly(user) && !isBuilderOnly(user) && !isContractorOnly(user)
        );
        setBisonUsers(filtered);
      } else {
        setAllUsers([]);
        setBisonUsers([]);
        setBisonStatus({ tone: 'error', text: 'Unable to load Bison users.' });
      }

      if (contractorsResult.status === 'fulfilled') {
        setContractors(Array.isArray(contractorsResult.value) ? contractorsResult.value : []);
      } else {
        setContractors([]);
        setContractorStatus({ tone: 'error', text: 'Unable to load contractors.' });
      }

      if (customersResult.status === 'fulfilled') {
        setCustomers(Array.isArray(customersResult.value) ? customersResult.value : []);
      } else {
        setCustomers([]);
        setCustomerStatus({ tone: 'error', text: 'Unable to load customers.' });
      }

      if (projectsResult.status === 'fulfilled') {
        setProjects(Array.isArray(projectsResult.value) ? projectsResult.value : []);
      } else {
        setProjects([]);
        setCustomerStatus((prev) => ({
          tone: 'error',
          text: prev?.text || 'Unable to load projects for customers.'
        }));
      }
      await loadActivity({ setError: true });
    } catch (err) {
      setBisonStatus({ tone: 'error', text: 'Unable to load Bison users.' });
      setContractorStatus({ tone: 'error', text: 'Unable to load contractors.' });
      setCustomerStatus({ tone: 'error', text: 'Unable to load customers.' });
    } finally {
      setLoading(false);
    }
  };

  const loadActivity = async ({ setError = false } = {}) => {
    try {
      const activity = await listUserActivity();
      const map = new Map();
      (Array.isArray(activity) ? activity : []).forEach((entry) => {
        if (entry?.username) {
          map.set(activityKey(entry.username), entry);
        }
        if (entry?.email) {
          map.set(activityKey(entry.email), entry);
        }
      });
      setActivityMap(map);
    } catch (_err) {
      setActivityMap(new Map());
      if (setError) {
        setBisonStatus((prev) => prev || { tone: 'error', text: 'Unable to load user activity.' });
      }
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (!active) return;
      loadActivity({ setError: false });
    };
    refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!bisonStatus?.text) return;
    let active = true;
    (async () => {
      await alertDialog(bisonStatus.text, {
        title: bisonStatus.tone === 'error' ? 'Bison users error' : 'Bison users',
        confirmText: 'OK'
      });
      if (active) setBisonStatus(null);
    })();
    return () => {
      active = false;
    };
  }, [bisonStatus, alertDialog]);

  useEffect(() => {
    if (!contractorStatus?.text) return;
    let active = true;
    (async () => {
      await alertDialog(contractorStatus.text, {
        title: contractorStatus.tone === 'error' ? 'Contractors error' : 'Contractors',
        confirmText: 'OK'
      });
      if (active) setContractorStatus(null);
    })();
    return () => {
      active = false;
    };
  }, [contractorStatus, alertDialog]);

  useEffect(() => {
    if (!customerStatus?.text) return;
    let active = true;
    (async () => {
      await alertDialog(customerStatus.text, {
        title: customerStatus.tone === 'error' ? 'Customers error' : 'Customers',
        confirmText: 'OK'
      });
      if (active) setCustomerStatus(null);
    })();
    return () => {
      active = false;
    };
  }, [customerStatus, alertDialog]);

  useEffect(() => {
    if (!editStatus?.text) return;
    let active = true;
    (async () => {
      await alertDialog(editStatus.text, {
        title: editStatus.tone === 'error' ? 'Update error' : 'Update saved',
        confirmText: 'OK'
      });
      if (active) setEditStatus(null);
    })();
    return () => {
      active = false;
    };
  }, [editStatus, alertDialog]);

  const projectMap = useMemo(() => {
    const map = new Map();
    projects.forEach((project) => {
      map.set(project.id, projectOptionLabel(project));
    });
    return map;
  }, [projects]);

  const projectOptions = useMemo(() => [...projects].sort(sortProjects), [projects]);

  const sortedBison = useMemo(
    () =>
      [...bisonUsers].sort((a, b) =>
        normalize(a.login_username || a.username).localeCompare(normalize(b.login_username || b.username))
      ),
    [bisonUsers]
  );
  const assignedBisonUsers = useMemo(
    () =>
      sortedBison.filter((user) =>
        Array.isArray(user?.areas) && user.areas.some((area) => String(area || '').trim())
      ),
    [sortedBison]
  );
  const sortedContractors = useMemo(
    () => [...contractors].sort((a, b) => normalize(a.email).localeCompare(normalize(b.email))),
    [contractors]
  );
  const sortedCustomers = useMemo(
    () => [...customers].sort((a, b) => normalize(a.email).localeCompare(normalize(b.email))),
    [customers]
  );
  const sharedPartyOptions = useMemo(() => {
    const unique = new Map();
    projects.forEach((project) => {
      const value = String(project?.requester || '').trim();
      if (!value) return;
      const key = value.toLowerCase();
      if (!unique.has(key)) unique.set(key, value);
    });
    contractors.forEach((contractor) => {
      const value = String(contractor?.company || '').trim();
      if (!value) return;
      const key = value.toLowerCase();
      if (!unique.has(key)) unique.set(key, value);
    });
    return Array.from(unique.values()).sort((a, b) => a.localeCompare(b));
  }, [projects, contractors]);

  const linkedUsersByIdentity = useMemo(() => {
    const map = new Map();
    allUsers.forEach((user) => {
      const usernameKey = normalize(user?.username);
      const emailKey = normalize(user?.email);
      if (usernameKey && !map.has(usernameKey)) map.set(usernameKey, user);
      if (emailKey && !map.has(emailKey)) map.set(emailKey, user);
    });
    return map;
  }, [allUsers]);

  const startEditBison = (user) => {
    setEditStatus(null);
    setPasswordVisible({ bison: false, contractor: false, customer: false });
    setEditing({
      type: 'bison',
      form: {
        username: user.username,
        login_username: user.login_username || user.username || '',
        full_name: user.full_name || '',
        email: user.email || '',
        rolesText: (user.roles || []).join(', '),
        password: '',
        must_reset_password: Boolean(user.must_reset_password),
        is_locked: Boolean(user.is_locked),
        areas: Array.isArray(user.areas) ? user.areas : []
      }
    });
  };

  const startEditContractor = (contractor) => {
    setEditStatus(null);
    setPasswordVisible({ bison: false, contractor: false, customer: false });
    const linkedUser =
      linkedUsersByIdentity.get(normalize(contractor?.email)) ||
      linkedUsersByIdentity.get(normalize(contractor?.username));
    setEditing({
      type: 'contractor',
      form: {
        username: linkedUser?.username || contractor.email,
        email: contractor.email,
        company: contractor.company || '',
        password: '',
        is_locked: Boolean(linkedUser?.is_locked)
      }
    });
  };

  const startEditCustomer = (customer) => {
    setEditStatus(null);
    setPasswordVisible({ bison: false, contractor: false, customer: false });
    const linkedUser =
      linkedUsersByIdentity.get(normalize(customer?.email)) ||
      linkedUsersByIdentity.get(normalize(customer?.username));
    setEditing({
      type: 'customer',
      form: {
        username: linkedUser?.username || customer.email,
        email: customer.email,
        role: customer.role || 'Customer',
        password: '',
        project_ids: projectIdsForCustomer(customer),
        is_locked: Boolean(linkedUser?.is_locked)
      }
    });
  };

  const closeEdit = () => {
    setEditing(null);
    setEditStatus(null);
    setPasswordVisible({ bison: false, contractor: false, customer: false });
  };

  const resetCreateForms = () => {
    setCreateBisonForm({ ...EMPTY_BISON_FORM, areas: [] });
    setCreateContractorForm({ ...EMPTY_CONTRACTOR_FORM });
    setCreateCustomerForm({ ...EMPTY_CUSTOMER_FORM, project_ids: [] });
  };

  const openCreateModal = () => {
    resetCreateForms();
    setCreateUserType('');
    setCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    setCreateModalOpen(false);
    setCreateUserType('');
    resetCreateForms();
  };

  const handleCreateUserTypeSelect = (type) => {
    setCreateUserType(type);
    if (type === 'customer' || type === 'builder') {
      setCreateCustomerForm((prev) => ({
        ...prev,
        role: type === 'builder' ? 'Builder' : 'Customer'
      }));
    }
  };

  const handleToggleArea = (area) => {
    setEditing((prev) => {
      if (!prev || prev.type !== 'bison') return prev;
      const current = new Set(prev.form.areas || []);
      if (current.has(area)) {
        current.delete(area);
      } else {
        current.add(area);
      }
      return { ...prev, form: { ...prev.form, areas: Array.from(current) } };
    });
  };

  const handleSaveBison = async () => {
    if (!editing || editing.type !== 'bison') return;
    const form = editing.form;
    const nextLoginUsername = String(form.login_username || '').trim();
    if (!form.email.trim() || !form.full_name.trim()) {
      setEditStatus({ tone: 'error', text: 'Full name and email are required.' });
      return;
    }
    if (!nextLoginUsername) {
      setEditStatus({ tone: 'error', text: 'Username is required.' });
      return;
    }
    if (/\s/.test(nextLoginUsername)) {
      setEditStatus({ tone: 'error', text: 'Username cannot contain spaces.' });
      return;
    }
    const payload = {
      login_username: nextLoginUsername,
      email: form.email.trim(),
      full_name: form.full_name.trim(),
      roles: splitRoles(form.rolesText),
      areas: form.areas || [],
      must_reset_password: Boolean(form.must_reset_password),
      is_locked: Boolean(form.is_locked)
    };
    if (form.password.trim()) {
      payload.password = form.password.trim();
    }
    try {
      await updateUser(form.username, payload);
      setBisonStatus({ tone: 'success', text: 'User updated.' });
      closeEdit();
      loadAll({ preserveStatus: true });
    } catch (err) {
      setEditStatus({ tone: 'error', text: 'Unable to update user.' });
    }
  };

  const handleSaveContractor = async () => {
    if (!editing || editing.type !== 'contractor') return;
    const form = editing.form;
    if (!form.company.trim()) {
      setEditStatus({ tone: 'error', text: 'Contractor company is required.' });
      return;
    }
    const payload = { company: form.company.trim() };
    if (form.password.trim()) {
      payload.password = form.password.trim();
    }
    try {
      await updateContractor(form.email, payload);
      if (form.username) {
        await updateUser(form.username, { is_locked: Boolean(form.is_locked) });
      }
      setContractorStatus({ tone: 'success', text: 'Contractor updated.' });
      closeEdit();
      loadAll({ preserveStatus: true });
    } catch (err) {
      setEditStatus({ tone: 'error', text: 'Unable to update contractor.' });
    }
  };

  const handleSaveCustomer = async () => {
    if (!editing || editing.type !== 'customer') return;
    const form = editing.form;
    const projectIds = normalizeProjectIds(form.project_ids);
    if (!projectIds.length) {
      setEditStatus({ tone: 'error', text: 'Customer must stay linked to at least one project.' });
      return;
    }
    const payload = {
      role: form.role || 'Customer',
      project_id: projectIds[0],
      project_ids: projectIds
    };
    if (form.password.trim()) {
      payload.password = form.password.trim();
    }
    try {
      await updateCustomer(form.email, payload);
      if (form.username) {
        await updateUser(form.username, { is_locked: Boolean(form.is_locked) });
      }
      setCustomerStatus({ tone: 'success', text: 'Customer updated.' });
      closeEdit();
      loadAll({ preserveStatus: true });
    } catch (err) {
      setEditStatus({ tone: 'error', text: 'Unable to update customer.' });
    }
  };

  const handleForceLogout = async (...usernameOrEmailCandidates) => {
    const candidates = Array.from(
      new Set(
        usernameOrEmailCandidates
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      )
    );
    const target = candidates[0] || '';
    if (!target || !candidates.length) {
      setEditStatus({ tone: 'error', text: 'Unable to determine which account to sign out.' });
      return;
    }
    const shouldForce = await confirmDialog(`Force sign out for ${target}?`, {
      title: 'Force sign out',
      confirmText: 'Force sign out'
    });
    if (!shouldForce) return;
    try {
      let success = false;
      let lastError = null;
      for (const candidate of candidates) {
        try {
          await forceLogoutUser(candidate);
          success = true;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!success) {
        throw lastError || new Error('Unable to force sign out.');
      }
      setEditStatus({ tone: 'success', text: 'User was signed out from active sessions.' });
      await loadAll({ preserveStatus: true });
    } catch (err) {
      setEditStatus({ tone: 'error', text: err?.message || 'Unable to force sign out.' });
    }
  };

  const handleResetAssignedPasswords = async () => {
    if (bulkResetLoading || !assignedBisonUsers.length) return;
    const targetUsernames = assignedBisonUsers.map((user) => String(user?.username || '').trim()).filter(Boolean);
    if (!targetUsernames.length) {
      await alertDialog('No assigned Bison users were found.', {
        title: 'Action unavailable',
        confirmText: 'OK'
      });
      return;
    }
    const shouldReset = await confirmDialog(
      `Send temporary password emails to ${targetUsernames.length} assigned Bison user${
        targetUsernames.length === 1 ? '' : 's'
      }? They will be required to reset their password on next sign in.`,
      {
        title: 'Reset passwords',
        confirmText: 'Send resets'
      }
    );
    if (!shouldReset) return;

    setBulkResetLoading(true);
    try {
      const result = await resetUserPasswords({ usernames: targetUsernames });
      const sent = Array.isArray(result?.sent) ? result.sent : [];
      const failed = Array.isArray(result?.failed) ? result.failed : [];
      const sentSet = new Set(sent.map((value) => normalize(value)));
      if (sentSet.size) {
        setAllUsers((prev) =>
          prev.map((user) => (sentSet.has(normalize(user.username)) ? { ...user, must_reset_password: true } : user))
        );
        setBisonUsers((prev) =>
          prev.map((user) => (sentSet.has(normalize(user.username)) ? { ...user, must_reset_password: true } : user))
        );
        setEditing((prev) =>
          prev && prev.type === 'bison' && sentSet.has(normalize(prev.form?.username))
            ? { ...prev, form: { ...prev.form, must_reset_password: true } }
            : prev
        );
      }
      const messageParts = [];
      if (sent.length) {
        messageParts.push(
          `Password reset emails sent to ${sent.length} assigned Bison user${sent.length === 1 ? '' : 's'}.`
        );
      }
      if (failed.length) {
        const preview = failed.slice(0, 5).join(', ');
        messageParts.push(
          `Could not reset ${failed.length} user${failed.length === 1 ? '' : 's'}${preview ? `: ${preview}` : ''}.`
        );
      }
      if (!messageParts.length) {
        messageParts.push('No password resets were sent.');
      }
      await alertDialog(messageParts.join(' '), {
        title: failed.length ? 'Reset partially completed' : 'Passwords reset',
        confirmText: 'OK'
      });
    } catch (err) {
      await alertDialog(err?.message || 'Unable to reset passwords.', {
        title: 'Reset failed',
        confirmText: 'OK'
      });
    } finally {
      setBulkResetLoading(false);
    }
  };

  const handleCreateContractor = async (event) => {
    event.preventDefault();
    if (!createContractorForm.email.trim()) {
      setContractorStatus({ tone: 'error', text: 'Contractor email is required.' });
      return;
    }
    if (!createContractorForm.company.trim()) {
      setContractorStatus({ tone: 'error', text: 'Contractor company is required.' });
      return;
    }
    try {
      await createContractor({
        company: createContractorForm.company.trim(),
        full_name: createContractorForm.full_name.trim() || null,
        email: createContractorForm.email.trim()
      });
      setCreateContractorForm({ company: '', full_name: '', email: '' });
      setContractorStatus({
        tone: 'success',
        text: 'Contractor created. Temporary password email sent when SMTP is configured.'
      });
      setCreateModalOpen(false);
      setCreateUserType('');
      loadAll({ preserveStatus: true });
    } catch (err) {
      setContractorStatus({ tone: 'error', text: 'Unable to create contractor.' });
    }
  };

  const handleCreateBison = async (event) => {
    event.preventDefault();
    if (!createBisonForm.email.trim()) {
      setBisonStatus({ tone: 'error', text: 'Email is required for Bison users.' });
      return;
    }
    try {
      await createUser({
        email: createBisonForm.email.trim(),
        roles: splitRoles(createBisonForm.rolesText),
        areas: createBisonForm.areas || [],
        must_reset_password: true
      });
      setCreateBisonForm({
        email: '',
        rolesText: '',
        areas: []
      });
      setBisonStatus({
        tone: 'success',
        text: 'Bison user created. Temporary password email sent when SMTP is configured.'
      });
      setCreateModalOpen(false);
      setCreateUserType('');
      loadAll({ preserveStatus: true });
    } catch (_err) {
      setBisonStatus({ tone: 'error', text: 'Unable to create Bison user.' });
    }
  };

  const handleCreateBisonAreaToggle = (area) => {
    setCreateBisonForm((prev) => {
      const current = new Set(prev.areas || []);
      if (current.has(area)) {
        current.delete(area);
      } else {
        current.add(area);
      }
      return { ...prev, areas: Array.from(current) };
    });
  };

  const handleCreateCustomer = async (event) => {
    event.preventDefault();
    if (!createCustomerForm.email.trim()) {
      setCustomerStatus({ tone: 'error', text: 'Customer email is required.' });
      return;
    }
    const projectIds = normalizeProjectIds(createCustomerForm.project_ids);
    if (!projectIds.length) {
      setCustomerStatus({ tone: 'error', text: 'Select at least one project for the customer.' });
      return;
    }
    const selectedRole = createUserType === 'builder' ? 'Builder' : createCustomerForm.role || 'Customer';
    try {
      await createCustomer({
        email: createCustomerForm.email.trim(),
        role: selectedRole,
        project_id: projectIds[0],
        project_ids: projectIds
      });
      setCreateCustomerForm({ email: '', role: 'Customer', project_ids: [] });
      setCustomerStatus({
        tone: 'success',
        text: `${selectedRole === 'Builder' ? 'Builder' : 'Customer'} created. Temporary password email sent when SMTP is configured.`
      });
      setCreateModalOpen(false);
      setCreateUserType('');
      loadAll({ preserveStatus: true });
    } catch (err) {
      setCustomerStatus({ tone: 'error', text: 'Unable to create customer.' });
    }
  };

  const handleCreateSubmit = (event) => {
    if (createUserType === 'bison') {
      handleCreateBison(event);
      return;
    }
    if (createUserType === 'contractor') {
      handleCreateContractor(event);
      return;
    }
    if (createUserType === 'customer' || createUserType === 'builder') {
      handleCreateCustomer(event);
      return;
    }
    event.preventDefault();
  };

  const selectedCreateType = CREATE_USER_TYPES.find((option) => option.value === createUserType);
  const createSubmitLabel =
    createUserType === 'bison'
      ? 'Create Bison user'
      : createUserType === 'contractor'
        ? 'Create contractor'
        : createUserType === 'builder'
          ? 'Create builder'
          : 'Create customer';

  const handleDeleteBison = async (user) => {
    if (!user?.username) return;
    const shouldDelete = await confirmDialog(`Delete ${user.username}? This cannot be undone.`, {
      title: 'Delete user',
      confirmText: 'Delete'
    });
    if (!shouldDelete) return;
    try {
      await deleteUser(user.username);
      if (editing?.type === 'bison' && editing?.form?.username === user.username) {
        closeEdit();
      }
      loadAll({ preserveStatus: true });
    } catch (_err) {
      setBisonStatus({ tone: 'error', text: 'Unable to delete user.' });
    }
  };

  const handleDeleteContractor = async (contractor) => {
    if (!contractor?.email) return;
    const shouldDelete = await confirmDialog(
      `Delete contractor ${contractor.email}? This cannot be undone.`,
      { title: 'Delete contractor', confirmText: 'Delete' }
    );
    if (!shouldDelete) return;
    try {
      await deleteContractor(contractor.email);
      if (editing?.type === 'contractor' && editing?.form?.email === contractor.email) {
        closeEdit();
      }
      loadAll({ preserveStatus: true });
    } catch (_err) {
      setContractorStatus({ tone: 'error', text: 'Unable to delete contractor.' });
    }
  };

  const handleDeleteCustomer = async (customer) => {
    if (!customer?.email) return;
    const shouldDelete = await confirmDialog(
      `Delete customer ${customer.email}? This cannot be undone.`,
      { title: 'Delete customer', confirmText: 'Delete' }
    );
    if (!shouldDelete) return;
    try {
      await deleteCustomer(customer.email);
      if (editing?.type === 'customer' && editing?.form?.email === customer.email) {
        closeEdit();
      }
      loadAll({ preserveStatus: true });
    } catch (_err) {
      setCustomerStatus({ tone: 'error', text: 'Unable to delete customer.' });
    }
  };

  return (
    <div className="users-page">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Manage users</h2>
            <p className="muted">Bison, contractors, and customers.</p>
          </div>
          <div className="user-page-actions">
            <button className="primary" type="button" onClick={openCreateModal}>
              Add new user
            </button>
            <button className="ghost" type="button" onClick={loadAll}>
              Refresh
            </button>
          </div>
        </div>
        {loading ? <p className="muted">Loading users...</p> : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Bison</h2>
            <p className="muted">Internal team accounts.</p>
          </div>
          <button
            className="ghost"
            type="button"
            onClick={handleResetAssignedPasswords}
            disabled={!assignedBisonUsers.length || bulkResetLoading}
            title={
              assignedBisonUsers.length
                ? 'Send temporary password emails to all assigned Bison users'
                : 'No assigned users available'
            }
          >
            {bulkResetLoading ? 'Resetting...' : 'Reset assigned passwords'}
          </button>
        </div>
        <div className="table-scroll users-table-scroll">
          <table className="project-table users-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Full name</th>
                <th>Email</th>
                <th>Last login</th>
                <th>Roles</th>
                <th>Areas</th>
                <th>Theme</th>
                <th>Active</th>
                <th>Instances</th>
                <th>Reset?</th>
                <th>Locked?</th>
              </tr>
            </thead>
            <tbody>
              {sortedBison.length ? (
                sortedBison.map((user) => {
                  const activity =
                    activityMap.get(activityKey(user.username)) ||
                    activityMap.get(activityKey(user.email)) ||
                    {};
                  const lastLogin = formatLastLogin(user.last_login_at || activity.last_seen);
                  return (
                    <tr key={user.username} onDoubleClick={() => startEditBison(user)}>
                      <td>{user.login_username || user.username}</td>
                      <td>{user.full_name || '-'}</td>
                      <td>{user.email}</td>
                      <td title={lastLogin.title || undefined}>{lastLogin.text}</td>
                      <td>{(user.roles || []).join(', ') || '-'}</td>
                      <td className="users-cell-areas">{(user.areas || []).join(', ') || '-'}</td>
                      <td>{activity.theme === 'light' ? 'Light' : 'Dark'}</td>
                      <td>{activity.is_active ? 'Yes' : 'No'}</td>
                      <td>{activity.active_instances ?? 0}</td>
                      <td>{user.must_reset_password ? 'Yes' : 'No'}</td>
                      <td>{user.is_locked ? 'Yes' : 'No'}</td>
                    </tr>
                  );
                })
              ) : (
                <tr className="empty-row">
                  <td colSpan={11}>No Bison users available.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Contractors</h2>
            <p className="muted">Contractor logins.</p>
          </div>
        </div>
        <datalist id="shared-party-options">
          {sharedPartyOptions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
        <div className="table-scroll users-table-scroll">
          <table className="project-table users-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Company</th>
                <th>Role</th>
                <th>Created</th>
                <th>Last login</th>
                <th>Theme</th>
                <th>Active</th>
                <th>Instances</th>
                <th>Locked?</th>
              </tr>
            </thead>
            <tbody>
              {sortedContractors.length ? (
                sortedContractors.map((contractor) => {
                  const activity = activityMap.get(activityKey(contractor.email)) || {};
                  const linkedUser =
                    linkedUsersByIdentity.get(normalize(contractor.email)) ||
                    linkedUsersByIdentity.get(normalize(contractor.username));
                  const lastLogin = formatLastLogin(linkedUser?.last_login_at || activity.last_seen);
                  return (
                    <tr key={contractor.email} onDoubleClick={() => startEditContractor(contractor)}>
                      <td>{contractor.email}</td>
                      <td>{contractor.company || '-'}</td>
                      <td>{contractor.role || 'Contractor'}</td>
                      <td>{contractor.created_at ? new Date(contractor.created_at).toLocaleDateString() : '-'}</td>
                      <td title={lastLogin.title || undefined}>{lastLogin.text}</td>
                      <td>{activity.theme === 'light' ? 'Light' : 'Dark'}</td>
                      <td>{activity.is_active ? 'Yes' : 'No'}</td>
                      <td>{activity.active_instances ?? 0}</td>
                      <td>{linkedUser?.is_locked ? 'Yes' : 'No'}</td>
                    </tr>
                  );
                })
              ) : (
                <tr className="empty-row">
                  <td colSpan={9}>No contractor users yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Customers & Builders</h2>
            <p className="muted">External project accounts linked to one or more projects.</p>
          </div>
        </div>
        <div className="table-scroll users-table-scroll">
          <table className="project-table users-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Projects</th>
                <th>Role</th>
                <th>Last login</th>
                <th>Theme</th>
                <th>Active</th>
                <th>Instances</th>
                <th>Locked?</th>
              </tr>
            </thead>
            <tbody>
              {sortedCustomers.length ? (
                sortedCustomers.map((customer) => {
                  const activity = activityMap.get(activityKey(customer.email)) || {};
                  const linkedUser =
                    linkedUsersByIdentity.get(normalize(customer.email)) ||
                    linkedUsersByIdentity.get(normalize(customer.username));
                  const projectSummary = summarizeProjectSelection(projectIdsForCustomer(customer), projectMap);
                  const lastLogin = formatLastLogin(linkedUser?.last_login_at || activity.last_seen);
                  return (
                    <tr key={customer.email} onDoubleClick={() => startEditCustomer(customer)}>
                      <td>{customer.email}</td>
                      <td title={projectSummary.title || undefined}>{projectSummary.text}</td>
                      <td>{customer.role || 'Customer'}</td>
                      <td title={lastLogin.title || undefined}>{lastLogin.text}</td>
                      <td>{activity.theme === 'light' ? 'Light' : 'Dark'}</td>
                      <td>{activity.is_active ? 'Yes' : 'No'}</td>
                      <td>{activity.active_instances ?? 0}</td>
                      <td>{linkedUser?.is_locked ? 'Yes' : 'No'}</td>
                    </tr>
                  );
                })
              ) : (
                <tr className="empty-row">
                  <td colSpan={8}>No customer users yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {createModalOpen ? (
        <div className="modal-backdrop user-create-backdrop" onClick={closeCreateModal}>
          <div className="modal user-modal user-create-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title">Add new user</div>
                <p className="muted">What type of user should be created?</p>
              </div>
              <button className="ghost" type="button" onClick={closeCreateModal}>
                Close
              </button>
            </div>

            <div className="user-type-options" role="group" aria-label="User type">
              {CREATE_USER_TYPES.map((option) => (
                <button
                  key={option.value}
                  className={`user-type-option${createUserType === option.value ? ' selected' : ''}`}
                  type="button"
                  onClick={() => handleCreateUserTypeSelect(option.value)}
                  aria-pressed={createUserType === option.value}
                >
                  <span>{option.label}</span>
                  <small>{option.description}</small>
                </button>
              ))}
            </div>

            {selectedCreateType ? (
              <form className="form-grid user-create-form user-create-form--modal" onSubmit={handleCreateSubmit}>
                {createUserType === 'bison' ? (
                  <>
                    <label className="span-2">
                      Email
                      <input
                        value={createBisonForm.email}
                        onChange={(event) => setCreateBisonForm({ ...createBisonForm, email: event.target.value })}
                        placeholder="user@email.com"
                      />
                    </label>
                    <label className="span-3">
                      Roles (comma separated)
                      <input
                        value={createBisonForm.rolesText}
                        onChange={(event) =>
                          setCreateBisonForm({ ...createBisonForm, rolesText: event.target.value })
                        }
                        placeholder="Manager, Estimator"
                      />
                    </label>
                    <div className="user-create-note span-3">
                      A temporary password is generated automatically. Full name and username are set by the user on first sign in.
                    </div>
                    <div className="area-check-section span-3">
                      <div className="muted">Areas</div>
                      <div className="area-check-grid area-check-grid--balanced">
                        {AREA_OPTIONS.map((area) => (
                          <label key={area} className="area-check">
                            <input
                              type="checkbox"
                              checked={(createBisonForm.areas || []).includes(area)}
                              onChange={() => handleCreateBisonAreaToggle(area)}
                            />
                            <span>{area}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </>
                ) : null}

                {createUserType === 'contractor' ? (
                  <>
                    <label>
                      Company
                      <input
                        value={createContractorForm.company}
                        list="shared-party-options"
                        onChange={(event) =>
                          setCreateContractorForm({ ...createContractorForm, company: event.target.value })
                        }
                        placeholder="Company name"
                      />
                    </label>
                    <label>
                      Name
                      <input
                        value={createContractorForm.full_name}
                        onChange={(event) =>
                          setCreateContractorForm({ ...createContractorForm, full_name: event.target.value })
                        }
                        placeholder="Contractor name"
                      />
                    </label>
                    <label className="span-2">
                      Email
                      <input
                        value={createContractorForm.email}
                        onChange={(event) =>
                          setCreateContractorForm({ ...createContractorForm, email: event.target.value })
                        }
                        placeholder="contractor@email.com"
                      />
                    </label>
                    <div className="user-create-note span-3">
                      A temporary password is generated automatically and reset is required on first sign in.
                    </div>
                  </>
                ) : null}

                {createUserType === 'customer' || createUserType === 'builder' ? (
                  <>
                    <label className="span-2">
                      Email
                      <input
                        value={createCustomerForm.email}
                        onChange={(event) =>
                          setCreateCustomerForm({ ...createCustomerForm, email: event.target.value })
                        }
                        placeholder={createUserType === 'builder' ? 'builder@email.com' : 'customer@email.com'}
                      />
                    </label>
                    <label className="span-3">
                      Linked projects
                      <ProjectMultiSelect
                        projects={projectOptions}
                        selectedIds={createCustomerForm.project_ids}
                        onChange={(nextIds) =>
                          setCreateCustomerForm({ ...createCustomerForm, project_ids: nextIds })
                        }
                        placeholder="Select one or more projects"
                      />
                    </label>
                    <div className="user-create-note span-3">
                      {createUserType === 'builder'
                        ? 'A temporary password is generated automatically. Builder accounts only load assigned Builder models.'
                        : 'A temporary password is generated automatically and the account is linked to selected projects.'}
                    </div>
                  </>
                ) : null}

                <div className="user-create-actions span-3 user-create-actions--end">
                  <button className="ghost" type="button" onClick={closeCreateModal}>
                    Cancel
                  </button>
                  <button className="primary" type="submit">
                    {createSubmitLabel}
                  </button>
                </div>
              </form>
            ) : (
              <p className="user-create-helper muted">Choose Bison, Contractor, Customer, or Builder to continue.</p>
            )}
          </div>
        </div>
      ) : null}

      {editing ? (
        <div className="modal-backdrop" onClick={closeEdit}>
          <div className="modal user-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                {editing.type === 'bison'
                  ? `Edit user`
                  : editing.type === 'contractor'
                    ? 'Edit contractor'
                    : 'Edit customer'}
              </div>
              <button className="ghost" type="button" onClick={closeEdit}>
                Close
              </button>
            </div>
            {editing.type === 'bison' ? (
              <div className="user-edit-card">
                <div className="user-edit-section">
                  <h3 className="user-edit-section-title">Identity</h3>
                  <div className="user-form-grid">
                    <label>
                      Username
                      <input
                        value={editing.form.login_username}
                        onChange={(event) =>
                          setEditing({ ...editing, form: { ...editing.form, login_username: event.target.value } })
                        }
                      />
                    </label>
                    <label>
                      Account key
                      <input value={editing.form.username} disabled />
                    </label>
                    <label>
                      Full name
                      <input
                        value={editing.form.full_name}
                        onChange={(event) =>
                          setEditing({ ...editing, form: { ...editing.form, full_name: event.target.value } })
                        }
                      />
                    </label>
                    <label>
                      Email
                      <input
                        value={editing.form.email}
                        onChange={(event) =>
                          setEditing({ ...editing, form: { ...editing.form, email: event.target.value } })
                        }
                      />
                    </label>
                    <label className="span-2">
                      Roles (comma separated)
                      <input
                        value={editing.form.rolesText}
                        onChange={(event) =>
                          setEditing({ ...editing, form: { ...editing.form, rolesText: event.target.value } })
                        }
                      />
                    </label>
                  </div>
                </div>

                <div className="user-edit-section">
                  <h3 className="user-edit-section-title">Security</h3>
                  <div className="user-form-grid">
                    <label className="span-2">
                      Password
                      <div className="password-input-row">
                        <input
                          type={passwordVisible.bison ? 'text' : 'password'}
                          value={editing.form.password}
                          onChange={(event) =>
                            setEditing({ ...editing, form: { ...editing.form, password: event.target.value } })
                          }
                          placeholder="Leave blank to keep current"
                        />
                        <PasswordToggleButton
                          shown={passwordVisible.bison}
                          onClick={() => setPasswordVisible((prev) => ({ ...prev, bison: !prev.bison }))}
                        />
                      </div>
                    </label>
                    <label className="switch-field">
                      <input
                        type="checkbox"
                        checked={editing.form.must_reset_password}
                        onChange={(event) =>
                          setEditing({ ...editing, form: { ...editing.form, must_reset_password: event.target.checked } })
                        }
                      />
                      <span className="switch-track" aria-hidden="true">
                        <span className="switch-thumb" />
                      </span>
                      <span className="switch-text">Require password reset</span>
                    </label>
                    <label className="switch-field">
                      <input
                        type="checkbox"
                        checked={Boolean(editing.form.is_locked)}
                        onChange={(event) =>
                          setEditing({ ...editing, form: { ...editing.form, is_locked: event.target.checked } })
                        }
                      />
                      <span className="switch-track" aria-hidden="true">
                        <span className="switch-thumb" />
                      </span>
                      <span className="switch-text">{editing.form.is_locked ? 'Account locked' : 'Account unlocked'}</span>
                    </label>
                  </div>
                </div>

                <div className="user-edit-section">
                  <h3 className="user-edit-section-title">Areas</h3>
                  <div className="area-check-grid area-check-grid--balanced">
                    {AREA_OPTIONS.map((area) => (
                      <label key={area} className="area-check">
                        <input
                          type="checkbox"
                          checked={(editing.form.areas || []).includes(area)}
                          onChange={() => handleToggleArea(area)}
                        />
                        <span>{area}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="actions">
                  <button className="ghost" type="button" onClick={closeEdit}>
                    Cancel
                  </button>
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => handleForceLogout(editing.form.username, editing.form.login_username, editing.form.email)}
                  >
                    Force sign out
                  </button>
                  <button className="danger" type="button" onClick={() => handleDeleteBison({ username: editing.form.username })}>
                    Delete
                  </button>
                  <button className="primary" type="button" onClick={handleSaveBison}>
                    Save
                  </button>
                </div>
              </div>
            ) : null}

            {editing.type === 'contractor' ? (
              <div className="user-edit-card">
                <div className="user-edit-section">
                  <h3 className="user-edit-section-title">Identity</h3>
                  <div className="user-form-grid">
                    <label>
                      Account key
                      <input value={editing.form.username || editing.form.email} disabled />
                    </label>
                    <label>
                      Email
                      <input value={editing.form.email} disabled />
                    </label>
                    <label className="span-2">
                      Company
                      <input
                        value={editing.form.company}
                        list="shared-party-options"
                        onChange={(event) =>
                          setEditing({ ...editing, form: { ...editing.form, company: event.target.value } })
                        }
                        placeholder="Company name"
                      />
                    </label>
                  </div>
                </div>
                <div className="user-edit-section">
                  <h3 className="user-edit-section-title">Security</h3>
                  <div className="user-form-grid">
                    <label className="span-2">
                      New password
                      <div className="password-input-row">
                        <input
                          type={passwordVisible.contractor ? 'text' : 'password'}
                          value={editing.form.password}
                          onChange={(event) =>
                            setEditing({ ...editing, form: { ...editing.form, password: event.target.value } })
                          }
                          placeholder="Leave blank to keep current"
                        />
                        <PasswordToggleButton
                          shown={passwordVisible.contractor}
                          onClick={() => setPasswordVisible((prev) => ({ ...prev, contractor: !prev.contractor }))}
                        />
                      </div>
                    </label>
                    <label className="switch-field">
                      <input
                        type="checkbox"
                        checked={Boolean(editing.form.is_locked)}
                        onChange={(event) =>
                          setEditing({ ...editing, form: { ...editing.form, is_locked: event.target.checked } })
                        }
                      />
                      <span className="switch-track" aria-hidden="true">
                        <span className="switch-thumb" />
                      </span>
                      <span className="switch-text">{editing.form.is_locked ? 'Account locked' : 'Account unlocked'}</span>
                    </label>
                  </div>
                </div>
                <div className="actions">
                  <button className="ghost" type="button" onClick={closeEdit}>
                    Cancel
                  </button>
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => handleForceLogout(editing.form.username, editing.form.email)}
                  >
                    Force sign out
                  </button>
                  <button className="danger" type="button" onClick={() => handleDeleteContractor({ email: editing.form.email })}>
                    Delete
                  </button>
                  <button className="primary" type="button" onClick={handleSaveContractor}>
                    Save
                  </button>
                </div>
              </div>
            ) : null}

            {editing.type === 'customer' ? (
              <div className="user-edit-card">
                <div className="user-edit-section">
                  <h3 className="user-edit-section-title">Identity</h3>
                  <div className="user-form-grid">
                    <label>
                      Account key
                      <input value={editing.form.username || editing.form.email} disabled />
                    </label>
                    <label>
                      Email
                      <input value={editing.form.email} disabled />
                    </label>
                    <label>
                      Role
                      <select
                        value={editing.form.role || 'Customer'}
                        onChange={(event) =>
                          setEditing({ ...editing, form: { ...editing.form, role: event.target.value } })
                        }
                      >
                        <option value="Customer">Customer</option>
                        <option value="Builder">Builder</option>
                      </select>
                    </label>
                    <label className="span-2">
                      Linked projects
                      <ProjectMultiSelect
                        projects={projects}
                        selectedIds={editing.form.project_ids}
                        onChange={(nextIds) =>
                          setEditing({ ...editing, form: { ...editing.form, project_ids: nextIds } })
                        }
                        placeholder="Select one or more projects"
                      />
                    </label>
                  </div>
                </div>
                <div className="user-edit-section">
                  <h3 className="user-edit-section-title">Security</h3>
                  <div className="user-form-grid">
                    <label className="span-2">
                      New password
                      <div className="password-input-row">
                        <input
                          type={passwordVisible.customer ? 'text' : 'password'}
                          value={editing.form.password}
                          onChange={(event) =>
                            setEditing({ ...editing, form: { ...editing.form, password: event.target.value } })
                          }
                          placeholder="Leave blank to keep current"
                        />
                        <PasswordToggleButton
                          shown={passwordVisible.customer}
                          onClick={() => setPasswordVisible((prev) => ({ ...prev, customer: !prev.customer }))}
                        />
                      </div>
                    </label>
                    <label className="switch-field span-2">
                      <input
                        type="checkbox"
                        checked={Boolean(editing.form.is_locked)}
                        onChange={(event) =>
                          setEditing({ ...editing, form: { ...editing.form, is_locked: event.target.checked } })
                        }
                      />
                      <span className="switch-track" aria-hidden="true">
                        <span className="switch-thumb" />
                      </span>
                      <span className="switch-text">{editing.form.is_locked ? 'Account locked' : 'Account unlocked'}</span>
                    </label>
                  </div>
                </div>
                <div className="actions">
                  <button className="ghost" type="button" onClick={closeEdit}>
                    Cancel
                  </button>
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => handleForceLogout(editing.form.username, editing.form.email)}
                  >
                    Force sign out
                  </button>
                  <button className="danger" type="button" onClick={() => handleDeleteCustomer({ email: editing.form.email })}>
                    Delete
                  </button>
                  <button className="primary" type="button" onClick={handleSaveCustomer}>
                    Save
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {dialogPortal}
    </div>
  );
}
