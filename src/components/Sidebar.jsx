import React from 'react';
import logo from '../assets/BisonWorksFavicon.png';

function normalizePath(value) {
  if (!value) return '';
  return value.endsWith('/') && value.length > 1 ? value.slice(0, -1) : value;
}

function getActivePath(currentPath, items) {
  const normalizedCurrent = normalizePath(currentPath);
  let active = '';
  items.forEach((item) => {
    const target = normalizePath(item.path);
    if (!target) return;
    if (normalizedCurrent === target || normalizedCurrent.startsWith(`${target}/`)) {
      if (!active || target.length > active.length) {
        active = target;
      }
    }
  });
  return active;
}

export default function Sidebar({ currentPath = '', onNavigate, navItems = [], isOpen = false, onClose }) {
  const items = navItems.length ? navItems : [{ label: 'Dashboard', path: '/pipeline' }];
  const activePath = getActivePath(currentPath, items);
  return (
    <aside className={`sidebar${isOpen ? ' open' : ''}`}>
      <div className="brand">
        <img className="brand-logo" src={logo} alt="BisonWorks logo" />
        <div className="brand-title">BisonWorks</div>
      </div>

      <div className="nav-section">
        <div className="nav-title">Views</div>
        <nav className="nav">
          {items.map((item) => (
            <button
              key={`${item.path}-${item.label}`}
              type="button"
              className={`nav-link${normalizePath(item.path) === activePath ? ' active' : ''}`}
              onClick={() => {
                onNavigate?.(item.path);
                onClose?.();
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>
    </aside>
  );
}
