import type { PanelSlot, WorkbenchPanel } from './contracts.ts';

const fallbackPanelSlot: PanelSlot = 'north-west';

export function findWorkbenchPanelForTask(
  panels: WorkbenchPanel[],
  taskId: string,
): WorkbenchPanel | null {
  return panels.find((panel) => panel.taskId === taskId) ?? null;
}

export function resolveWorkbenchPanelSlot(options: {
  panels: WorkbenchPanel[];
  taskId: string;
  requestedPanelSlot?: PanelSlot;
}): PanelSlot {
  const existingPanel = findWorkbenchPanelForTask(options.panels, options.taskId);

  if (existingPanel) {
    return existingPanel.slot;
  }

  if (options.requestedPanelSlot) {
    return options.requestedPanelSlot;
  }

  return options.panels.find((panel) => panel.taskId === null)?.slot ?? options.panels[0]?.slot ?? fallbackPanelSlot;
}
