import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDesktopIpcService } from '../src/main/ipc/register-ipc.ts';
import { openSqliteDatabase, getSchemaVersion } from '../src/main/persistence/index.ts';
import {
  createPersistentSecretService,
  type SecretKeychainClient,
  type SecretVaultEntry,
} from '../src/main/keychain/index.ts';
import { createPersistentAppSettingsService } from '../src/main/settings/index.ts';
import { createTalkinAIDesktopApi } from '../src/preload/bridge.ts';
import { createRendererDesktopClient } from '../src/renderer/lib/ipc/client.ts';
import { commandNames, queryNames } from '../src/shared/ipc/contracts.ts';

function createTempDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), 'talkin-ai-settings-'));
  const dbPath = join(directory, 'talkin-ai.db');
  writeFileSync(dbPath, '');

  return {
    directory,
    dbPath,
    cleanup() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function createNoopIpcRenderer() {
  return {
    invoke: async () => undefined,
    on: () => undefined,
    off: () => undefined,
  };
}

function createFakeKeychainClient() {
  const entries = new Map<string, string>();

  const buildEntryKey = (entry: SecretVaultEntry) => `${entry.service}|${entry.account}`;

  const keychainClient: SecretKeychainClient = {
    async getGenericPassword(entry) {
      return entries.get(buildEntryKey(entry)) ?? null;
    },

    async setGenericPassword(entry, value) {
      entries.set(buildEntryKey(entry), value);
    },

    async deleteGenericPassword(entry) {
      entries.delete(buildEntryKey(entry));
    },
  };

  return {
    entries,
    keychainClient,
  };
}

test('story-1.4:VAL-1 persists non-secret settings in SQLite key/value rows across service restart', async () => {
  const temp = createTempDatabasePath();

  try {
    const firstService = createDesktopIpcService({
      settingsService: createPersistentAppSettingsService({
        dbPath: temp.dbPath,
      }),
    });

    const firstUpdate = await firstService.commands.updateSettings({
      patch: {
        defaultModel: 'claude-sonnet-4',
        optimizationMode: 'quality',
        responseLanguage: 'en',
        theme: 'dark',
        advancedPromptPreview: true,
      },
    });

    const secondService = createDesktopIpcService({
      settingsService: createPersistentAppSettingsService({
        dbPath: temp.dbPath,
      }),
    });
    const restored = await secondService.queries.getSettings({});
    const handle = await openSqliteDatabase(temp.dbPath);

    try {
      const rows = await handle.connection.query<{
        key: string;
        value_json: string;
      }>(`
        SELECT key, value_json
        FROM settings
        ORDER BY key ASC;
      `);

      assert.deepEqual(firstUpdate.updatedKeys.sort(), [
        'advancedPromptPreview',
        'defaultModel',
        'optimizationMode',
        'responseLanguage',
        'theme',
      ]);
      assert.equal(await getSchemaVersion(handle.connection), 4);
      assert.equal(restored.defaultModel, 'claude-sonnet-4');
      assert.equal(restored.optimizationMode, 'quality');
      assert.equal(restored.responseLanguage, 'en');
      assert.equal(restored.theme, 'dark');
      assert.equal(restored.advancedPromptPreview, true);
      assert.deepEqual(
        rows.map((row) => row.key),
        ['advancedPromptPreview', 'defaultModel', 'optimizationMode', 'responseLanguage', 'theme'],
      );
    } finally {
      await handle.close();
    }
  } finally {
    temp.cleanup();
  }
});

test('story-1.4:VAL-2 and story-1.4:AC-4 keep secrets out of SQLite plaintext while allowing automated test doubles', async () => {
  const temp = createTempDatabasePath();

  try {
    const settingsService = createPersistentAppSettingsService({
      dbPath: temp.dbPath,
    });
    const fakeKeychain = createFakeKeychainClient();
    const secrets = createPersistentSecretService({
      keychainClient: fakeKeychain.keychainClient,
    });

    await settingsService.updateSettings({
      theme: 'light',
    });

    await secrets.setProviderApiKey('openai', 'sk-openai-very-secret');
    await secrets.setLocalEngineCredential('translation-mcp', 'engine-credential-secret');

    const handle = await openSqliteDatabase(temp.dbPath);

    try {
      const rows = await handle.connection.query<{
        key: string;
        value_json: string;
      }>(`
        SELECT key, value_json
        FROM settings
        ORDER BY key ASC;
      `);

      assert.equal(await secrets.getProviderApiKey('openai'), 'sk-openai-very-secret');
      assert.equal(
        await secrets.getLocalEngineCredential('translation-mcp'),
        'engine-credential-secret',
      );
      assert.deepEqual(
        [...fakeKeychain.entries.keys()].sort(),
        [
          'talkin-ai.desktop|local-engine:translation-mcp',
          'talkin-ai.desktop|provider:openai',
        ],
      );
      assert.deepEqual(rows, [
        {
          key: 'theme',
          value_json: '"light"',
        },
      ]);
      assert.equal(
        readFileSync(temp.dbPath).includes(Buffer.from('sk-openai-very-secret')),
        false,
      );
      assert.equal(
        readFileSync(temp.dbPath).includes(Buffer.from('engine-credential-secret')),
        false,
      );
      assert.equal(existsSync(join(temp.directory, 'secrets.json')), false);
    } finally {
      await handle.close();
    }
  } finally {
    temp.cleanup();
  }
});

test('story-1.4:VAL-3 renderer and preload surfaces expose no direct secret service access', () => {
  const api = createTalkinAIDesktopApi(createNoopIpcRenderer(), {
    channel: 'desktop-shell',
    platform: 'darwin',
  });
  const client = createRendererDesktopClient(api);

  assert.deepEqual(Object.keys(api).sort(), ['ipc', 'shell']);
  assert.deepEqual(Object.keys(api.ipc).sort(), ['commands', 'events', 'queries']);
  assert.equal('secrets' in api, false);
  assert.equal('secrets' in api.ipc, false);
  assert.deepEqual(Object.keys(client).sort(), [
    'available',
    'commands',
    'events',
    'queries',
    'shell',
  ]);
  assert.equal('secrets' in client, false);
  assert.ok(commandNames.every((name) => !name.toLowerCase().includes('secret')));
  assert.ok(queryNames.every((name) => !name.toLowerCase().includes('secret')));
});
