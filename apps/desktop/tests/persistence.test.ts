import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createChatRunPersistence,
  getSchemaVersion,
  migrateCoreSchema,
  migrateDesktopSchema,
  openSqliteDatabase,
  resolveBundledSqliteBinaryPath,
  type ChatRunPersistence,
  type CreateUsageRecordInput,
} from '../src/main/persistence/index.ts';

type TempPersistence = {
  dbPath: string;
  directory: string;
  persistence: ChatRunPersistence;
  cleanup(): Promise<void>;
};

async function createTempPersistence(): Promise<TempPersistence> {
  const directory = mkdtempSync(join(tmpdir(), 'talkin-ai-persistence-'));
  const dbPath = join(directory, 'talkin-ai.db');
  writeFileSync(dbPath, '');

  const handle = await openSqliteDatabase(dbPath);
  await migrateCoreSchema(handle.connection);

  const persistence = createChatRunPersistence(handle.connection);

  return {
    dbPath,
    directory,
    persistence,
    async cleanup() {
      await persistence.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function seedQueuedRun(persistence: ChatRunPersistence, suffix = '001') {
  const timeline = {
    createdAt: '2026-06-08T01:10:00.000Z',
    messageAt: '2026-06-08T01:11:00.000Z',
    runAt: '2026-06-08T01:11:05.000Z',
    stageAt: '2026-06-08T01:11:06.000Z',
    completedAt: '2026-06-08T01:12:00.000Z',
  };

  const task = await persistence.tasks.create({
    id: `task-${suffix}`,
    title: '긴 PDF 요약 요청',
    status: 'planning',
    projectId: null,
    sourceScreen: 'chat',
    usageCategory: 'starter_template',
    createdAt: timeline.createdAt,
    updatedAt: timeline.createdAt,
    lastActivityAt: timeline.createdAt,
  });

  const conversation = await persistence.conversations.create({
    id: `conversation-${suffix}`,
    taskId: task.id,
    summary: '사업계획서와 첨부 PDF 요약',
    mode: 'quality',
    selectedModel: 'gpt-4.1',
    createdAt: timeline.createdAt,
    updatedAt: timeline.createdAt,
  });

  const message = await persistence.messages.create({
    id: `message-${suffix}`,
    conversationId: conversation.id,
    role: 'user',
    contentKo:
      '다음 PDF를 바탕으로 한국 시장 진출 전략을 정리해 주세요.\n핵심 수치와 리스크를 반드시 유지하고, 표와 체크리스트도 빠뜨리지 마세요.',
    runId: null,
    createdAt: timeline.messageAt,
  });

  const runRecord = await persistence.runRecords.create({
    id: `run-${suffix}`,
    taskId: task.id,
    conversationId: conversation.id,
    messageId: message.id,
    status: 'queued',
    provider: 'openai',
    model: 'gpt-4.1',
    mode: 'quality',
    startedAt: timeline.runAt,
    endedAt: null,
    errorCode: null,
  });

  const runStage = await persistence.runStages.create({
    id: `stage-${suffix}`,
    runId: runRecord.id,
    stage: 'queued',
    status: 'pending',
    startedAt: timeline.stageAt,
    endedAt: null,
    details: {
      source: 'composer-submit',
      preservedCharacters: message.contentKo.length,
    },
  });

  return {
    timeline,
    task,
    conversation,
    message,
    runRecord,
    runStage,
  };
}

function createUsageRecord(runId: string, usageId = 'usage-001'): CreateUsageRecordInput {
  return {
    id: usageId,
    runId,
    baselineInputTokens: 228,
    optimizedInputTokens: 141,
    outputTokens: 392,
    estimatedCostWithoutOptimization: 0.0218,
    estimatedCostWithOptimization: 0.0136,
    pricingVersion: 'openai-gpt-4.1-2026-06',
    latencyMs: 1840,
    isEstimated: false,
  };
}

test('story-1.3:VAL-1 migrates a blank SQLite file with every required core table', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'talkin-ai-schema-'));
  const dbPath = join(directory, 'blank.db');
  writeFileSync(dbPath, '');

  const originalPath = process.env.PATH;
  process.env.PATH = '';
  const bundledBinaryPath = resolveBundledSqliteBinaryPath();
  const handle = await openSqliteDatabase(dbPath);

  try {
    assert.match(
      bundledBinaryPath,
      /apps\/desktop\/resources\/bin\/sqlite3\/darwin\/sqlite3-launcher$/,
    );
    const version = await migrateCoreSchema(handle.connection);
    const tables = (
      await handle.connection.query<{ name: string }>(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name ASC;
      `)
    ).map((row) => row.name);

    assert.equal(version, 1);
    assert.equal(await getSchemaVersion(handle.connection), 1);
    assert.deepEqual(tables, [
      'conversations',
      'messages',
      'prompt_artifacts',
      'run_records',
      'run_stages',
      'tasks',
      'usage_records',
    ]);
  } finally {
    process.env.PATH = originalPath;
    await handle.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('story-1.3:VAL-2 repositories round-trip Korean messages, run stages, artifacts, and usage rows', async () => {
  const temp = await createTempPersistence();

  try {
    const seeded = await seedQueuedRun(temp.persistence);
    const optimizedArtifact = await temp.persistence.promptArtifacts.create({
      id: 'artifact-001',
      runId: seeded.runRecord.id,
      artifactType: 'optimized_prompt_en',
      content:
        'Summarize the PDF for a Korea market-entry plan. Preserve numeric evidence, risks, and any table/checklist structure.',
      tokenEstimate: 141,
      visibility: 'advanced',
    });

    const completed = await temp.persistence.completeRunWithUsage({
      runId: seeded.runRecord.id,
      endedAt: seeded.timeline.completedAt,
      usageRecord: createUsageRecord(seeded.runRecord.id),
    });

    const storedTask = await temp.persistence.tasks.getById(seeded.task.id);
    const storedConversation = await temp.persistence.conversations.getById(seeded.conversation.id);
    const storedMessage = await temp.persistence.messages.getById(seeded.message.id);
    const storedMessages = await temp.persistence.messages.listByConversation(seeded.conversation.id);
    const storedRun = await temp.persistence.runRecords.getById(seeded.runRecord.id);
    const storedStages = await temp.persistence.runStages.listByRunId(seeded.runRecord.id);
    const storedArtifacts = await temp.persistence.promptArtifacts.listByRunId(seeded.runRecord.id);
    const storedUsage = await temp.persistence.usageRecords.getByRunId(seeded.runRecord.id);

    assert.ok(storedTask);
    assert.ok(storedConversation);
    assert.ok(storedMessage);
    assert.ok(storedRun);
    assert.ok(storedUsage);
    assert.equal(storedTask.usageCategory, 'starter_template');
    assert.equal(storedTask.lastActivityAt, seeded.timeline.completedAt);
    assert.equal(storedConversation.selectedModel, 'gpt-4.1');
    assert.equal(storedConversation.mode, 'quality');
    assert.equal(storedMessage.contentKo, seeded.message.contentKo);
    assert.equal(storedMessages.length, 1);
    assert.equal(storedRun.status, 'completed');
    assert.equal(storedRun.endedAt, seeded.timeline.completedAt);
    assert.deepEqual(storedStages, [seeded.runStage]);
    assert.deepEqual(storedArtifacts, [optimizedArtifact]);
    assert.deepEqual(storedUsage, createUsageRecord(seeded.runRecord.id));
    assert.deepEqual(completed.runRecord, storedRun);
    assert.deepEqual(completed.usageRecord, storedUsage);
  } finally {
    await temp.cleanup();
  }
});

test('story-1.3:VAL-3 transaction rollback leaves no partial run completion or usage writes behind', async () => {
  const temp = await createTempPersistence();

  try {
    const seeded = await seedQueuedRun(temp.persistence);

    await assert.rejects(
      temp.persistence.transaction(async (tx) => {
        await tx.runRecords.updateStatus({
          runId: seeded.runRecord.id,
          status: 'completed',
          endedAt: seeded.timeline.completedAt,
          errorCode: null,
        });
        await tx.usageRecords.create(createUsageRecord(seeded.runRecord.id));
        throw new Error('forced transaction failure');
      }),
      /forced transaction failure/,
    );

    const storedRun = await temp.persistence.runRecords.getById(seeded.runRecord.id);
    const storedUsage = await temp.persistence.usageRecords.getByRunId(seeded.runRecord.id);

    assert.ok(storedRun);
    assert.equal(storedRun.status, 'queued');
    assert.equal(storedRun.endedAt, null);
    assert.equal(storedUsage, null);
  } finally {
    await temp.cleanup();
  }
});

test('story-4.1:AC-4 desktop migration preserves legacy pricing versions and backfills estimate flags on usage rows', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'talkin-ai-desktop-migration-'));
  const dbPath = join(directory, 'legacy.db');
  writeFileSync(dbPath, '');
  const handle = await openSqliteDatabase(dbPath);

  try {
    await handle.connection.exec(`
      CREATE TABLE run_records (
        id TEXT PRIMARY KEY
      );
      CREATE TABLE usage_records (
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
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO run_records (id) VALUES ('run-legacy');
      INSERT INTO usage_records (
        id,
        run_id,
        baseline_input_tokens,
        optimized_input_tokens,
        output_tokens,
        estimated_cost_without_optimization,
        estimated_cost_with_optimization,
        pricing_version,
        latency_ms
      ) VALUES (
        'usage-legacy',
        'run-legacy',
        480,
        292,
        164,
        0.002272,
        0.001896,
        'openai-gpt-4.1-2026-05',
        980
      );
      PRAGMA user_version = 2;
    `);

    const version = await migrateDesktopSchema(handle.connection);
    const columns = await handle.connection.query<{ name: string }>(`
      PRAGMA table_info(usage_records);
    `);
    const rows = await handle.connection.query<{
      pricing_version: string;
      is_estimated: number;
    }>(`
      SELECT pricing_version, is_estimated
      FROM usage_records
      WHERE id = 'usage-legacy';
    `);

    assert.equal(version, 3);
    assert.equal(await getSchemaVersion(handle.connection), 3);
    assert.ok(columns.some((column) => column.name === 'is_estimated'));
    assert.deepEqual(rows, [
      {
        pricing_version: 'openai-gpt-4.1-2026-05',
        is_estimated: 1,
      },
    ]);
  } finally {
    await handle.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('story-1.3 serializes overlapping top-level transactions and completion writes safely', async () => {
  const temp = await createTempPersistence();

  try {
    const firstRun = await seedQueuedRun(temp.persistence, '101');
    const secondRun = await seedQueuedRun(temp.persistence, '102');

    let releaseFirstTransaction!: () => void;
    const firstTransactionGate = new Promise<void>((resolve) => {
      releaseFirstTransaction = resolve;
    });
    let firstTransactionStarted = false;
    let secondWriteSettled = false;

    const firstTransaction = temp.persistence.transaction(async (tx) => {
      await tx.runRecords.updateStatus({
        runId: firstRun.runRecord.id,
        status: 'optimizing',
        endedAt: null,
        errorCode: null,
      });
      firstTransactionStarted = true;
      await firstTransactionGate;
      return tx.runRecords.getById(firstRun.runRecord.id);
    });

    while (!firstTransactionStarted) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const overlappingCompletion = temp.persistence
      .completeRunWithUsage({
        runId: secondRun.runRecord.id,
        endedAt: secondRun.timeline.completedAt,
        usageRecord: createUsageRecord(secondRun.runRecord.id, 'usage-102'),
      })
      .then((result) => {
        secondWriteSettled = true;
        return result;
      });

    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(secondWriteSettled, false);

    releaseFirstTransaction();

    const [firstResult, secondResult] = await Promise.all([firstTransaction, overlappingCompletion]);
    const firstRunAfter = await firstResult;
    const secondRunAfter = await temp.persistence.runRecords.getById(secondRun.runRecord.id);
    const secondUsageAfter = await temp.persistence.usageRecords.getByRunId(secondRun.runRecord.id);

    assert.ok(firstRunAfter);
    assert.equal(firstRunAfter.status, 'optimizing');
    assert.ok(secondRunAfter);
    assert.equal(secondRunAfter.status, 'completed');
    assert.deepEqual(secondResult.usageRecord, secondUsageAfter);
  } finally {
    await temp.cleanup();
  }
});

test('story-1.3 isolates plain repository calls from a failing top-level transaction', async () => {
  const temp = await createTempPersistence();

  try {
    const seeded = await seedQueuedRun(temp.persistence, '103');

    let releaseTransaction!: () => void;
    const transactionGate = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    let transactionStarted = false;
    let plainReadSettled = false;
    let plainWriteSettled = false;

    const failingTransaction = temp.persistence.transaction(async (tx) => {
      await tx.runRecords.updateStatus({
        runId: seeded.runRecord.id,
        status: 'optimizing',
        endedAt: null,
        errorCode: null,
      });
      transactionStarted = true;
      await transactionGate;
      throw new Error('forced shared-connection rollback');
    });

    while (!transactionStarted) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const plainRead = temp.persistence.runRecords.getById(seeded.runRecord.id).then((result) => {
      plainReadSettled = true;
      return result;
    });
    const plainWrite = temp.persistence.promptArtifacts
      .create({
        id: 'artifact-103',
        runId: seeded.runRecord.id,
        artifactType: 'optimized_prompt_en',
        content: 'Keep numeric evidence and checklist structure intact.',
        tokenEstimate: 98,
        visibility: 'advanced',
      })
      .then((result) => {
        plainWriteSettled = true;
        return result;
      });

    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(plainReadSettled, false);
    assert.equal(plainWriteSettled, false);

    releaseTransaction();

    await assert.rejects(failingTransaction, /forced shared-connection rollback/);

    const observedRun = await plainRead;
    const storedArtifact = await plainWrite;
    const artifactsAfter = await temp.persistence.promptArtifacts.listByRunId(seeded.runRecord.id);

    assert.ok(observedRun);
    assert.equal(observedRun.status, 'queued');
    assert.equal(observedRun.endedAt, null);
    assert.equal(storedArtifact.id, 'artifact-103');
    assert.deepEqual(artifactsAfter, [storedArtifact]);
  } finally {
    await temp.cleanup();
  }
});
