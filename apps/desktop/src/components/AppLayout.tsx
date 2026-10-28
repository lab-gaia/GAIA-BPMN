import { ReactNode, useEffect, useState } from "react";
import { fetchAvatarBlobUrl, User } from "../api";

export type NavSection = "processes" | "registrations" | "settings";

export function AppLayout({
  activeSection,
  user,
  avatarVersion = 0,
  onNavigate,
  onLogout,
  children
}: {
  activeSection: NavSection;
  user: User;
  avatarVersion?: number;
  onNavigate: (section: NavSection) => void;
  onLogout: () => void;
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
    ...(user.role === "Admin" ? [{ id: "registrations" as const, label: "Cadastros" }] : []),
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
          <div className="gaia-user-box">
            <div className="user-avatar" title={user.displayName}>
              {avatarUrl ? <img src={avatarUrl} alt={user.displayName} /> : <span>{initials}</span>}
            </div>

            <div className="user-meta">
              <strong>{user.displayName}</strong>
              <small>@{user.username}</small>
            </div>

            <span className={`role-badge ${user.role === "Admin" ? "role-admin" : "role-guest"}`}>
              {user.role === "Admin" ? "Mestre" : "Convidado"}
            </span>
          </div>

          <button type="button" className="btn-logout" onClick={onLogout}>
            Sair
          </button>
        </div>
      </aside>

      <div className="gaia-main-area">
        <main className="gaia-content">{children}</main>
      </div>
    </div>
  );
}
