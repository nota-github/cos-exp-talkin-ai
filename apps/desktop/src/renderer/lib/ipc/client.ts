import type { TalkinAIDesktopApi } from '../../../shared/ipc/contracts';

export type RendererDesktopClient = {
  available: boolean;
  shell: TalkinAIDesktopApi['shell'] | null;
  commands: TalkinAIDesktopApi['ipc']['commands'];
  queries: TalkinAIDesktopApi['ipc']['queries'];
  events: TalkinAIDesktopApi['ipc']['events'];
};

function createUnavailableProxy(sectionName: string) {
  return new Proxy(
    {},
    {
      get() {
        return () => {
          throw new Error(
            `Talkin AI desktop bridge is unavailable. Cannot access ${sectionName} in this renderer context.`,
          );
        };
      },
    },
  );
}

export function createRendererDesktopClient(
  api?: TalkinAIDesktopApi,
): RendererDesktopClient {
  const resolvedApi = api ?? (typeof window === 'undefined' ? undefined : window.talkinAI);

  if (!resolvedApi) {
    return {
      available: false,
      shell: null,
      commands: createUnavailableProxy('commands') as RendererDesktopClient['commands'],
      queries: createUnavailableProxy('queries') as RendererDesktopClient['queries'],
      events: createUnavailableProxy('events') as RendererDesktopClient['events'],
    };
  }

  return {
    available: true,
    shell: resolvedApi.shell,
    commands: resolvedApi.ipc.commands,
    queries: resolvedApi.ipc.queries,
    events: resolvedApi.ipc.events,
  };
}
