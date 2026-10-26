import { ReactNode, useEffect, useState } from "react";
import { fetchAvatarBlobUrl, User } from "../api";

export type NavSection = "processes" | "organizations" | "settings";

export function AppLayout({
  title,
  activeSection,
  user,
  avatarVersion = 0,
  onNavigate,
  onLogout,
  headerActions,
  children
}: {
  title: string;
  activeSection: NavSection;
  user: User;
  avatarVersion?: number;
  onNavigate: (section: NavSection) => void;
  onLogout: () => void;
  headerActions?: ReactNode;
  children: ReactNode;
}) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    let currentUrl: string | null = null;
    let active = true;

    if (!user.hasAvatar) {
      setAvatarUrl(null);
      return;
    }

    fetchAvatarBlobUrl(user.id).then(url => {
      if (!active) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      currentUrl = url;
      setAvatarUrl(url);
    });

    return () => {
      active = false;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [user.id, user.hasAvatar, avatarVersion]);

  const initials = user.displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? "")
    .join("") || "U";

  const navItems: Array<{ id: NavSection; label: string }> = [
    { id: "processes", label: "Processos" },
    ...(user.role === "Admin" ? [{ id: "organizations" as const, label: "Organizações" }] : []),
    { id: "settings", label: "Configurações" }
  ];

  return (
    <div className="gaia-shell">
      <aside className="gaia-sidebar">
        <div className="gaia-brand">
          <div className="gaia-bars" aria-hidden="true">
            <div className="gaia-bar-left" />
            <div className="gaia-bar-right" />
          </div>
          <div className="gaia-brand-title">GAIA BPMN</div>
        </div>

        <nav className="gaia-nav">
          {navItems.map(item => {
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`gaia-nav-pill ${active ? "active" : ""}`}
              >
                <span className="gaia-nav-label">{item.label}</span>
                <span className="gaia-nav-indicator">{active ? "●" : "→"}</span>
              </button>
            );
          })}
        </nav>

        <div className="gaia-sidebar-footer">
          <div className="gaia-footer-badge">
            <span className="gaia-footer-title">GAIA BPMN</span>
            <small>Gestão de Processos</small>
          </div>
        </div>
      </aside>

      <div className="gaia-main-area">
        <header className="gaia-header">
          <div className="gaia-header-left">
            <h1 className="gaia-page-title">{title}</h1>
            {headerActions && <div className="gaia-header-actions">{headerActions}</div>}
          </div>

          <div className="gaia-user-box">
            <span className={`role-badge ${user.role === "Admin" ? "role-admin" : "role-guest"}`}>
              {user.role === "Admin" ? "Mestre" : "Convidado"}
            </span>

            <div className="user-avatar" title={user.displayName}>
              {avatarUrl ? <img src={avatarUrl} alt={user.displayName} /> : <span>{initials}</span>}
            </div>

            <div className="user-meta">
              <strong>{user.displayName}</strong>
              <small>@{user.username}</small>
            </div>

            <button type="button" className="btn-logout" onClick={onLogout}>
              Sair
            </button>
          </div>
        </header>

        <main className="gaia-content">{children}</main>
      </div>
    </div>
  );
}
