import { FormEvent, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  changePassword,
  checkApiHealth,
  createUser,
  deleteUser,
  fetchAvatarBlobUrl,
  getApiUrl,
  listUsers,
  resetUserPassword,
  setApiUrl,
  updateProfile,
  uploadAvatar,
  type User,
  type UserRole
} from "../api";
import { PasswordInput } from "../components/PasswordInput";

export function Settings({
  user,
  avatarVersion,
  onUserUpdated,
  onAvatarUpdated
}: {
  user: User;
  avatarVersion: number;
  onUserUpdated: (updated: User) => void;
  onAvatarUpdated: (updated: User) => void;
}) {
  const isAdmin = user.role === "Admin";
  const queryClient = useQueryClient();
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Card 1 — Perfil do Usuário
  const [displayName, setDisplayName] = useState(user.displayName);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [profileMessage, setProfileMessage] = useState<string>();
  const [profileError, setProfileError] = useState<string>();

  // Card 2 — Alterar Senha
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<string>();
  const [passwordError, setPasswordError] = useState<string>();

  // Card 3 — Conexão da API
  const [apiUrlInput, setApiUrlInput] = useState(getApiUrl);
  const [apiStatus, setApiStatus] = useState<string>();
  const [apiError, setApiError] = useState<string>();

  // Card 4 — Gerenciamento de Usuários (Admin)
  const [newUsername, setNewUsername] = useState("");
  const [newUserDisplayName, setNewUserDisplayName] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<UserRole>("Guest");
  const [userMgmtMessage, setUserMgmtMessage] = useState<string>();
  const [userMgmtError, setUserMgmtError] = useState<string>();
  const [resetTargetUserId, setResetTargetUserId] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");

  useEffect(() => {
    setDisplayName(user.displayName);
  }, [user.displayName]);

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

  const profileMutation = useMutation({
    mutationFn: () => updateProfile(displayName),
    onSuccess: updated => {
      onUserUpdated(updated);
      setProfileError(undefined);
      setProfileMessage("Perfil atualizado com sucesso.");
    },
    onError: err => {
      setProfileMessage(undefined);
      setProfileError(err instanceof Error ? err.message : String(err));
    }
  });

  const avatarMutation = useMutation({
    mutationFn: (file: File) => uploadAvatar(file),
    onSuccess: updated => {
      onAvatarUpdated(updated);
      setProfileError(undefined);
      setProfileMessage("Foto de perfil atualizada com sucesso.");
    },
    onError: err => {
      setProfileMessage(undefined);
      setProfileError(err instanceof Error ? err.message : String(err));
    }
  });

  const passwordMutation = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordError(undefined);
      setPasswordMessage("Senha alterada com sucesso.");
    },
    onError: err => {
      setPasswordMessage(undefined);
      setPasswordError(err instanceof Error ? err.message : String(err));
    }
  });

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: listUsers,
    enabled: isAdmin
  });

  const createUserMutation = useMutation({
    mutationFn: () =>
      createUser({
        username: newUsername,
        displayName: newUserDisplayName,
        password: newUserPassword,
        role: newUserRole
      }),
    onSuccess: created => {
      setNewUsername("");
      setNewUserDisplayName("");
      setNewUserPassword("");
      setNewUserRole("Guest");
      setUserMgmtError(undefined);
      setUserMgmtMessage(`Usuário @${created.username} criado com sucesso.`);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: err => {
      setUserMgmtMessage(undefined);
      setUserMgmtError(err instanceof Error ? err.message : String(err));
    }
  });

  const resetUserPasswordMutation = useMutation({
    mutationFn: ({ userId, password }: { userId: string; password: string }) =>
      resetUserPassword(userId, password),
    onSuccess: () => {
      setResetTargetUserId(null);
      setResetPasswordValue("");
      setUserMgmtError(undefined);
      setUserMgmtMessage("Senha do usuário redefinida com sucesso.");
    },
    onError: err => {
      setUserMgmtMessage(undefined);
      setUserMgmtError(err instanceof Error ? err.message : String(err));
    }
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId: string) => deleteUser(userId),
    onSuccess: () => {
      setUserMgmtError(undefined);
      setUserMgmtMessage("Usuário removido com sucesso.");
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: err => {
      setUserMgmtMessage(undefined);
      setUserMgmtError(err instanceof Error ? err.message : String(err));
    }
  });

  function handleProfileSubmit(event: FormEvent) {
    event.preventDefault();
    setProfileMessage(undefined);
    setProfileError(undefined);
    profileMutation.mutate();
  }

  function handlePasswordSubmit(event: FormEvent) {
    event.preventDefault();
    setPasswordMessage(undefined);
    setPasswordError(undefined);
    if (newPassword.length < 6) {
      setPasswordError("A nova senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("A confirmação da nova senha não confere.");
      return;
    }
    passwordMutation.mutate();
  }

  async function handleSaveApiUrl(event: FormEvent) {
    event.preventDefault();
    setApiStatus(undefined);
    setApiError(undefined);
    setApiUrl(apiUrlInput);
    try {
      const ok = await checkApiHealth(apiUrlInput);
      if (ok) {
        setApiStatus("URL salva e conexão verificada com sucesso (/health OK).");
      } else {
        setApiError("URL salva, porém o endpoint /health retornou erro.");
      }
    } catch {
      setApiError("URL salva, mas não foi possível alcançar o servidor no momento.");
    }
  }

  function handleCreateUserSubmit(event: FormEvent) {
    event.preventDefault();
    setUserMgmtMessage(undefined);
    setUserMgmtError(undefined);
    createUserMutation.mutate();
  }

  const initials =
    user.displayName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map(p => p[0]?.toUpperCase() ?? "")
      .join("") || "U";

  return (
    <div className="settings-grid">
      {/* Card 1 — Perfil do Usuário */}
      <section className="form-card">
        <div className="form-card-header">
          <h3>Perfil do Usuário</h3>
        </div>
        <form onSubmit={handleProfileSubmit} className="form-card-body">
          <div className="avatar-editor-row">
            <div className="avatar-preview-lg">
              {avatarUrl ? <img src={avatarUrl} alt={user.displayName} /> : <span>{initials}</span>}
            </div>
            <div className="avatar-editor-actions">
              <strong>{user.displayName}</strong>
              <small className="muted-text">
                Login: @{user.username} • Papel: {isAdmin ? "Mestre (Admin)" : "Convidado (Guest)"}
              </small>
              <div>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={avatarMutation.isPending}
                  onClick={() => avatarInputRef.current?.click()}
                >
                  {avatarMutation.isPending ? "Enviando foto..." : "Alterar Foto de Perfil"}
                </button>
                <input
                  ref={avatarInputRef}
                  hidden
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) avatarMutation.mutate(file);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
          </div>

          <label className="form-label">
            Nome de Exibição
            <input
              type="text"
              required
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
            />
          </label>

          {profileError && <p className="error">{profileError}</p>}
          {profileMessage && <p className="success-banner">{profileMessage}</p>}

          <div className="form-card-actions">
            <button type="submit" className="btn-primary" disabled={profileMutation.isPending}>
              {profileMutation.isPending ? "Salvando..." : "Salvar Perfil"}
            </button>
          </div>
        </form>
      </section>

      {/* Card 2 — Alterar Senha */}
      <section className="form-card">
        <div className="form-card-header">
          <h3>Alterar Senha</h3>
        </div>
        <form onSubmit={handlePasswordSubmit} className="form-card-body">
          <label className="form-label">
            Senha Atual
            <PasswordInput
              required
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
            />
          </label>

          <label className="form-label">
            Nova Senha (mínimo 6 caracteres)
            <PasswordInput
              required
              minLength={6}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
            />
          </label>

          <label className="form-label">
            Confirmar Nova Senha
            <PasswordInput
              required
              minLength={6}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
            />
          </label>

          {passwordError && <p className="error">{passwordError}</p>}
          {passwordMessage && <p className="success-banner">{passwordMessage}</p>}

          <div className="form-card-actions">
            <button type="submit" className="btn-primary" disabled={passwordMutation.isPending}>
              {passwordMutation.isPending ? "Atualizando..." : "Alterar Senha"}
            </button>
          </div>
        </form>
      </section>

      {/* Card 3 — Conexão da API */}
      <section className="form-card">
        <div className="form-card-header">
          <h3>Conexão do Servidor API</h3>
        </div>
        <form onSubmit={handleSaveApiUrl} className="form-card-body">
          <label className="form-label">
            URL da API (Backend GAIA BPMN)
            <input
              type="url"
              required
              value={apiUrlInput}
              onChange={e => setApiUrlInput(e.target.value)}
              placeholder="http://localhost:8080"
            />
          </label>

          {apiError && <p className="error">{apiError}</p>}
          {apiStatus && <p className="success-banner">{apiStatus}</p>}

          <div className="form-card-actions">
            <button type="submit" className="btn-primary">
              Salvar URL e Testar Conexão
            </button>
          </div>
        </form>
      </section>

      {/* Card 4 — Gerenciamento de Usuários (Exclusivo para Admin) */}
      {isAdmin && (
        <section className="form-card form-card-wide">
          <div className="form-card-header">
            <h3>Gerenciamento de Usuários (Exclusivo Mestre)</h3>
          </div>
          <div className="form-card-body">
            <form onSubmit={handleCreateUserSubmit} className="create-user-form">
              <div className="create-user-fields">
                <label className="form-label">
                  Usuário (Login)
                  <input
                    type="text"
                    required
                    placeholder="ex: convidado.ti"
                    value={newUsername}
                    onChange={e => setNewUsername(e.target.value)}
                  />
                </label>

                <label className="form-label">
                  Nome de Exibição
                  <input
                    type="text"
                    required
                    placeholder="ex: João Silva"
                    value={newUserDisplayName}
                    onChange={e => setNewUserDisplayName(e.target.value)}
                  />
                </label>

                <label className="form-label">
                  Senha Inicial
                  <PasswordInput
                    required
                    minLength={6}
                    placeholder="Mínimo 6 caracteres"
                    value={newUserPassword}
                    onChange={e => setNewUserPassword(e.target.value)}
                  />
                </label>

                <label className="form-label">
                  Papel de Acesso
                  <select
                    value={newUserRole}
                    onChange={e => setNewUserRole(e.target.value as UserRole)}
                  >
                    <option value="Guest">Convidado (Somente Leitura)</option>
                    <option value="Admin">Mestre (Admin Completo)</option>
                  </select>
                </label>
              </div>

              <div className="form-card-actions">
                <button type="submit" className="btn-primary" disabled={createUserMutation.isPending}>
                  {createUserMutation.isPending ? "Cadastrando..." : "+ Adicionar Usuário"}
                </button>
              </div>
            </form>

            {userMgmtError && <p className="error">{userMgmtError}</p>}
            {userMgmtMessage && <p className="success-banner">{userMgmtMessage}</p>}

            <div className="users-table-wrapper">
              <h4>Usuários Cadastrados</h4>
              {usersQuery.isLoading ? (
                <p className="status-message">Carregando usuários...</p>
              ) : (
                <table className="users-table">
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>Login</th>
                      <th>Papel</th>
                      <th>Criado em</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usersQuery.data?.map(item => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.displayName}</strong>
                        </td>
                        <td>@{item.username}</td>
                        <td>
                          <span
                            className={`role-badge ${
                              item.role === "Admin" ? "role-admin" : "role-guest"
                            }`}
                          >
                            {item.role === "Admin" ? "Mestre" : "Convidado"}
                          </span>
                        </td>
                        <td>{new Date(item.createdAt).toLocaleDateString()}</td>
                        <td>
                          <div className="user-row-actions">
                            {resetTargetUserId === item.id ? (
                              <div className="inline-reset-box">
                                <PasswordInput
                                  placeholder="Nova senha (mín. 6)"
                                  value={resetPasswordValue}
                                  onChange={e => setResetPasswordValue(e.target.value)}
                                />
                                <button
                                  type="button"
                                  className="btn-primary btn-xs"
                                  disabled={
                                    resetPasswordValue.length < 6 ||
                                    resetUserPasswordMutation.isPending
                                  }
                                  onClick={() =>
                                    resetUserPasswordMutation.mutate({
                                      userId: item.id,
                                      password: resetPasswordValue
                                    })
                                  }
                                >
                                  Confirmar
                                </button>
                                <button
                                  type="button"
                                  className="btn-secondary btn-xs"
                                  onClick={() => {
                                    setResetTargetUserId(null);
                                    setResetPasswordValue("");
                                  }}
                                >
                                  Cancelar
                                </button>
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="btn-secondary btn-xs"
                                  onClick={() => {
                                    setResetTargetUserId(item.id);
                                    setResetPasswordValue("");
                                  }}
                                >
                                  Resetar Senha
                                </button>
                                {item.id !== user.id && (
                                  <button
                                    type="button"
                                    className="btn-danger btn-xs"
                                    disabled={deleteUserMutation.isPending}
                                    onClick={() => {
                                      if (
                                        window.confirm(
                                          `Deseja realmente remover o usuário @${item.username}?`
                                        )
                                      ) {
                                        deleteUserMutation.mutate(item.id);
                                      }
                                    }}
                                  >
                                    Remover
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
