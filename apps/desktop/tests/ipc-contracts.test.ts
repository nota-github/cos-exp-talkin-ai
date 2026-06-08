import assert from 'node:assert/strict';
import test from 'node:test';
import { createRendererDesktopClient } from '../src/renderer/lib/ipc/client.ts';
import {
  createDesktopQueryDescriptor,
  DesktopQueryCache,
} from '../src/renderer/lib/ipc/query-client.ts';
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
  const invocations: string[] = [];

  return {
    handlers,
    invocations,
    ipcMain: {
      handle(channel: string, listener: Handler) {
        handlers.set(channel, listener);
      },
    },
    ipcRenderer: {
      async invoke(channel: string, payload: unknown) {
        invocations.push(channel);
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

function delayFirstHandlerResponse(
  runtime: ReturnType<typeof createFakeIpcRuntime>,
  channel: string,
  gate: Promise<void>,
) {
  const originalHandler = runtime.handlers.get(channel);
  assert.ok(originalHandler, `No handler registered for ${channel}`);
  let callCount = 0;

  runtime.handlers.set(channel, async (event, payload) => {
    callCount += 1;
    const result = await originalHandler(event, payload);

    if (callCount === 1) {
      await gate;
    }

    return result;
  });
}

async function waitFor(assertion: () => boolean, label: string) {
  const timeoutAt = Date.now() + 1000;

  while (!assertion()) {
    if (Date.now() > timeoutAt) {
      throw new Error(`Timed out waiting for ${label}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
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
    {
      kind: 'projection',
      projection: 'connectionHealth',
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

test('story-1.5:VAL-1 and story-1.5:VAL-3 renderer query cache refetches chat feed through main/preload invalidation flow', async () => {
  const runtime = createFakeIpcRuntime();

  registerDesktopIpcHandlers(runtime.ipcMain, {
    broadcast: runtime.broadcast,
  });

  const api = createTalkinAIDesktopApi(runtime.ipcRenderer, {
    channel: 'desktop-shell',
    platform: 'darwin',
  });
  const client = createRendererDesktopClient(api);
  const queryCache = new DesktopQueryCache(client);
  const chatFeedQuery = createDesktopQueryDescriptor('getChatFeed', {});

  try {
    const initialFeed = await queryCache.fetchQuery(chatFeedQuery);
    assert.equal(initialFeed.items.length, 3);

    await client.commands.submitPrompt({
      promptKo: '고객 지원 운영 체크리스트를 한국어로 정리해줘.',
      selectedModel: 'gpt-4.1',
      optimizationMode: 'balanced',
    });

    await waitFor(
      () => queryCache.getSnapshot(chatFeedQuery).data?.items.length === 4,
      'chat feed refetch after submitPrompt',
    );

    const snapshot = queryCache.getSnapshot(chatFeedQuery);
    const chatFeedQueryCalls = runtime.invocations.filter(
      (channel) => channel === ipcChannels.queries.getChatFeed,
    ).length;

    assert.equal(snapshot.status, 'success');
    assert.ok(snapshot.data);
    assert.equal(snapshot.data.items[0]?.preview, '고객 지원 운영 체크리스트를 한국어로 정리해줘.');
    assert.equal(chatFeedQueryCalls, 2);
  } finally {
    queryCache.dispose();
  }
});

test('story-1.5:AC-1 and story-1.5:VAL-1 submitPrompt invalidates usage dashboard queries', async () => {
  const runtime = createFakeIpcRuntime();

  registerDesktopIpcHandlers(runtime.ipcMain, {
    broadcast: runtime.broadcast,
  });

  const api = createTalkinAIDesktopApi(runtime.ipcRenderer, {
    channel: 'desktop-shell',
    platform: 'darwin',
  });
  const client = createRendererDesktopClient(api);
  const queryCache = new DesktopQueryCache(client);
  const monthDashboardQuery = createDesktopQueryDescriptor('getUsageDashboard', { range: 'month' });
  const allTimeDashboardQuery = createDesktopQueryDescriptor('getUsageDashboard', { range: 'all_time' });
  const promptKo = '고객 지원 운영 체크리스트를 한국어로 정리해줘.';
  const baselineDelta = Math.max(promptKo.length * 3, 280);
  const optimizedDelta = Math.max(Math.floor(baselineDelta * 0.61), 170);

  try {
    const initialMonthDashboard = await queryCache.fetchQuery(monthDashboardQuery);
    const initialAllTimeDashboard = await queryCache.fetchQuery(allTimeDashboardQuery);

    await client.commands.submitPrompt({
      promptKo,
      selectedModel: 'gpt-4.1',
      optimizationMode: 'balanced',
    });

    await waitFor(
      () =>
        queryCache.getSnapshot(monthDashboardQuery).data?.totals.baselineTokens ===
          initialMonthDashboard.totals.baselineTokens + baselineDelta &&
        queryCache.getSnapshot(allTimeDashboardQuery).data?.totals.baselineTokens ===
          initialAllTimeDashboard.totals.baselineTokens + baselineDelta,
      'usage dashboard refetch after submitPrompt',
    );

    const monthSnapshot = queryCache.getSnapshot(monthDashboardQuery);
    const allTimeSnapshot = queryCache.getSnapshot(allTimeDashboardQuery);
    const usageDashboardQueryCalls = runtime.invocations.filter(
      (channel) => channel === ipcChannels.queries.getUsageDashboard,
    ).length;

    assert.equal(monthSnapshot.status, 'success');
    assert.equal(allTimeSnapshot.status, 'success');
    assert.equal(
      monthSnapshot.data?.totals.baselineTokens,
      initialMonthDashboard.totals.baselineTokens + baselineDelta,
    );
    assert.equal(
      monthSnapshot.data?.totals.optimizedTokens,
      initialMonthDashboard.totals.optimizedTokens + optimizedDelta,
    );
    assert.equal(
      allTimeSnapshot.data?.totals.baselineTokens,
      initialAllTimeDashboard.totals.baselineTokens + baselineDelta,
    );
    assert.equal(
      allTimeSnapshot.data?.totals.optimizedTokens,
      initialAllTimeDashboard.totals.optimizedTokens + optimizedDelta,
    );
    assert.equal(usageDashboardQueryCalls, 4);
  } finally {
    queryCache.dispose();
  }
});

test('story-1.5:VAL-1 and story-1.5:VAL-3 queues a second refetch when invalidation arrives during in-flight queries', async () => {
  const runtime = createFakeIpcRuntime();
  let releaseChatFeed!: () => void;
  let releaseMonthDashboard!: () => void;
  const chatFeedGate = new Promise<void>((resolve) => {
    releaseChatFeed = resolve;
  });
  const monthDashboardGate = new Promise<void>((resolve) => {
    releaseMonthDashboard = resolve;
  });

  registerDesktopIpcHandlers(runtime.ipcMain, {
    broadcast: runtime.broadcast,
  });

  delayFirstHandlerResponse(runtime, ipcChannels.queries.getChatFeed, chatFeedGate);
  delayFirstHandlerResponse(runtime, ipcChannels.queries.getUsageDashboard, monthDashboardGate);

  const api = createTalkinAIDesktopApi(runtime.ipcRenderer, {
    channel: 'desktop-shell',
    platform: 'darwin',
  });
  const client = createRendererDesktopClient(api);
  const queryCache = new DesktopQueryCache(client);
  const chatFeedQuery = createDesktopQueryDescriptor('getChatFeed', {});
  const monthDashboardQuery = createDesktopQueryDescriptor('getUsageDashboard', { range: 'month' });
  const promptKo = '고객 지원 운영 체크리스트를 한국어로 정리해줘.';
  const baselineDelta = Math.max(promptKo.length * 3, 280);

  try {
    const initialChatFeedFetch = queryCache.fetchQuery(chatFeedQuery);
    const initialMonthDashboardFetch = queryCache.fetchQuery(monthDashboardQuery);

    await waitFor(
      () =>
        queryCache.getSnapshot(chatFeedQuery).status === 'loading' &&
        queryCache.getSnapshot(monthDashboardQuery).status === 'loading',
      'delayed chat feed and usage dashboard queries to enter loading state',
    );

    await client.commands.submitPrompt({
      promptKo,
      selectedModel: 'gpt-4.1',
      optimizationMode: 'balanced',
    });

    releaseChatFeed();
    releaseMonthDashboard();

    await Promise.allSettled([initialChatFeedFetch, initialMonthDashboardFetch]);

    await waitFor(
      () =>
        queryCache.getSnapshot(chatFeedQuery).data?.items.length === 4 &&
        queryCache.getSnapshot(monthDashboardQuery).data?.totals.baselineTokens ===
          18240 + baselineDelta,
      'second refetch to win after delayed stale query response',
    );

    const chatFeedSnapshot = queryCache.getSnapshot(chatFeedQuery);
    const monthDashboardSnapshot = queryCache.getSnapshot(monthDashboardQuery);
    const chatFeedQueryCalls = runtime.invocations.filter(
      (channel) => channel === ipcChannels.queries.getChatFeed,
    ).length;
    const usageDashboardQueryCalls = runtime.invocations.filter(
      (channel) => channel === ipcChannels.queries.getUsageDashboard,
    ).length;

    assert.equal(chatFeedSnapshot.status, 'success');
    assert.equal(monthDashboardSnapshot.status, 'success');
    assert.equal(chatFeedSnapshot.data?.items[0]?.preview, promptKo);
    assert.equal(
      monthDashboardSnapshot.data?.totals.baselineTokens,
      18240 + baselineDelta,
    );
    assert.equal(chatFeedQueryCalls, 2);
    assert.equal(usageDashboardQueryCalls, 2);
  } finally {
    queryCache.dispose();
  }
});

test('story-1.5:VAL-2 failed commit does not broadcast invalidation or mutate renderer query state', async () => {
  const runtime = createFakeIpcRuntime();
  const receivedEvents: DesktopInvalidationEvent[] = [];

  registerDesktopIpcHandlers(runtime.ipcMain, {
    broadcast: (channel, payload) => {
      runtime.broadcast(channel, payload);
      receivedEvents.push(payload as DesktopInvalidationEvent);
    },
    commitMutation(commandName) {
      if (commandName === 'submitPrompt') {
        throw new Error('forced commit rollback');
      }
    },
  });

  const api = createTalkinAIDesktopApi(runtime.ipcRenderer, {
    channel: 'desktop-shell',
    platform: 'darwin',
  });
  const client = createRendererDesktopClient(api);
  const queryCache = new DesktopQueryCache(client);
  const chatFeedQuery = createDesktopQueryDescriptor('getChatFeed', {});

  try {
    const initialFeed = await queryCache.fetchQuery(chatFeedQuery);
    assert.equal(initialFeed.items.length, 3);

    await assert.rejects(
      client.commands.submitPrompt({
        promptKo: 'rollback 테스트용 요청입니다.',
        selectedModel: 'claude-sonnet-4',
        optimizationMode: 'quality',
      }),
      /forced commit rollback/,
    );

    await new Promise((resolve) => setTimeout(resolve, 25));

    const snapshot = queryCache.getSnapshot(chatFeedQuery);
    const directFeed = await client.queries.getChatFeed({});
    const chatFeedQueryCalls = runtime.invocations.filter(
      (channel) => channel === ipcChannels.queries.getChatFeed,
    ).length;

    assert.equal(receivedEvents.length, 0);
    assert.equal(snapshot.data?.items.length, 3);
    assert.equal(directFeed.items.length, 3);
    assert.equal(chatFeedQueryCalls, 2);
  } finally {
    queryCache.dispose();
  }
});

test('story-1.5:SCOPE-3 and story-1.5:VAL-2 failed updateSettings commit leaves settings query unchanged', async () => {
  const runtime = createFakeIpcRuntime();
  const receivedEvents: DesktopInvalidationEvent[] = [];

  registerDesktopIpcHandlers(runtime.ipcMain, {
    broadcast: (channel, payload) => {
      runtime.broadcast(channel, payload);
      receivedEvents.push(payload as DesktopInvalidationEvent);
    },
    commitMutation(commandName) {
      if (commandName === 'updateSettings') {
        throw new Error('forced settings commit rollback');
      }
    },
  });

  const api = createTalkinAIDesktopApi(runtime.ipcRenderer, {
    channel: 'desktop-shell',
    platform: 'darwin',
  });
  const client = createRendererDesktopClient(api);
  const queryCache = new DesktopQueryCache(client);
  const settingsQuery = createDesktopQueryDescriptor('getSettings', {});

  try {
    const initialSettings = await queryCache.fetchQuery(settingsQuery);

    await assert.rejects(
      client.commands.updateSettings({
        patch: {
          theme: 'dark',
          advancedPromptPreview: true,
        },
      }),
      /forced settings commit rollback/,
    );

    await new Promise((resolve) => setTimeout(resolve, 25));

    const snapshot = queryCache.getSnapshot(settingsQuery);
    const directSettings = await client.queries.getSettings({});
    const settingsQueryCalls = runtime.invocations.filter(
      (channel) => channel === ipcChannels.queries.getSettings,
    ).length;

    assert.equal(receivedEvents.length, 0);
    assert.deepEqual(snapshot.data, initialSettings);
    assert.deepEqual(directSettings, initialSettings);
    assert.equal(settingsQueryCalls, 2);
  } finally {
    queryCache.dispose();
  }
});
