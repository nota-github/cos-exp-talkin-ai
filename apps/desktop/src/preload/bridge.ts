import {
  type DesktopCommandRequest,
  type DesktopCommandResponse,
  type DesktopInvalidationEvent,
  type DesktopQueryRequest,
  type DesktopQueryResponse,
  type DesktopShellInfo,
  type TalkinAIDesktopApi,
  ipcChannels,
} from '../shared/ipc/contracts';

type DesktopIpcRendererListener = (_event: unknown, payload: DesktopInvalidationEvent) => void;

export type DesktopIpcRendererLike = {
  invoke: (channel: string, payload: unknown) => Promise<unknown>;
  on: (channel: string, listener: DesktopIpcRendererListener) => void;
  off: (channel: string, listener: DesktopIpcRendererListener) => void;
};

function invokeCommand<TName extends keyof typeof ipcChannels.commands>(
  ipcRenderer: DesktopIpcRendererLike,
  name: TName,
  request: DesktopCommandRequest<TName>,
) {
  return ipcRenderer.invoke(
    ipcChannels.commands[name],
    request,
  ) as Promise<DesktopCommandResponse<TName>>;
}

function invokeQuery<TName extends keyof typeof ipcChannels.queries>(
  ipcRenderer: DesktopIpcRendererLike,
  name: TName,
  request: DesktopQueryRequest<TName>,
) {
  return ipcRenderer.invoke(
    ipcChannels.queries[name],
    request,
  ) as Promise<DesktopQueryResponse<TName>>;
}

export function createTalkinAIDesktopApi(
  ipcRenderer: DesktopIpcRendererLike,
  shell: DesktopShellInfo,
): TalkinAIDesktopApi {
  return {
    shell,
    ipc: {
      commands: {
        submitPrompt: (request) => invokeCommand(ipcRenderer, 'submitPrompt', request),
        retryRun: (request) => invokeCommand(ipcRenderer, 'retryRun', request),
        createProject: (request) => invokeCommand(ipcRenderer, 'createProject', request),
        updateProject: (request) => invokeCommand(ipcRenderer, 'updateProject', request),
        setTaskProject: (request) => invokeCommand(ipcRenderer, 'setTaskProject', request),
        openInWorkbench: (request) => invokeCommand(ipcRenderer, 'openInWorkbench', request),
        moveWorkbenchPanel: (request) =>
          invokeCommand(ipcRenderer, 'moveWorkbenchPanel', request),
        closeWorkbenchPanel: (request) =>
          invokeCommand(ipcRenderer, 'closeWorkbenchPanel', request),
        moveTaskStatus: (request) => invokeCommand(ipcRenderer, 'moveTaskStatus', request),
        updateSettings: (request) => invokeCommand(ipcRenderer, 'updateSettings', request),
      },
      queries: {
        getChatFeed: (request) => invokeQuery(ipcRenderer, 'getChatFeed', request),
        getWorkbenchLayout: (request) => invokeQuery(ipcRenderer, 'getWorkbenchLayout', request),
        getBoardColumns: (request) => invokeQuery(ipcRenderer, 'getBoardColumns', request),
        getProjectList: (request) => invokeQuery(ipcRenderer, 'getProjectList', request),
        getProjectDetail: (request) => invokeQuery(ipcRenderer, 'getProjectDetail', request),
        getUsageDashboard: (request) => invokeQuery(ipcRenderer, 'getUsageDashboard', request),
        getHistoryFeed: (request) => invokeQuery(ipcRenderer, 'getHistoryFeed', request),
        getHistoryEntry: (request) => invokeQuery(ipcRenderer, 'getHistoryEntry', request),
        getSettings: (request) => invokeQuery(ipcRenderer, 'getSettings', request),
      },
      events: {
        onInvalidation: (listener) => {
          const wrappedListener: DesktopIpcRendererListener = (_event, payload) => {
            listener(payload);
          };

          ipcRenderer.on(ipcChannels.events.invalidated, wrappedListener);

          return () => {
            ipcRenderer.off(ipcChannels.events.invalidated, wrappedListener);
          };
        },
      },
    },
  };
}
