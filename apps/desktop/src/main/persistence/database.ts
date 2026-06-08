import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { join, resolve } from 'node:path';

type SchemaMigration = {
  id: number;
  name: string;
  sql: string;
};

export type SqliteRow = Record<string, unknown>;

export interface SqliteConnection {
  exec(sql: string): Promise<void>;
  query<T extends SqliteRow>(sql: string): Promise<T[]>;
  close(): Promise<void>;
}

export type SqliteDatabaseHandle = {
  connection: SqliteConnection;
  close(): Promise<void>;
};

const bundledSqliteBinaryRelativePath = join(
  'resources',
  'bin',
  'sqlite3',
  'darwin',
  'sqlite3-launcher',
);

const coreSchemaMigrations: SchemaMigration[] = [
  {
    id: 1,
    name: 'core_chat_run_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('planning', 'in_progress', 'ai_review', 'human_review', 'completed')),
        project_id TEXT,
        source_screen TEXT NOT NULL CHECK (source_screen IN ('chat', 'workbench', 'projects', 'kanban')),
        usage_category TEXT NOT NULL CHECK (usage_category IN ('general', 'starter_template', 'project_linked')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_activity_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_last_activity_at ON tasks(last_activity_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tasks_usage_category ON tasks(usage_category);

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        summary TEXT,
        mode TEXT NOT NULL CHECK (mode IN ('balanced', 'savings', 'quality', 'long_context')),
        selected_model TEXT NOT NULL CHECK (selected_model IN ('gpt-4.1', 'claude-sonnet-4', 'gemini-1.5-pro')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_task_id ON conversations(task_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content_ko TEXT NOT NULL,
        run_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_messages_run_id ON messages(run_id);

      CREATE TABLE IF NOT EXISTS run_records (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('queued', 'optimizing', 'optimized', 'cloud_pending', 'restoring', 'completed', 'failed')),
        provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'google')),
        model TEXT NOT NULL CHECK (model IN ('gpt-4.1', 'claude-sonnet-4', 'gemini-1.5-pro')),
        mode TEXT NOT NULL CHECK (mode IN ('balanced', 'savings', 'quality', 'long_context')),
        started_at TEXT NOT NULL,
        ended_at TEXT,
        error_code TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_run_records_conversation_id ON run_records(conversation_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_run_records_message_id ON run_records(message_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_run_records_status ON run_records(status);

      CREATE TABLE IF NOT EXISTS run_stages (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES run_records(id) ON DELETE CASCADE,
        stage TEXT NOT NULL CHECK (stage IN ('queued', 'optimizing', 'optimized', 'cloud_pending', 'restoring', 'completed', 'failed')),
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
        started_at TEXT NOT NULL,
        ended_at TEXT,
        details_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_run_stages_run_id ON run_stages(run_id, started_at ASC);

      CREATE TABLE IF NOT EXISTS prompt_artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES run_records(id) ON DELETE CASCADE,
        artifact_type TEXT NOT NULL CHECK (artifact_type IN ('optimized_prompt_en', 'provider_response_en', 'restored_response_ko', 'preservation_check')),
        content TEXT NOT NULL,
        token_estimate INTEGER,
        visibility TEXT NOT NULL CHECK (visibility IN ('hidden', 'advanced', 'default'))
      );
      CREATE INDEX IF NOT EXISTS idx_prompt_artifacts_run_id ON prompt_artifacts(run_id, artifact_type);

      CREATE TABLE IF NOT EXISTS usage_records (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE REFERENCES run_records(id) ON DELETE CASCADE,
        baseline_input_tokens INTEGER NOT NULL CHECK (baseline_input_tokens >= 0),
        optimized_input_tokens INTEGER NOT NULL CHECK (optimized_input_tokens >= 0),
        output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
        estimated_cost_without_optimization REAL NOT NULL,
        estimated_cost_with_optimization REAL NOT NULL,
        pricing_version TEXT NOT NULL,
        latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0)
      );
    `,
  },
];

const desktopSchemaMigrations: SchemaMigration[] = [
  ...coreSchemaMigrations,
  {
    id: 2,
    name: 'settings_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
];

type PendingCommand = {
  marker: string;
  stdout: string[];
  stderr: string[];
  resolve: (output: string) => void;
  reject: (error: Error) => void;
};

function ensureExecutableFile(path: string): string {
  accessSync(path, constants.X_OK);
  return path;
}

export function resolveBundledSqliteBinaryPath(): string {
  const overriddenBinary = process.env.TALKIN_AI_SQLITE3_BIN;
  if (overriddenBinary) {
    return ensureExecutableFile(resolve(overriddenBinary));
  }

  const candidates = new Set<string>();
  const commonJsDirectory = typeof __dirname === 'string' ? __dirname : null;

  if (commonJsDirectory) {
    candidates.add(resolve(commonJsDirectory, '../../../', bundledSqliteBinaryRelativePath));
  }

  candidates.add(resolve(process.cwd(), bundledSqliteBinaryRelativePath));
  candidates.add(resolve(process.cwd(), 'apps/desktop', bundledSqliteBinaryRelativePath));

  for (const candidate of candidates) {
    try {
      return ensureExecutableFile(candidate);
    } catch {
      // Try the next candidate until a bundled binary is found.
    }
  }

  throw new Error(
    `Unable to resolve bundled sqlite3 binary. Checked: ${[...candidates].join(', ')}`,
  );
}

class SqliteCliConnection implements SqliteConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly exitPromise: Promise<void>;
  private readonly readyPromise: Promise<void>;
  private readonly filename: string;
  private readonly binaryPath: string;
  private activeCommand: PendingCommand | null = null;
  private commandChain: Promise<void> = Promise.resolve();
  private stdoutBuffer = '';
  private commandCount = 0;
  private closed = false;

  constructor(filename: string, binaryPath: string) {
    this.filename = filename;
    this.binaryPath = binaryPath;
    this.child = spawn(binaryPath, [filename], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdin.setDefaultEncoding('utf8');
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.handleStdout(chunk);
    });
    this.child.stderr.on('data', (chunk: string) => {
      this.handleStderr(chunk);
    });

    this.exitPromise = new Promise((resolve, reject) => {
      this.child.on('error', (error) => {
        this.failActiveCommand(error);
        reject(
          new Error(`Failed to spawn sqlite3 process for ${this.filename}`, {
            cause: error,
          }),
        );
      });
      this.child.on('exit', (code, signal) => {
        this.failActiveCommand(
          new Error(
            `sqlite3 process exited unexpectedly for ${this.filename} (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
          ),
        );
        resolve();
      });
    });

    this.readyPromise = this.enqueueCommand(`
.headers off
.mode json
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
    `);
  }

  static async connect(
    filename: string,
    binaryPath = resolveBundledSqliteBinaryPath(),
  ): Promise<SqliteCliConnection> {
    const connection = new SqliteCliConnection(filename, binaryPath);
    await connection.readyPromise;
    return connection;
  }

  async exec(sql: string): Promise<void> {
    await this.readyPromise;
    await this.enqueueCommand(sql);
  }

  async query<T extends SqliteRow>(sql: string): Promise<T[]> {
    await this.readyPromise;
    const output = await this.enqueueCommand(sql);
    const normalized = output.trim();

    if (!normalized) {
      return [];
    }

    return JSON.parse(normalized) as T[];
  }

  async close(): Promise<void> {
    if (this.closed) {
      await this.exitPromise.catch(() => undefined);
      return;
    }

    this.closed = true;

    try {
      await this.commandChain;
    } finally {
      this.child.stdin.end('.quit\n');
      await this.exitPromise.catch(() => undefined);
    }
  }

  private enqueueCommand(sql: string): Promise<string> {
    const marker = `__talkin_ai_sqlite_done_${++this.commandCount}__`;
    const script = `${sql.trim()}\n.print ${marker}\n`;

    const runCommand = () =>
      new Promise<string>((resolve, reject) => {
        if (this.closed) {
          reject(new Error(`sqlite3 connection for ${this.filename} is closed`));
          return;
        }

        this.activeCommand = {
          marker,
          stdout: [],
          stderr: [],
          resolve,
          reject,
        };
        this.child.stdin.write(script);
      });

    const commandPromise = this.commandChain.then(runCommand);
    this.commandChain = commandPromise.then(
      () => undefined,
      () => undefined,
    );

    return commandPromise;
  }

  private handleStdout(chunk: string) {
    this.stdoutBuffer += chunk;

    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf('\n');
      if (newlineIndex === -1) {
        return;
      }

      const rawLine = this.stdoutBuffer.slice(0, newlineIndex);
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      const line = rawLine.replace(/\r$/, '');

      if (!this.activeCommand) {
        continue;
      }

      if (line === this.activeCommand.marker) {
        const completed = this.activeCommand;
        this.activeCommand = null;
        const stderr = completed.stderr.join('').trim();

        if (stderr) {
          completed.reject(new Error(stderr));
          continue;
        }

        completed.resolve(completed.stdout.join('\n').trim());
        continue;
      }

      if (line.length > 0) {
        this.activeCommand.stdout.push(line);
      }
    }
  }

  private handleStderr(chunk: string) {
    if (this.activeCommand) {
      this.activeCommand.stderr.push(chunk);
    }
  }

  private failActiveCommand(error: Error) {
    if (!this.activeCommand) {
      return;
    }

    const active = this.activeCommand;
    this.activeCommand = null;
    active.reject(error);
  }
}

export async function openSqliteDatabase(filename: string): Promise<SqliteDatabaseHandle> {
  const connection = await SqliteCliConnection.connect(filename);

  return {
    connection,
    async close() {
      await connection.close();
    },
  };
}

export async function getSchemaVersion(connection: SqliteConnection): Promise<number> {
  const rows = await connection.query<{ user_version: number }>('PRAGMA user_version;');
  return rows[0]?.user_version ?? 0;
}

async function applySchemaMigrations(
  connection: SqliteConnection,
  migrations: SchemaMigration[],
): Promise<number> {
  let currentVersion = await getSchemaVersion(connection);

  for (const migration of migrations) {
    if (migration.id <= currentVersion) {
      continue;
    }

    await connection.exec('BEGIN IMMEDIATE;');

    try {
      await connection.exec(migration.sql);
      await connection.exec(`PRAGMA user_version = ${migration.id};`);
      await connection.exec('COMMIT;');
      currentVersion = migration.id;
    } catch (error) {
      try {
        await connection.exec('ROLLBACK;');
      } catch {
        // The original migration failure is the meaningful error for this story slice.
      }

      throw new Error(`Failed to apply SQLite migration ${migration.id} (${migration.name})`, {
        cause: error,
      });
    }
  }

  return currentVersion;
}

export async function migrateCoreSchema(connection: SqliteConnection): Promise<number> {
  return applySchemaMigrations(connection, coreSchemaMigrations);
}

export async function migrateDesktopSchema(connection: SqliteConnection): Promise<number> {
  return applySchemaMigrations(connection, desktopSchemaMigrations);
}
