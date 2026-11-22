import React, { createContext, useContext, useEffect, useRef, useState } from "react";

export const PreviewControls = createContext(null);

const iconPaths = {
  home: "M3 3h7v7H3z M14 3h7v5h-7z M3 14h7v7H3z M14 12h7v9h-7z",
  find: "M11 21s6-4.7 6-11a6 6 0 1 0-12 0c0 6.3 6 11 6 11z M9 10a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
  vehicles: "m4 13 2-6h12l2 6 M4 17v2m16-2v2 M4 13h16v4H4z M7 15h1m8 0h1",
  bookings: "M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M8 8h8m-8 4h8m-8 4h5",
  profile: "M8 8a4 4 0 1 0 8 0 4 4 0 1 0-8 0 M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2",
  facilities: "M3 21h18 M5 21V9l7-5 7 5v12 M9 21v-7h6v7 M8 10h.01m8 0h.01",
  layout: "M3 3h18v18H3z M3 9h18M3 15h18M9 3v18M15 3v18",
  operators: "M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M7 8a3 3 0 1 0 6 0 3 3 0 1 0-6 0 M20 21v-2a4 4 0 0 0-3-3.9 M16 5.2a3 3 0 0 1 0 5.6",
  report: "M4 4v16h16 M8 16v-4m5 4V8m5 8v-6",
};

export function WorkspaceIcon({ name }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none"
    stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
    <path d={iconPaths[name === "reservations" ? "bookings" : name]} />
  </svg>;
}

export function Brand() {
  return <div className="brand"><span className="brand-mark" aria-hidden="true">P</span>
    <span className="brand-name">Parking Management</span>
  </div>;
}

export function WorkspaceShell({ role, items, page, onNavigate, onSignOut, transitionKey, children }) {
  const previewControls = useContext(PreviewControls);
  const content = useRef(null);
  const collapseTimer = useRef(null);
  const [collapsed, setCollapsed] = useState(true);

  function selectPage(id) {
    if (id === page) return;
    onNavigate(id);
    setCollapsed(false);
    clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => setCollapsed(true), 3000);
  }

  useEffect(() => () => clearTimeout(collapseTimer.current), []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = content.current.animate([
      { opacity: .55, transform: "translateY(8px)" },
      { opacity: 1, transform: "translateY(0)" },
    ], { duration: 280, easing: "cubic-bezier(.2,.75,.25,1)" });
    return () => animation.cancel();
  }, [page, transitionKey]);

  return <div className="workspace" data-nav-collapsed={collapsed}>
    <aside className="workspace-sidebar">
      <Brand />
      <nav aria-label={role + " navigation"} className="workspace-nav">
        {items.map(({ id, label }) => <button key={id} type="button"
          aria-label={label} title={collapsed ? label : undefined}
          aria-current={page === id ? "page" : undefined} onClick={() => selectPage(id)}>
          <span className="nav-icon" aria-hidden="true"><WorkspaceIcon name={id} /></span>
          <span className="nav-label" aria-hidden="true">{label}</span>
        </button>)}
      </nav>
    </aside>
    <div className="workspace-body">
      <header className="app-header">
        <div className="header-content">
          <div className="eyebrow">{role} workspace</div>
          <span className="workspace-timezone">PKT · UTC+5</span>
          {previewControls || <button type="button" onClick={onSignOut}>Sign out</button>}
        </div>
      </header>
      <main className="workspace-content" ref={content}>{children}</main>
    </div>
  </div>;
}

export function PageHeading({ title, action }) {
  return <div className="page-heading">
    <h1>{title}</h1>
    {action}
  </div>;
}
