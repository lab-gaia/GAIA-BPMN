import { useEffect, useRef, useState } from "react";
import NavigatedViewer from "bpmn-js/lib/NavigatedViewer";
import type { Task } from "../api";

export function BpmnViewer({ xml, tasks, selectedId, onSelect }: { xml: string; tasks: Task[]; selectedId?: string; onSelect: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<NavigatedViewer>();
  const [imported, setImported] = useState(false);

  function zoomIn() {
    const canvas = viewer.current?.get("canvas") as { zoom: (value?: number | string) => number } | undefined;
    if (!canvas) return;
    canvas.zoom(canvas.zoom() * 1.2);
  }

  function zoomOut() {
    const canvas = viewer.current?.get("canvas") as { zoom: (value?: number | string) => number } | undefined;
    if (!canvas) return;
    canvas.zoom(canvas.zoom() / 1.2);
  }

  function fitViewport() {
    const canvas = viewer.current?.get("canvas") as { zoom: (value?: number | string) => number } | undefined;
    canvas?.zoom("fit-viewport");
  }

  useEffect(() => {
    if (!host.current) return;
    setImported(false);
    const instance = new NavigatedViewer({ container: host.current });
    viewer.current = instance;
    let active = true;
    const select = (event: { element: { id: string; type: string } }) => {
      const { type } = event.element;
      const isBusinessElement = type.startsWith("bpmn:")
        && !type.endsWith("Flow")
        && !["bpmn:Association", "bpmn:TextAnnotation", "bpmn:Group", "label"].includes(type);
      if (isBusinessElement) onSelect(event.element.id);
    };
    instance.on("element.click", select);
    void instance.importXML(xml).then(() => {
      if (!active) return;
      (instance.get("canvas") as { zoom: (mode: string) => void }).zoom("fit-viewport");
      setImported(true);
    }).catch(error => {
      if (active) console.error("Failed to import BPMN diagram.", error);
    });
    return () => {
      active = false;
      instance.destroy();
      viewer.current = undefined;
    };
  }, [xml, onSelect]);
  useEffect(() => {
    const canvas = viewer.current?.get("canvas") as { addMarker: (id: string, marker: string) => void; removeMarker: (id: string, marker: string) => void } | undefined;
    const elementRegistry = viewer.current?.get("elementRegistry") as { get: (id: string) => unknown } | undefined;
    if (!imported || !canvas || !elementRegistry) return;
    const appliedIds = new Set<string>();
    tasks.forEach(task => {
      if (!elementRegistry.get(task.externalElementId)) return;
      const marker = task.input || task.output || task.description || task.resources || task.instructions
        ? "has-values"
        : "no-values";
      canvas.addMarker(task.externalElementId, marker);
      if (selectedId === task.externalElementId) canvas.addMarker(task.externalElementId, "selected");
      appliedIds.add(task.externalElementId);
    });
    return () => appliedIds.forEach(id => { canvas.removeMarker(id, "has-values"); canvas.removeMarker(id, "no-values"); canvas.removeMarker(id, "selected"); });
  }, [tasks, selectedId, imported]);
  return (
    <div className="bpmn-canvas">
      <div className="bpmn-zoom-controls" aria-label="Controles de zoom">
        <button type="button" onClick={zoomIn} aria-label="Aumentar zoom" title="Aumentar zoom">
          +
        </button>
        <button type="button" onClick={zoomOut} aria-label="Diminuir zoom" title="Diminuir zoom">
          −
        </button>
        <button type="button" onClick={fitViewport} aria-label="Enquadrar diagrama" title="Enquadrar diagrama">
          ⛶
        </button>
      </div>
      <div className="bpmn-canvas-host" ref={host} />
    </div>
  );
}
