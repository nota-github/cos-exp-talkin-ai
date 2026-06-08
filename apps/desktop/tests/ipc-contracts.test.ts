import assert from 'node:assert/strict';
import test from 'node:test';
import { createRendererDesktopClient } from '../src/renderer/lib/ipc/client.ts';
import { createDesktopIpcService, registerDesktopIpcHandlers } from '../src/main/ipc/register-ipc.ts';
import { createTalkinAIDesktopApi } from '../src/preload/bridge.ts';
import {
  commandNames,
  ipcChannels,
  queryNames,
  type DesktopInvalidationEvent,
} from '../src/shared/ipc/contracts.ts';

type Handler = (_event: unknown, request: unknown) => Promise<unknown> | unknown;
type EventListener = (_event: unknown, payload: unknown) => void;

function createFakeIpcRuntime() {
  const handlers = new Map<string, Handler>();
  const listeners = new Map<string, Set<EventListener>>();

  return {
    handlers,
    ipcMain: {
      handle(channel: string, listener: Handler) {
        handlers.set(channel, listener);
      },
    },
    ipcRenderer: {
      async invoke(channel: string, payload: unknown) {
        const handler = handlers.get(channel);
        assert.ok(handler, `No handler registered for ${channel}`);
        return handler({}, payload);
      },
      on(channel: string, listener: EventListener) {
        const current = listeners.get(channel) ?? new Set<EventListener>();
        current.add(listener);
        listeners.set(channel, current);
      },
      off(channel: string, listener: EventListener) {
        listeners.get(channel)?.delete(listener);
      },
    },
    broadcast(channel: string, payload: unknown) {
      for (const listener of listeners.get(channel) ?? []) {
        listener({}, payload);
      }
    },
  };
}

test('story-1.2:VAL-1 registers shared command and query channels from one contract map', () => {
  const runtime = createFakeIpcRuntime();

  registerDesktopIpcHandlers(runtime.ipcMain, {
    broadcast: runtime.broadcast,
  });

  assert.deepEqual(
    [...runtime.handlers.keys()].sort(),
    [
      ...commandNames.map((name) => ipcChannels.commands[name]),
      ...queryNames.map((name) => ipcChannels.queries[name]),
    ].sort(),
  );
});

test('story-1.2:VAL-2 preload bridge exposes only the allowed desktop IPC surface', () => {
  const runtime = createFakeIpcRuntime();
  const api = createTalkinAIDesktopApi(runtime.ipcRenderer, {
    channel: 'desktop-shell',
    platform: 'darwin',
  });

  assert.deepEqual(Object.keys(api).sort(), ['ipc', 'shell']);
  assert.deepEqual(Object.keys(api.ipc.commands).sort(), [...commandNames].sort());
  assert.deepEqual(Object.keys(api.ipc.queries).sort(), [...queryNames].sort());
  assert.deepEqual(Object.keys(api.ipc.events), ['onInvalidation']);
  assert.equal('ipcRenderer' in api, false);
  assert.equal('process' in api, false);
});

test('story-1.2:VAL-3 query and invalidation flow stay aligned through preload and renderer wrappers', async () => {
  const runtime = createFakeIpcRuntime();

  registerDesktopIpcHandlers(runtime.ipcMain, {
    broadcast: runtime.broadcast,
  });

  const api = createTalkinAIDesktopApi(runtime.ipcRenderer, {
    channel: 'desktop-shell',
    platform: 'darwin',
  });
  const client = createRendererDesktopClient(api);
  const receivedEvents: DesktopInvalidationEvent[] = [];

  const initialSettings = await client.queries.getSettings({});
  assert.equal(client.available, true);
  assert.equal(initialSettings.theme, 'system');

  const unsubscribe = client.events.onInvalidation((payload) => {
    receivedEvents.push(payload);
  });

  const updateResult = await client.commands.updateSettings({
    patch: {
      theme: 'dark',
      advancedPromptPreview: true,
    },
  });
  const nextSettings = await client.queries.getSettings({});

  unsubscribe();

  await client.commands.retryRun({
    runId: 'run-001',
  });

  assert.deepEqual(updateResult.updatedKeys.sort(), ['advancedPromptPreview', 'theme']);
  assert.equal(nextSettings.theme, 'dark');
  assert.equal(nextSettings.advancedPromptPreview, true);
  assert.equal(receivedEvents.length, 1);
  assert.equal(receivedEvents[0].source.type, 'command');
  assert.equal(receivedEvents[0].source.name, 'updateSettings');
  assert.deepEqual(receivedEvents[0].targets, [
    {
      kind: 'entity',
      entity: 'settings',
      ids: ['app-settings'],
    },
    {
      kind: 'projection',
      projection: 'settings',
    },
  ]);
});

test('renderer client reports bridge absence without exposing a fallback Node surface', () => {
  const client = createRendererDesktopClient(undefined);

  assert.equal(client.available, false);
  assert.equal(client.shell, null);
  assert.throws(() => client.events.onInvalidation(() => undefined), /bridge is unavailable/i);
});

test('desktop IPC service can be created without Electron runtime objects', async () => {
  const service = createDesktopIpcService();
  const settings = await service.queries.getSettings({});

  assert.equal(settings.defaultModel, 'gpt-4.1');
});
