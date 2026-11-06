import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteAttachment,
  downloadAttachment,
  printAttachment,
  downloadDiagram,
  getDiagram,
  getTasks,
  saveTasks,
  uploadAttachments,
  type Attachment,
  type Task,
  type User
} from "../api";
import { BpmnViewer } from "../components/BpmnViewer";
import { TaskPanel } from "../components/TaskPanel";

export function ProcessView({
  processId,
  user,
  onHome
}: {
  processId: string;
  user: User;
  onHome: () => void;
}) {
  const isReadOnly = user.role !== "Admin";
  const diagram = useQuery({ queryKey: ["diagram", processId], queryFn: () => getDiagram(processId) });
  const tasksQuery = useQuery({ queryKey: ["tasks", processId], queryFn: () => getTasks(processId) });
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [tasks, setTasks] = useState<Task[]>();
  const currentTasks = tasks ?? tasksQuery.data ?? [];
  const selected = currentTasks.find(task => task.externalElementId === selectedId);
  const select = useCallback((id: string) => setSelectedId(id), []);
  const [exportSvg, setExportSvg] = useState<(() => Promise<string>)>();
  const registerExportSvg = useCallback((callback: (() => Promise<string>) | undefined) => {
    setExportSvg(callback ? () => callback : undefined);
  }, []);
  const [dirty, setDirty] = useState(false);
  const [printError, setPrintError] = useState<string>();

  const save = useMutation({
    mutationFn: () => saveTasks(processId, currentTasks),
    onSuccess: () => {
      setTasks(undefined);
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ["tasks", processId] });
      void queryClient.invalidateQueries({ queryKey: ["diagram", processId] });
    }
  });

  const upload = useMutation({
    mutationFn: (files: File[]) =>
      selected ? uploadAttachments(selected.elementId, files) : Promise.resolve([] as Attachment[]),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["tasks", processId] })
  });

  const remove = useMutation({
    mutationFn: deleteAttachment,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["tasks", processId] })
  });

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty && !isReadOnly) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, isReadOnly]);

  const leave = () => {
    if (isReadOnly || !dirty || window.confirm("Há alterações não salvas. Sair mesmo assim?")) {
      onHome();
    }
  };

  const download = async (result: Promise<{ blob: Blob; fileName?: string }>, fallback: string) => {
    const file = await result;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file.blob);
    link.download = file.fileName ?? fallback;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const printProcess = async () => {
    setPrintError(undefined);
    if (!exportSvg) {
      throw new Error("O diagrama ainda não está pronto para impressão.");
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      throw new Error("Não foi possível abrir a visualização para impressão. Verifique se o navegador bloqueou popups.");
    }

    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8">
          <title>Preparando impressão...</title>
          <style>body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #172b4d; }</style>
        </head>
        <body>
          <p>Preparando documento para impressão...</p>
        </body>
      </html>`);
    printWindow.document.close();

    try {
      const svg = await exportSvg();
      const cleanSvg = svg
        .replace(/<\?xml[\s\S]*?\?>/i, "")
        .replace(/<!DOCTYPE[\s\S]*?>/i, "")
        .trim();

      const filledTasks = currentTasks.filter(task =>
        task.description?.trim() || task.input?.trim() || task.output?.trim() || task.resources?.trim() || task.instructions?.trim()
      );
      const escapeHtml = (value: string) =>
        value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const field = (label: string, value: string | null) =>
        value?.trim()
          ? `<section class="field"><h3>${label}</h3><p>${escapeHtml(value)}</p></section>`
          : "";
      const taskPages = filledTasks.map(task => `
        <article class="task-page">
          <h2>${escapeHtml(task.name || task.externalElementId)}</h2>
          ${field("Descrição", task.description)}
          ${field("Input", task.input)}
          ${field("Output", task.output)}
          ${field("Recursos necessários", task.resources)}
          ${field("Instruções", task.instructions)}
        </article>
      `).join("");

      const html = `<!doctype html>
        <html lang="pt-BR">
          <head>
            <meta charset="utf-8">
            <title>Impressão do BPMN</title>
            <style>
              @page { size: A4 portrait; margin: 10mm; }
              * { box-sizing: border-box; }
              html, body { margin: 0; width: 210mm; color: #172b4d; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background: #fff; }
              .diagram-page { width: 190mm; height: 277mm; display: flex; flex-direction: column; page-break-after: always; break-after: page; overflow: hidden; }
              .diagram-page h1 { margin: 0 0 6mm; flex: 0 0 auto; font-size: 18px; color: #0f4e5c; }
              .diagram { position: relative; flex: 1; width: 190mm; min-height: 0; overflow: hidden; }
              .diagram-frame { position: absolute; top: 50%; left: 50%; width: 255mm; height: 180mm; display: flex; align-items: center; justify-content: center; transform: translate(-50%, -50%) rotate(90deg); transform-origin: center center; }
              .diagram-frame svg { max-width: 100%; max-height: 100%; width: auto; height: auto; }
              .task-page { width: 190mm; min-height: 277mm; page-break-after: always; break-after: page; padding-top: 4mm; }
              .task-page:last-child { page-break-after: auto; break-after: auto; }
              .task-page h2 { margin: 0 0 8mm; font-size: 18px; border-bottom: 2px solid #17b9c0; padding-bottom: 3mm; color: #0f4e5c; }
              .field { margin: 0 0 6mm; }
              .field h3 { margin: 0 0 2mm; font-size: 11px; color: #5e6c84; text-transform: uppercase; letter-spacing: 0.5px; }
              .field p { margin: 0; font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
            </style>
          </head>
          <body>
            <article class="diagram-page">
              <h1>Diagrama BPMN</h1>
              <div class="diagram"><div class="diagram-frame">${cleanSvg}</div></div>
            </article>
            ${taskPages}
            <script>
              function triggerPrint() {
                window.focus();
                setTimeout(function() {
                  window.print();
                }, 250);
              }
              if (document.readyState === 'complete') {
                triggerPrint();
              } else {
                window.addEventListener('load', triggerPrint);
              }
            </script>
          </body>
        </html>`;

      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
    } catch (error) {
      try {
        printWindow.close();
      } catch {
        // Window already closed
      }
      throw error;
    }
  };

  if (diagram.isLoading || tasksQuery.isLoading) {
    return <p className="status-message">Carregando processo...</p>;
  }

  if (diagram.error || tasksQuery.error || !diagram.data) {
    return (
      <div className="process-view">
        <p className="error">{(diagram.error ?? tasksQuery.error)?.message ?? "Falha ao carregar processo."}</p>
        <button type="button" className="btn-secondary" onClick={onHome}>
          Voltar para Processos
        </button>
      </div>
    );
  }

  return (
    <div className="process-view">
      <div className="process-toolbar">
        <button type="button" className="btn-secondary" onClick={leave}>
          ← Voltar para Processos
        </button>

        <div className="process-toolbar-right">
          {isReadOnly && (
            <span className="readonly-banner-tag">
              Modo Convidado: Visualização e download liberados
            </span>
          )}
          {!isReadOnly && dirty && <span className="unsaved-badge">Alterações não salvas</span>}
          {!isReadOnly && (
            <button
              type="button"
              className="btn-primary"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Salvando..." : "Salvar"}
            </button>
          )}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void download(downloadDiagram(processId), "diagram.bpmn")}
          >
            Baixar BPMN
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!exportSvg}
            onClick={() => void printProcess().catch(error => setPrintError(error instanceof Error ? error.message : "Falha ao preparar a impressão."))}
          >
            Imprimir BPMN
          </button>
        </div>
      </div>

      {(save.error || upload.error || remove.error || printError) && (
        <p className="error">{printError ?? (save.error ?? upload.error ?? remove.error)?.message}</p>
      )}

      <section className="viewer-layout">
        <BpmnViewer
          xml={diagram.data}
          tasks={currentTasks}
          selectedId={selectedId}
          onSelect={select}
          onExportSvg={registerExportSvg}
        />
        <TaskPanel
          task={selected}
          readOnly={isReadOnly}
          onChange={(field, value) => {
            if (isReadOnly) return;
            setTasks(
              currentTasks.map(item =>
                item.externalElementId === selectedId ? { ...item, [field]: value } : item
              )
            );
            setDirty(true);
          }}
          onUpload={files => {
            if (!isReadOnly) upload.mutate(files);
          }}
          onDownload={attachment => void download(downloadAttachment(attachment.id), attachment.fileName)}
          onPrint={attachment => void printAttachment(attachment.id)}
          onDelete={attachment => {
            if (!isReadOnly) remove.mutate(attachment.id);
          }}
        />
      </section>
    </div>
  );
}
