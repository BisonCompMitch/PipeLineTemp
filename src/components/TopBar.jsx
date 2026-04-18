import React, { useEffect, useRef, useState } from 'react';

const DEFAULT_TESTING_OVERRIDE = { rolePreset: 'auto', areas: '' };

function initialsFor(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return 'BW';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function projectLabel(project) {
  const projectNumber = String(project?.project_number || '').trim();
  const projectName = String(project?.name || '').trim();
  if (projectNumber && projectName) {
    return `${projectNumber} - ${projectName}`;
  }
  return projectName || projectNumber || project?.id || 'Project';
}

function normalizeTestingOverride(value) {
  return {
    rolePreset: value?.rolePreset || 'auto',
    areas: value?.areas || ''
  };
}

export default function TopBar({
  title,
  displayName = 'User',
  onSignOut,
  onOpenHelp,
  theme,
  onToggleTheme,
  testingOverride,
  onTestingOverrideChange,
  customerProjectOptions = [],
  selectedCustomerProjectId = '',
  onCustomerProjectChange,
  showNavToggle = false,
  onToggleNav
}) {
  const normalizedDisplayName = String(displayName || '').trim() || 'User';
  const [menuOpen, setMenuOpen] = useState(false);
  const [testingOpen, setTestingOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [draft, setDraft] = useState(() => normalizeTestingOverride(testingOverride || DEFAULT_TESTING_OVERRIDE));
  const menuRef = useRef(null);
  const testingRef = useRef(null);
  const customerRef = useRef(null);

  const customerProjectList = Array.isArray(customerProjectOptions) ? customerProjectOptions : [];
  const selectedCustomerProject =
    customerProjectList.find((project) => project?.id === selectedCustomerProjectId) ||
    customerProjectList[0] ||
    null;
  const customerProjectText = selectedCustomerProject
    ? projectLabel(selectedCustomerProject)
    : 'Select project';

  useEffect(() => {
    setDraft(normalizeTestingOverride(testingOverride || DEFAULT_TESTING_OVERRIDE));
  }, [testingOverride]);

  useEffect(() => {
    if (!menuOpen && !testingOpen && !customerOpen) return undefined;
    const handleClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
      if (testingRef.current && !testingRef.current.contains(event.target)) {
        setTestingOpen(false);
      }
      if (customerRef.current && !customerRef.current.contains(event.target)) {
        setCustomerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen, testingOpen, customerOpen]);

  const handleLogout = () => {
    setMenuOpen(false);
    setTestingOpen(false);
    setCustomerOpen(false);
    onSignOut?.();
  };

  const handleOpenHelp = () => {
    setMenuOpen(false);
    setTestingOpen(false);
    setCustomerOpen(false);
    onOpenHelp?.();
  };

  const handleApplyTesting = () => {
    onTestingOverrideChange?.({
      rolePreset: draft.rolePreset || 'auto',
      areas: draft.areas || ''
    });
    setCustomerOpen(false);
    setTestingOpen(false);
  };

  const handleResetTesting = () => {
    const reset = { ...DEFAULT_TESTING_OVERRIDE };
    setDraft(reset);
    onTestingOverrideChange?.(reset);
    setCustomerOpen(false);
    setTestingOpen(false);
  };

  const handleCustomerProjectChange = (event) => {
    onCustomerProjectChange?.(event.target.value);
    setCustomerOpen(false);
  };

  return (
    <div className="topbar">
      <div className="topbar-left">
        {showNavToggle ? (
          <button
            className="ghost icon-button menu-toggle"
            type="button"
            onClick={onToggleNav}
            aria-label="Toggle navigation menu"
            data-tutorial-id="nav-toggle-button"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M4 7h16M4 12h16M4 17h16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        ) : null}
        <div className="topbar-project">
          <span className="topbar-project-label">{title}</span>
        </div>
        <label className="topbar-search">
          <span className="search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M16.5 16.5L21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <input type="search" placeholder="Search" />
        </label>
      </div>
      <div className="topbar-right">
        <div className="topbar-actions">
          {customerProjectList.length > 1 && onCustomerProjectChange ? (
            <div className="testing-control customer-project-control" ref={customerRef}>
              <button
                className="ghost customer-project-trigger"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setTestingOpen(false);
                  setCustomerOpen((open) => !open);
                }}
                aria-label="Switch customer project"
              >
                <span className="customer-project-trigger-label">{customerProjectText}</span>
                <svg className="caret" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M5 7l5 6 5-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
              {customerOpen ? (
                <div className="testing-panel customer-project-panel">
                  <div className="testing-row">
                    <label htmlFor="customer-project-select">Project</label>
                    <select
                      id="customer-project-select"
                      value={selectedCustomerProject?.id || ''}
                      onChange={handleCustomerProjectChange}
                    >
                      {customerProjectList.map((project) => (
                        <option key={project.id} value={project.id}>
                          {projectLabel(project)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {onTestingOverrideChange ? (
            <div className="testing-control" ref={testingRef}>
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setCustomerOpen(false);
                  setTestingOpen((open) => !open);
                }}
              >
                Testing
              </button>
              {testingOpen ? (
                <div className="testing-panel">
                  <div className="testing-row">
                    <label htmlFor="testing-role-preset">Role preset</label>
                    <select
                      id="testing-role-preset"
                      value={draft.rolePreset}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, rolePreset: event.target.value }))
                      }
                    >
                      <option value="auto">Auto (profile)</option>
                      <option value="bison">Bison</option>
                      <option value="bison_contractor">Bison + Contractor</option>
                      <option value="contractor">Contractor</option>
                      <option value="customer">Customer</option>
                    </select>
                  </div>
                  <div className="testing-row">
                    <label htmlFor="testing-areas">Areas override</label>
                    <input
                      id="testing-areas"
                      value={draft.areas}
                      placeholder="Design, Engineering"
                      onChange={(event) => setDraft((current) => ({ ...current, areas: event.target.value }))}
                    />
                  </div>
                  <div className="testing-actions">
                    <button className="ghost" type="button" onClick={handleResetTesting}>
                      Reset
                    </button>
                    <button className="primary" type="button" onClick={handleApplyTesting}>
                      Apply
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {onToggleTheme ? (
            <button
              className="ghost icon-button theme-toggle-button"
              type="button"
              onClick={onToggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
              data-tutorial-id="theme-toggle-button"
            >
              {theme === 'dark' ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
                  <path
                    d="M12 2.8v2.2M12 19v2.2M21.2 12H19M5 12H2.8M18.4 5.6l-1.5 1.5M7.1 16.9l-1.5 1.5M18.4 18.4l-1.5-1.5M7.1 7.1 5.6 5.6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M20.2 14.7a8.5 8.5 0 1 1-10.9-10 7.2 7.2 0 1 0 10.9 10Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          ) : null}
          <div className="user-menu" ref={menuRef}>
            <button
              className="topbar-user"
              type="button"
              data-tutorial-id="user-menu-button"
              onClick={() => {
                setTestingOpen(false);
                setCustomerOpen(false);
                setMenuOpen((open) => !open);
              }}
            >
              <span className="avatar">{initialsFor(normalizedDisplayName)}</span>
              <span>{normalizedDisplayName}</span>
              <svg className="caret" viewBox="0 0 20 20">
                <path d="M5 7l5 6 5-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
            {menuOpen ? (
              <div className="user-dropdown">
                {onOpenHelp ? (
                  <button
                    className="dropdown-item"
                    type="button"
                    data-tutorial-id="help-button"
                    onClick={handleOpenHelp}
                  >
                    Help
                  </button>
                ) : null}
                <button className="dropdown-item" type="button" onClick={handleLogout}>
                  Log out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
