import type { PanelSlot, WorkbenchPanel } from './contracts.ts';

const fallbackPanelSlot: PanelSlot = 'north-west';
export const workbenchPanelSlots: PanelSlot[] = [
  'north-west',
  'north-east',
  'south-west',
  'south-east',
];

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
    const requestedPanel = options.panels.find((panel) => panel.slot === options.requestedPanelSlot);

    if (!requestedPanel || requestedPanel.taskId === null || requestedPanel.taskId === options.taskId) {
      return options.requestedPanelSlot;
    }
  }

  return (
    options.panels.find((panel) => panel.taskId === null)?.slot ??
    options.panels[0]?.slot ??
    fallbackPanelSlot
  );
}

export function compareWorkbenchPanelSlots(left: PanelSlot, right: PanelSlot) {
  return workbenchPanelSlots.indexOf(left) - workbenchPanelSlots.indexOf(right);
}

export function listOtherWorkbenchPanelSlots(slot: PanelSlot) {
  return workbenchPanelSlots.filter((candidate) => candidate !== slot);
}
