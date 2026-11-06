import { FormEvent, useState } from "react";
import { checkApiHealth, getApiUrl, login, setApiUrl, User } from "../api";
import { PasswordInput } from "../components/PasswordInput";

export function Login({ onSuccess }: { onSuccess: (user: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [showApiConfig, setShowApiConfig] = useState(false);
  const [apiUrlInput, setApiUrlInput] = useState(getApiUrl);
  const [apiFeedback, setApiFeedback] = useState<string>();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setLoading(true);
    try {
      const result = await login(username, password);
      onSuccess(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveApiUrl() {
    setApiUrl(apiUrlInput);
    setApiFeedback("Testando conexão...");
    try {
      const ok = await checkApiHealth(apiUrlInput);
      setApiFeedback(ok ? "Servidor API conectado com sucesso." : "Servidor respondeu com erro.");
    } catch {
      setApiFeedback("URL salva, mas não foi possível conectar ao servidor.");
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <div className="brand-bars" aria-hidden="true">
            <span className="brand-bar-left" />
            <span className="brand-bar-right" />
          </div>
          <h2 className="login-title">Login</h2>
          <p className="login-subtitle">GAIA BPMN — Gestão de Processos</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-stacked-inputs">
            <div>
              <label htmlFor="username" className="sr-only">
                Usuário
              </label>
              <input
                id="username"
                name="username"
                type="text"
                required
                autoComplete="username"
                autoFocus
                className="login-input login-input-top"
                placeholder="Usuário"
                value={username}
                onChange={e => setUsername(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                Senha
              </label>
              <PasswordInput
                id="password"
                name="password"
                required
                autoComplete="current-password"
                className="login-input login-input-bottom"
                placeholder="Senha"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
          </div>

          {error && <p className="error login-error">{error}</p>}

          <button type="submit" disabled={loading} className="btn-primary login-submit">
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <div className="login-api-config">
          <button
            type="button"
            className="login-api-toggle"
            onClick={() => setShowApiConfig(v => !v)}
          >
            {showApiConfig ? "Ocultar configuração do servidor API" : "Configurar servidor API"}
          </button>

          {showApiConfig && (
            <div className="login-api-box">
              <label className="form-label">
                URL do Servidor API
                <div className="inline-input-group">
                  <input
                    type="url"
                    value={apiUrlInput}
                    onChange={e => setApiUrlInput(e.target.value)}
                    placeholder="http://localhost:8080"
                  />
                  <button type="button" className="btn-secondary" onClick={handleSaveApiUrl}>
                    Salvar
                  </button>
                </div>
              </label>
              {apiFeedback && <small className="api-feedback">{apiFeedback}</small>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
