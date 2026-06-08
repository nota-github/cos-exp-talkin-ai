import type { AppSettings } from '../../shared/ipc/contracts';
import {
  migrateDesktopSchema,
  openSqliteDatabase,
  type SqliteConnection,
  type SqliteDatabaseHandle,
} from '../persistence/database';

export const defaultAppSettings: AppSettings = {
  defaultModel: 'gpt-4.1',
  optimizationMode: 'balanced',
  responseLanguage: 'ko',
  theme: 'system',
  advancedPromptPreview: false,
};

const cloudModelIds = ['gpt-4.1', 'claude-sonnet-4', 'gemini-1.5-pro'] as const;
const optimizationModes = ['balanced', 'savings', 'quality', 'long_context'] as const;
const themeModes = ['light', 'dark', 'system'] as const;
const appSettingKeys = Object.keys(defaultAppSettings) as Array<keyof AppSettings>;

type SettingKey = keyof AppSettings;
type SettingRow = {
  key: string;
  value_json: string;
  updated_at: string;
};
type SqlPrimitive = string | null;

export interface AppSettingsService {
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
}

export type PersistentAppSettingsServiceOptions = {
  dbPath: string;
  now?: () => string;
  openDatabase?: (filename: string) => Promise<SqliteDatabaseHandle>;
  migrateSchema?: (connection: SqliteConnection) => Promise<number>;
};

function sqlValue(value: SqlPrimitive): string {
  if (value === null) {
    return 'NULL';
  }

  return `'${value.replace(/'/g, "''")}'`;
}

function isKnownSettingKey(value: string): value is SettingKey {
  return appSettingKeys.includes(value as SettingKey);
}

function isOneOf<TValue extends string>(
  value: unknown,
  expected: readonly TValue[],
): value is TValue {
  return typeof value === 'string' && expected.includes(value as TValue);
}

function isValidSettingValue<TKey extends SettingKey>(
  key: TKey,
  value: unknown,
): value is AppSettings[TKey] {
  switch (key) {
    case 'defaultModel':
      return isOneOf(value, cloudModelIds);
    case 'optimizationMode':
      return isOneOf(value, optimizationModes);
    case 'responseLanguage':
      return value === 'ko';
    case 'theme':
      return isOneOf(value, themeModes);
    case 'advancedPromptPreview':
      return typeof value === 'boolean';
    default:
      return false;
  }
}

function mapRowsToAppSettings(rows: SettingRow[]): AppSettings {
  const settings: AppSettings = { ...defaultAppSettings };

  for (const row of rows) {
    if (!isKnownSettingKey(row.key)) {
      continue;
    }

    try {
      const parsedValue = JSON.parse(row.value_json) as unknown;

      if (isValidSettingValue(row.key, parsedValue)) {
        settings[row.key] = parsedValue;
      }
    } catch {
      // Corrupted settings rows should not break app boot for this slice.
    }
  }

  return settings;
}

function createSettingsRepository(connection: SqliteConnection) {
  return {
    async list() {
      return connection.query<SettingRow>(`
        SELECT key, value_json, updated_at
        FROM settings
        ORDER BY key ASC;
      `);
    },

    async upsertMany(patch: Partial<AppSettings>, updatedAt: string) {
      for (const key of appSettingKeys) {
        const value = patch[key];

        if (value === undefined) {
          continue;
        }

        await connection.exec(`
          INSERT INTO settings (key, value_json, updated_at)
          VALUES (
            ${sqlValue(key)},
            ${sqlValue(JSON.stringify(value))},
            ${sqlValue(updatedAt)}
          )
          ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at;
        `);
      }
    },
  };
}

async function readSettings(connection: SqliteConnection): Promise<AppSettings> {
  const repository = createSettingsRepository(connection);
  const rows = await repository.list();
  return mapRowsToAppSettings(rows);
}

async function updateSettingsRows(
  connection: SqliteConnection,
  patch: Partial<AppSettings>,
  updatedAt: string,
): Promise<AppSettings> {
  const repository = createSettingsRepository(connection);

  await connection.exec('BEGIN IMMEDIATE;');

  try {
    await repository.upsertMany(patch, updatedAt);
    const settings = await readSettings(connection);
    await connection.exec('COMMIT;');
    return settings;
  } catch (error) {
    try {
      await connection.exec('ROLLBACK;');
    } catch {
      // The original settings write failure is the relevant error.
    }

    throw error;
  }
}

async function withSettingsDatabase<TValue>(
  options: PersistentAppSettingsServiceOptions,
  work: (connection: SqliteConnection) => Promise<TValue>,
) {
  const openDatabase = options.openDatabase ?? openSqliteDatabase;
  const migrateSchema = options.migrateSchema ?? migrateDesktopSchema;
  const handle = await openDatabase(options.dbPath);

  try {
    await migrateSchema(handle.connection);
    return await work(handle.connection);
  } finally {
    await handle.close();
  }
}

export function createPersistentAppSettingsService(
  options: PersistentAppSettingsServiceOptions,
): AppSettingsService {
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async getSettings() {
      return withSettingsDatabase(options, (connection) => readSettings(connection));
    },

    async updateSettings(patch) {
      if (Object.keys(patch).length === 0) {
        return this.getSettings();
      }

      return withSettingsDatabase(options, (connection) =>
        updateSettingsRows(connection, patch, now()),
      );
    },
  };
}

export function createInMemoryAppSettingsService(
  initialSettings: AppSettings = defaultAppSettings,
): AppSettingsService {
  let settings = {
    ...initialSettings,
  };

  return {
    async getSettings() {
      return {
        ...settings,
      };
    },

    async updateSettings(patch) {
      settings = {
        ...settings,
        ...patch,
      };

      return {
        ...settings,
      };
    },
  };
}
