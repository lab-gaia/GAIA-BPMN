import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { importProcess, listOrganizations, listProcesses, listSuborganizations, User, type Process } from "../api";

function ProcessCard({ process, onOpen }: { process: Process; onOpen: (process: Process) => void }) {
  return (
    <button type="button" className="process-card" onClick={() => onOpen(process)}>
      <div className="process-card-top">
        <span className="process-key-pill">{process.externalKey}</span>
        <span className="process-task-counter">{process.taskCount} task(s)</span>
      </div>
      <strong className="process-card-title">{process.name}</strong>
      <span className="process-card-file">{process.suborganizationName}</span>
      <span className="process-card-file">{process.fileName ?? "Sem arquivo"}</span>
      <small className="process-card-date">Atualizado em {new Date(process.updatedAt).toLocaleString()}</small>
    </button>
  );
}

const recentProcessesStorageKey = "gaia.recentProcesses";

export function Home({ user, onOpen }: { user: User; onOpen: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string>();
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importOrganizationId, setImportOrganizationId] = useState("");
  const [importSuborganizationId, setImportSuborganizationId] = useState("");
  const [importFile, setImportFile] = useState<File>();
  const [recentProcessIds, setRecentProcessIds] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(recentProcessesStorageKey) ?? "[]") as unknown;
      return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string").slice(0, 5) : [];
    } catch {
      return [];
    }
  });

  const processes = useQuery({ queryKey: ["processes"], queryFn: listProcesses });
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const suborganizations = useQuery({
    queryKey: ["suborganizations", importOrganizationId],
    queryFn: () => listSuborganizations(importOrganizationId),
    enabled: Boolean(importOrganizationId)
  });
  const importer = useMutation({
    mutationFn: () => importProcess(importFile!, importSuborganizationId),
    onSuccess: process => {
      void queryClient.invalidateQueries({ queryKey: ["processes"] });
      setIsImportOpen(false);
      setImportFile(undefined);
      setImportOrganizationId("");
      setImportSuborganizationId("");
      onOpen(process.id);
    }
  });

  const activeOrganizations = organizations.data?.filter(item => item.isActive) ?? [];
  const selectedProcesses = processes.data?.filter(process => process.organizationId === selectedOrganizationId) ?? [];
  const recentProcesses = processes.data
    ? [
        ...recentProcessIds.map(id => processes.data?.find(process => process.id === id)).filter((process): process is Process => Boolean(process)),
        ...processes.data.filter(process => !recentProcessIds.includes(process.id))
      ].slice(0, 5)
    : [];
  const totalTasks = processes.data?.reduce((acc, process) => acc + process.taskCount, 0) ?? 0;

  function openImport() {
    setImportOrganizationId("");
    setImportSuborganizationId("");
    setImportFile(undefined);
    importer.reset();
    setIsImportOpen(true);
  }

  function openProcess(process: Process) {
    const storedIds = JSON.parse(localStorage.getItem(recentProcessesStorageKey) ?? "[]") as unknown;
    const recentIds = Array.isArray(storedIds) ? storedIds.filter((id): id is string => typeof id === "string") : [];
    localStorage.setItem(
      recentProcessesStorageKey,
      JSON.stringify([process.id, ...recentIds.filter(id => id !== process.id)].slice(0, 5))
    );
    setRecentProcessIds([process.id, ...recentIds.filter(id => id !== process.id)].slice(0, 5));
    onOpen(process.id);
  }

  return (
    <div className="home-container">
      <div className="kpi-banner">
        <div className="kpi-card">
          <span className="kpi-label">Organizações</span>
          <strong className="kpi-value">{activeOrganizations.length}</strong>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Processos mapeados</span>
          <strong className="kpi-value">{processes.data?.length ?? 0}</strong>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Tasks totais</span>
          <strong className="kpi-value">{totalTasks}</strong>
        </div>
        {user.role === "Admin" && (
          <button type="button" className="btn-primary import-button" onClick={openImport}>
            + Importar BPMN
          </button>
        )}
      </div>

      {processes.error && <p className="error">{processes.error.message}</p>}
      {organizations.error && <p className="error">{organizations.error.message}</p>}
      {processes.isLoading && <p className="status-message">Carregando processos...</p>}

      <section className="home-section">
        <div className="home-section-header">
          <div>
            <h2>Organizações</h2>
            <p className="muted-text">Selecione uma organização para visualizar seus BPMNs.</p>
          </div>
        </div>
        <div className="organization-grid">
          {activeOrganizations.map(organization => (
            <button
              type="button"
              className={`organization-card ${selectedOrganizationId === organization.id ? "selected" : ""}`}
              key={organization.id}
              onClick={() => setSelectedOrganizationId(organization.id)}
            >
              <strong>{organization.name}</strong>
              <span>{processes.data?.filter(process => process.organizationId === organization.id).length ?? 0} BPMN(s)</span>
            </button>
          ))}
        </div>
        {!organizations.isLoading && activeOrganizations.length === 0 && (
          <div className="empty-state-card">
            <h3>Nenhuma organização cadastrada</h3>
            <p className="muted-text">Cadastre uma organização para começar a organizar seus BPMNs.</p>
          </div>
        )}
      </section>

      {selectedOrganizationId && (
        <section className="home-section">
          <div className="home-section-header">
            <div>
              <h2>{activeOrganizations.find(item => item.id === selectedOrganizationId)?.name}</h2>
              <p className="muted-text">BPMNs desta organização.</p>
            </div>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setSelectedOrganizationId(undefined)}>
              Mostrar todas
            </button>
          </div>
          {selectedProcesses.length > 0 ? (
            <div className="process-grid">
              {selectedProcesses.map(process => <ProcessCard key={process.id} process={process} onOpen={openProcess} />)}
            </div>
          ) : (
            <div className="empty-state-card"><p className="muted-text">Nenhum BPMN nesta organização.</p></div>
          )}
        </section>
      )}

      <section className="home-section">
        <div className="home-section-header">
          <div>
            <h2>Mais recentes</h2>
            <p className="muted-text">Os cinco BPMNs abertos ou atualizados mais recentemente.</p>
          </div>
        </div>
        {recentProcesses.length > 0 ? (
          <div className="process-grid">
            {recentProcesses.map(process => <ProcessCard key={process.id} process={process} onOpen={openProcess} />)}
          </div>
        ) : (
          <div className="empty-state-card">
            <h3>Nenhum BPMN importado ainda</h3>
            <p className="muted-text">Use o botão “Importar BPMN” para carregar seu primeiro diagrama.</p>
          </div>
        )}
      </section>

      {isImportOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={event => {
          if (event.target === event.currentTarget) setIsImportOpen(false);
        }}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="import-title">
            <div className="modal-header">
              <div>
                <h2 id="import-title">Importar BPMN</h2>
                <p className="muted-text">Escolha a organização e o órgão do diagrama.</p>
              </div>
              <button type="button" className="modal-close" aria-label="Fechar" onClick={() => setIsImportOpen(false)}>×</button>
            </div>
            <div className="modal-form">
              <label className="form-label">
                Organização
                <select value={importOrganizationId} onChange={event => {
                  setImportOrganizationId(event.target.value);
                  setImportSuborganizationId("");
                }}>
                  <option value="">Selecione a organização</option>
                  {activeOrganizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="form-label">
                Órgão
                <select value={importSuborganizationId} disabled={!importOrganizationId} onChange={event => setImportSuborganizationId(event.target.value)}>
                  <option value="">Selecione o órgão</option>
                  {suborganizations.data?.filter(item => item.isActive).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="form-label">
                Arquivo BPMN
                <input type="file" accept=".bpmn" onChange={event => setImportFile(event.target.files?.[0])} />
              </label>
            </div>
            {importer.error && <p className="error">{importer.error.message}</p>}
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setIsImportOpen(false)}>Cancelar</button>
              <button
                type="button"
                className="btn-primary"
                disabled={importer.isPending || !importSuborganizationId || !importFile}
                onClick={() => importer.mutate()}
              >
                {importer.isPending ? "Importando..." : "Importar BPMN"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
