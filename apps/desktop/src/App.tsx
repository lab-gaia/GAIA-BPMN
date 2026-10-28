import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { clearSession, getAuthToken, getMe, onUnauthorized, User } from "./api";
import { AppLayout, NavSection } from "./components/AppLayout";
import { Home } from "./pages/Home";
import { Login } from "./pages/Login";
import { ProcessView } from "./pages/ProcessView";
import { Settings } from "./pages/Settings";
import { Registrations } from "./pages/Registrations";

const queryClient = new QueryClient();

function Shell() {
  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState<boolean>(() => Boolean(getAuthToken()));
  const [activeSection, setActiveSection] = useState<NavSection>("processes");
  const [processId, setProcessId] = useState<string>();
  const [avatarVersion, setAvatarVersion] = useState(0);

  useEffect(() => {
    if (!window.history.state?.gaiaBpmn) {
      window.history.replaceState({ gaiaBpmn: true, section: "processes" }, "");
    }

    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as { gaiaBpmn?: boolean; section?: NavSection; processId?: string } | null;
      setActiveSection(state?.section ?? "processes");
      setProcessId(state?.processId);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const unsubscribe = onUnauthorized(() => {
      setUser(null);
      setProcessId(undefined);
      queryClient.clear();
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setCheckingAuth(false);
      return;
    }
    let active = true;
    getMe()
      .then(profile => {
        if (active) setUser(profile);
      })
      .catch(() => {
        clearSession();
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setCheckingAuth(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function handleLogout() {
    clearSession();
    setUser(null);
    setProcessId(undefined);
    setActiveSection("processes");
    queryClient.clear();
  }

  if (checkingAuth) {
    return (
      <div className="login-page">
        <div className="login-card">
          <p className="login-subtitle">Carregando sessão...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login onSuccess={loggedUser => setUser(loggedUser)} />;
  }

  return (
    <AppLayout
      activeSection={activeSection}
      user={user}
      avatarVersion={avatarVersion}
      onNavigate={section => {
        setActiveSection(section);
        setProcessId(undefined);
        window.history.pushState({ gaiaBpmn: true, section }, "");
      }}
      onLogout={handleLogout}
    >
      {activeSection === "registrations" ? (
        <Registrations />
      ) : activeSection === "settings" ? (
        <Settings
          user={user}
          avatarVersion={avatarVersion}
          onUserUpdated={updated => setUser(updated)}
          onAvatarUpdated={updated => {
            setUser(updated);
            setAvatarVersion(v => v + 1);
          }}
        />
      ) : processId ? (
        <ProcessView
          processId={processId}
          user={user}
          onHome={() => {
            if (window.history.state?.processId) {
              window.history.back();
            } else {
              setProcessId(undefined);
            }
          }}
        />
      ) : (
        <Home
          user={user}
          onOpen={id => {
            setProcessId(id);
            window.history.pushState({ gaiaBpmn: true, section: "processes", processId: id }, "");
          }}
        />
      )}
    </AppLayout>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}
