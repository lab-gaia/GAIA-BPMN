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

export function Organizations() {
  const queryClient = useQueryClient();
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string>();
  const [organizationName, setOrganizationName] = useState("");
  const [suborganizationName, setSuborganizationName] = useState("");

  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const suborganizations = useQuery({
    queryKey: ["suborganizations", selectedOrganizationId],
    queryFn: () => listSuborganizations(selectedOrganizationId!),
    enabled: Boolean(selectedOrganizationId)
  });
  const refreshOrganizations = () => {
    void queryClient.invalidateQueries({ queryKey: ["organizations"] });
    void queryClient.invalidateQueries({ queryKey: ["suborganizations"] });
  };
  const createOrganizationMutation = useMutation({
    mutationFn: () => createOrganization(organizationName),
    onSuccess: organization => {
      setOrganizationName("");
      setSelectedOrganizationId(organization.id);
      refreshOrganizations();
    }
  });
  const createSuborganizationMutation = useMutation({
    mutationFn: () => createSuborganization(selectedOrganizationId!, suborganizationName),
    onSuccess: () => {
      setSuborganizationName("");
      refreshOrganizations();
    }
  });
  const error = organizations.error
    ?? suborganizations.error
    ?? createOrganizationMutation.error
    ?? createSuborganizationMutation.error;

  const toggleOrganization = (organization: Organization) => {
    void updateOrganization(organization.id, organization.name, !organization.isActive).then(refreshOrganizations);
  };
  const toggleSuborganization = (suborganization: Suborganization) => {
    void updateSuborganization(
      suborganization.organizationId,
      suborganization.id,
      suborganization.name,
      !suborganization.isActive
    ).then(refreshOrganizations);
  };

  return (
    <div className="settings-container">
      <section className="settings-card">
        <div className="settings-card-header">
          <div>
            <h2>Organizações</h2>
            <p className="muted-text">Organize os contextos dos BPMNs e mantenha seus vínculos ativos.</p>
          </div>
        </div>
        <form
          className="settings-form-grid"
          onSubmit={event => {
            event.preventDefault();
            if (organizationName.trim()) createOrganizationMutation.mutate();
          }}
        >
          <label className="form-label">Nome da organização<input value={organizationName} onChange={event => setOrganizationName(event.target.value)} required /></label>
          <button type="submit" className="btn-primary" disabled={createOrganizationMutation.isPending}>Adicionar organização</button>
        </form>
        <div className="process-grid">
          {organizations.data?.map(organization => (
            <div
              className={`process-card ${selectedOrganizationId === organization.id ? "selected" : ""}`}
              key={organization.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedOrganizationId(organization.id)}
              onKeyDown={event => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedOrganizationId(organization.id);
                }
              }}
            >
              <strong className="process-card-title">{organization.name}</strong>
              <span className="process-card-file">{organization.isActive ? "Ativo" : "Inativo"}</span>
              <button type="button" className="btn-secondary btn-xs" onClick={event => { event.stopPropagation(); toggleOrganization(organization); }}>
                {organization.isActive ? "Inativar" : "Ativar"}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-header">
          <div>
            <h2>Subórgãos</h2>
            <p className="muted-text">{selectedOrganizationId ? "Subórgãos da organização selecionada." : "Selecione uma organização para administrar seus subórgãos."}</p>
          </div>
        </div>
        {selectedOrganizationId && (
          <>
            <form
              className="settings-form-grid"
              onSubmit={event => {
                event.preventDefault();
                if (suborganizationName.trim()) createSuborganizationMutation.mutate();
              }}
            >
              <label className="form-label">Nome do subórgão<input value={suborganizationName} onChange={event => setSuborganizationName(event.target.value)} required /></label>
              <button type="submit" className="btn-primary" disabled={createSuborganizationMutation.isPending}>Adicionar subórgão</button>
            </form>
            <div className="process-grid">
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
      {error && <p className="error">{error.message}</p>}
    </div>
  );
}
