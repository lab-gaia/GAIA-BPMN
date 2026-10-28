import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createOrganization,
  createSuborganization,
  listOrganizations,
  listSuborganizations,
  updateOrganization,
  updateSuborganization,
  type Organization,
  type Suborganization
} from "../api";

type RegistrationView = "organizations" | "suborganizations";

export function Registrations() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<RegistrationView>("organizations");
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string>();
  const [organizationName, setOrganizationName] = useState("");
  const [suborganizationName, setSuborganizationName] = useState("");

  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const suborganizations = useQuery({
    queryKey: ["suborganizations", selectedOrganizationId],
    queryFn: () => listSuborganizations(selectedOrganizationId!),
    enabled: Boolean(selectedOrganizationId)
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["organizations"] });
    void queryClient.invalidateQueries({ queryKey: ["suborganizations"] });
  };

  const createOrganizationMutation = useMutation({
    mutationFn: () => createOrganization(organizationName.trim()),
    onSuccess: organization => {
      setOrganizationName("");
      setSelectedOrganizationId(organization.id);
      refresh();
    }
  });
  const createSuborganizationMutation = useMutation({
    mutationFn: () => createSuborganization(selectedOrganizationId!, suborganizationName.trim()),
    onSuccess: () => {
      setSuborganizationName("");
      refresh();
    }
  });

  const error = organizations.error
    ?? suborganizations.error
    ?? createOrganizationMutation.error
    ?? createSuborganizationMutation.error;

  const toggleOrganization = (organization: Organization) => {
    void updateOrganization(organization.id, organization.name, !organization.isActive).then(refresh);
  };
  const toggleSuborganization = (suborganization: Suborganization) => {
    void updateSuborganization(
      suborganization.organizationId,
      suborganization.id,
      suborganization.name,
      !suborganization.isActive
    ).then(refresh);
  };
  const selectedOrganization = organizations.data?.find(item => item.id === selectedOrganizationId);

  return (
    <div className="settings-container">
      <section className="registration-menu" aria-label="Tipos de cadastro">
        <button
          type="button"
          className={`registration-menu-card ${view === "organizations" ? "selected" : ""}`}
          onClick={() => setView("organizations")}
        >
          <strong>Organizações</strong>
          <span>Cadastre e gerencie as organizações dos processos.</span>
        </button>
        <button
          type="button"
          className={`registration-menu-card ${view === "suborganizations" ? "selected" : ""}`}
          onClick={() => setView("suborganizations")}
        >
          <strong>Órgãos</strong>
          <span>Selecione uma organização para cadastrar seus órgãos.</span>
        </button>
      </section>

      {view === "organizations" ? (
        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <h2>Organizações</h2>
              <p className="muted-text">Cadastre e mantenha as organizações vinculadas aos BPMNs.</p>
            </div>
          </div>
          <form
            className="registration-form"
            onSubmit={event => {
              event.preventDefault();
              if (organizationName.trim()) createOrganizationMutation.mutate();
            }}
          >
            <label className="form-label">
              Nome da organização
              <input value={organizationName} onChange={event => setOrganizationName(event.target.value)} required />
            </label>
            <button type="submit" className="btn-primary" disabled={createOrganizationMutation.isPending}>
              Adicionar organização
            </button>
          </form>
          <div className="process-grid registration-list">
            {organizations.data?.map(organization => (
              <div className="process-card" key={organization.id}>
                <strong className="process-card-title">{organization.name}</strong>
                <span className="process-card-file">{organization.isActive ? "Ativa" : "Inativa"}</span>
                <button type="button" className="btn-secondary btn-xs" onClick={() => toggleOrganization(organization)}>
                  {organization.isActive ? "Inativar" : "Ativar"}
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <h2>Órgãos</h2>
              <p className="muted-text">Selecione uma organização para listar e cadastrar seus órgãos.</p>
            </div>
          </div>
          <label className="form-label registration-organization-select">
            Organização
            <select
              value={selectedOrganizationId ?? ""}
              onChange={event => setSelectedOrganizationId(event.target.value || undefined)}
            >
              <option value="">Selecione uma organização</option>
              {organizations.data?.filter(item => item.isActive).map(organization => (
                <option key={organization.id} value={organization.id}>{organization.name}</option>
              ))}
            </select>
          </label>
          {selectedOrganizationId && (
            <>
              <p className="registration-context">Órgãos de {selectedOrganization?.name ?? "organização selecionada"}</p>
              <form
                className="registration-form"
                onSubmit={event => {
                  event.preventDefault();
                  if (suborganizationName.trim()) createSuborganizationMutation.mutate();
                }}
              >
                <label className="form-label">
                  Nome do órgão
                  <input value={suborganizationName} onChange={event => setSuborganizationName(event.target.value)} required />
                </label>
                <button type="submit" className="btn-primary" disabled={createSuborganizationMutation.isPending}>
                  Adicionar órgão
                </button>
              </form>
              <div className="process-grid registration-list">
                {suborganizations.data?.map(suborganization => (
                  <div className="process-card" key={suborganization.id}>
                    <strong className="process-card-title">{suborganization.name}</strong>
                    <span className="process-card-file">{suborganization.isActive ? "Ativo" : "Inativo"}</span>
                    <button type="button" className="btn-secondary btn-xs" onClick={() => toggleSuborganization(suborganization)}>
                      {suborganization.isActive ? "Inativar" : "Ativar"}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}
      {error && <p className="error">{error.message}</p>}
    </div>
  );
}
