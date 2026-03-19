import React, { useEffect, useMemo, useState } from 'react';
import {
  createUser,
  createContractor,
  createCustomer,
  deleteContractor,
  deleteCustomer,
  deleteUser,
  listContractors,
  listCustomers,
  listProjects,
  listUserActivity,
  listUsers,
  updateContractor,
  updateCustomer,
  updateUser
} from '../api.js';
import useSiteDialog from '../utils/useSiteDialog.jsx';
import { formatStageName, STAGE_FLOW } from '../utils/stageDisplay.js';

const AREA_OPTIONS = [...STAGE_FLOW.map((stage) => formatStageName(stage.name, stage.id)), 'Management', 'Admin'];

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function activityKey(value) {
  return normalize(value);
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
  return hasRole(user, 'contractor') && !isBisonUser(user) && !hasRole(user, 'customer');
}

function isCustomerOnly(user) {
  return hasRole(user, 'customer') && !isBisonUser(user) && !hasRole(user, 'contractor');
}

function projectLabel(project) {
  const projectNumber = String(project?.project_number || '').trim();
  const projectName = String(project?.name || '').trim();
  if (projectNumber && projectName) {
    return `${projectNumber} - ${projectName}`;
  }
  return projectName || projectNumber || project?.id || 'Unnamed project';
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

export default function Users() {
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
  const { confirmDialog, alertDialog, dialogPortal } = useSiteDialog();
  const [createBisonForm, setCreateBisonForm] = useState({
    email: '',
    rolesText: '',
    areas: []
  });
  const [createContractorForm, setCreateContractorForm] = useState({ company: '', full_name: '', email: '' });
  const [createCustomerForm, setCreateCustomerForm] = useState({ email: '', project_id: '' });

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
        const filtered = (Array.isArray(usersResult.value) ? usersResult.value : []).filter(
          (user) => !isCustomerOnly(user) && !isContractorOnly(user)
        );
        setBisonUsers(filtered);
      } else {
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
      map.set(project.id, projectLabel(project));
    });
    return map;
  }, [projects]);

  const activeProjects = useMemo(
    () => projects.filter((project) => !project?.is_deleted).sort(sortProjects),
    [projects]
  );

  const sortedBison = useMemo(
    () =>
      [...bisonUsers].sort((a, b) =>
        normalize(a.login_username || a.username).localeCompare(normalize(b.login_username || b.username))
      ),
    [bisonUsers]
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

  const startEditBison = (user) => {
    setEditStatus(null);
    setEditing({
      type: 'bison',
      form: {
        username: user.username,
        full_name: user.full_name || '',
        email: user.email || '',
        rolesText: (user.roles || []).join(', '),
        password: '',
        must_reset_password: Boolean(user.must_reset_password),
        areas: Array.isArray(user.areas) ? user.areas : []
      }
    });
  };

  const startEditContractor = (contractor) => {
    setEditStatus(null);
    setEditing({
      type: 'contractor',
      form: {
        email: contractor.email,
        company: contractor.company || '',
        password: ''
      }
    });
  };

  const startEditCustomer = (customer) => {
    setEditStatus(null);
    setEditing({
      type: 'customer',
      form: {
        email: customer.email,
        password: '',
        project_id: customer.project_id || ''
      }
    });
  };

  const closeEdit = () => {
    setEditing(null);
    setEditStatus(null);
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
    if (!form.email.trim() || !form.full_name.trim()) {
      setEditStatus({ tone: 'error', text: 'Full name and email are required.' });
      return;
    }
    const payload = {
      email: form.email.trim(),
      full_name: form.full_name.trim(),
      roles: splitRoles(form.rolesText),
      areas: form.areas || [],
      must_reset_password: Boolean(form.must_reset_password)
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
    const payload = {
      project_id: form.project_id ? form.project_id : null
    };
    if (form.password.trim()) {
      payload.password = form.password.trim();
    }
    try {
      await updateCustomer(form.email, payload);
      setCustomerStatus({ tone: 'success', text: 'Customer updated.' });
      closeEdit();
      loadAll({ preserveStatus: true });
    } catch (err) {
      setEditStatus({ tone: 'error', text: 'Unable to update customer.' });
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
    try {
      await createCustomer({
        email: createCustomerForm.email.trim(),
        project_id: createCustomerForm.project_id || null
      });
      setCreateCustomerForm({ email: '', project_id: '' });
      setCustomerStatus({
        tone: 'success',
        text: 'Customer created. Temporary password email sent when SMTP is configured.'
      });
      loadAll({ preserveStatus: true });
    } catch (err) {
      setCustomerStatus({ tone: 'error', text: 'Unable to create customer.' });
    }
  };

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
          <button className="ghost" type="button" onClick={loadAll}>
            Refresh
          </button>
        </div>
        {loading ? <p className="muted">Loading users...</p> : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Bison</h2>
            <p className="muted">Internal team accounts.</p>
          </div>
        </div>
        <form className="form-grid user-create-form user-create-form--bison" onSubmit={handleCreateBison}>
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
              onChange={(event) => setCreateBisonForm({ ...createBisonForm, rolesText: event.target.value })}
              placeholder="Manager, Estimator"
            />
          </label>
          <div className="user-create-note">
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
          <div className="user-create-actions span-3 user-create-actions--end">
            <button className="primary" type="submit">
              Add Bison user
            </button>
          </div>
        </form>
        <div className="table-scroll users-table-scroll">
          <table className="project-table users-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Full name</th>
                <th>Email</th>
                <th>Roles</th>
                <th>Areas</th>
                <th>Theme</th>
                <th>Active</th>
                <th>Instances</th>
                <th>Reset?</th>
              </tr>
            </thead>
            <tbody>
              {sortedBison.length ? (
                sortedBison.map((user) => {
                  const activity =
                    activityMap.get(activityKey(user.username)) ||
                    activityMap.get(activityKey(user.email)) ||
                    {};
                  return (
                    <tr key={user.username} onDoubleClick={() => startEditBison(user)}>
                      <td>{user.login_username || user.username}</td>
                      <td>{user.full_name || '-'}</td>
                      <td>{user.email}</td>
                      <td>{(user.roles || []).join(', ') || '-'}</td>
                      <td>{(user.areas || []).join(', ') || '-'}</td>
                      <td>{activity.theme === 'light' ? 'Light' : 'Dark'}</td>
                      <td>{activity.is_active ? 'Yes' : 'No'}</td>
                      <td>{activity.active_instances ?? 0}</td>
                      <td>{user.must_reset_password ? 'Yes' : 'No'}</td>
                    </tr>
                  );
                })
              ) : (
                <tr className="empty-row">
                  <td colSpan={9}>No Bison users available.</td>
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
        <form className="form-grid user-create-form user-create-form--simple" onSubmit={handleCreateContractor}>
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
              onChange={(event) => setCreateContractorForm({ ...createContractorForm, email: event.target.value })}
              placeholder="contractor@email.com"
            />
          </label>
          <div className="user-create-note span-2">
            A temporary password is generated automatically and reset is required on first sign in.
          </div>
          <div className="user-create-actions user-create-actions--end">
            <button className="primary" type="submit">
              Add contractor
            </button>
          </div>
        </form>
        <div className="table-scroll users-table-scroll">
          <table className="project-table users-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Company</th>
                <th>Role</th>
                <th>Created</th>
                <th>Theme</th>
                <th>Active</th>
                <th>Instances</th>
              </tr>
            </thead>
            <tbody>
              {sortedContractors.length ? (
                sortedContractors.map((contractor) => {
                  const activity = activityMap.get(activityKey(contractor.email)) || {};
                  return (
                    <tr key={contractor.email} onDoubleClick={() => startEditContractor(contractor)}>
                      <td>{contractor.email}</td>
                      <td>{contractor.company || '-'}</td>
                      <td>{contractor.role || 'Contractor'}</td>
                      <td>{contractor.created_at ? new Date(contractor.created_at).toLocaleDateString() : '-'}</td>
                      <td>{activity.theme === 'light' ? 'Light' : 'Dark'}</td>
                      <td>{activity.is_active ? 'Yes' : 'No'}</td>
                      <td>{activity.active_instances ?? 0}</td>
                    </tr>
                  );
                })
              ) : (
                <tr className="empty-row">
                  <td colSpan={7}>No contractor users yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Customers</h2>
            <p className="muted">Customer accounts linked to a project.</p>
          </div>
        </div>
        <form className="form-grid user-create-form user-create-form--simple" onSubmit={handleCreateCustomer}>
          <label>
            Email
            <input
              value={createCustomerForm.email}
              onChange={(event) => setCreateCustomerForm({ ...createCustomerForm, email: event.target.value })}
              placeholder="customer@email.com"
            />
          </label>
          <label className="span-2">
            Linked project (active projects)
            <select
              value={createCustomerForm.project_id}
              onChange={(event) => setCreateCustomerForm({ ...createCustomerForm, project_id: event.target.value })}
            >
              <option value="">No project selected</option>
              {activeProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {projectLabel(project)}
                </option>
              ))}
            </select>
          </label>
          <div className="user-create-note span-2">
            A temporary password is generated automatically and reset is required on first sign in.
          </div>
          <div className="user-create-actions user-create-actions--end">
            <button className="primary" type="submit">
              Add customer
            </button>
          </div>
        </form>
        <div className="table-scroll users-table-scroll">
          <table className="project-table users-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Project</th>
                <th>Role</th>
                <th>Theme</th>
                <th>Active</th>
                <th>Instances</th>
              </tr>
            </thead>
            <tbody>
              {sortedCustomers.length ? (
                sortedCustomers.map((customer) => {
                  const activity = activityMap.get(activityKey(customer.email)) || {};
                  return (
                    <tr key={customer.email} onDoubleClick={() => startEditCustomer(customer)}>
                      <td>{customer.email}</td>
                      <td>{projectMap.get(customer.project_id) || '-'}</td>
                      <td>{customer.role || 'Customer'}</td>
                      <td>{activity.theme === 'light' ? 'Light' : 'Dark'}</td>
                      <td>{activity.is_active ? 'Yes' : 'No'}</td>
                      <td>{activity.active_instances ?? 0}</td>
                    </tr>
                  );
                })
              ) : (
                <tr className="empty-row">
                  <td colSpan={6}>No customer users yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

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
                <div className="user-form-grid">
                  <label>
                    Username
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
                  <label>
                    Roles (comma separated)
                    <input
                      value={editing.form.rolesText}
                      onChange={(event) =>
                        setEditing({ ...editing, form: { ...editing.form, rolesText: event.target.value } })
                      }
                    />
                  </label>
                  <label>
                    Password
                    <input
                      type="password"
                      value={editing.form.password}
                      onChange={(event) =>
                        setEditing({ ...editing, form: { ...editing.form, password: event.target.value } })
                      }
                      placeholder="Leave blank to keep current"
                    />
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
                </div>
                <div className="area-check-section">
                  <div className="muted">Areas</div>
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
                <div className="user-form-grid">
                  <label>
                    Email
                    <input value={editing.form.email} disabled />
                  </label>
                  <label>
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
                  <label>
                    New password
                    <input
                      type="password"
                      value={editing.form.password}
                      onChange={(event) =>
                        setEditing({ ...editing, form: { ...editing.form, password: event.target.value } })
                      }
                      placeholder="Enter new password"
                    />
                  </label>
                </div>
                <div className="actions">
                  <button className="ghost" type="button" onClick={closeEdit}>
                    Cancel
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
                <div className="user-form-grid">
                  <label>
                    Email
                    <input value={editing.form.email} disabled />
                  </label>
                  <label>
                    New password
                    <input
                      type="password"
                      value={editing.form.password}
                      onChange={(event) =>
                        setEditing({ ...editing, form: { ...editing.form, password: event.target.value } })
                      }
                      placeholder="Leave blank to keep current"
                    />
                  </label>
                  <label className="span-2">
                    Linked project
                    <select
                      value={editing.form.project_id}
                      onChange={(event) =>
                        setEditing({ ...editing, form: { ...editing.form, project_id: event.target.value } })
                      }
                    >
                      <option value="">No project selected</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {projectLabel(project)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="actions">
                  <button className="ghost" type="button" onClick={closeEdit}>
                    Cancel
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
