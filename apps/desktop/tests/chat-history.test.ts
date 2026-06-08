import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPersistentChatHistoryService } from '../src/main/chat/index.ts';
import { createDesktopIpcService } from '../src/main/ipc/register-ipc.ts';
import { openSqliteDatabase } from '../src/main/persistence/database.ts';

function createTempDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'talkin-ai-chat-history-'));
  const dbPath = join(directory, 'talkin-ai.db');
  writeFileSync(dbPath, '');

  return {
    dbPath,
    cleanup() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function createDeterministicIdFactory() {
  const counts = new Map<string, number>();

  return (prefix: string) => {
    const nextValue = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, nextValue);
    return `${prefix}-${String(nextValue).padStart(3, '0')}`;
  };
}

test('story-2.2:AC-1 and story-2.2:VAL-1 durable submit stores task, conversation, message, run, and queued stage before the chat feed reflects them', async () => {
  const temp = createTempDatabase();
  const promptKo =
    '\n다음 PDF를 바탕으로 한국 시장 진출 전략을 정리해 주세요.\n핵심 수치, 리스크, 표, 체크리스트를 그대로 유지해 주세요.\n마지막에는 실행 순서를 번호 목록으로 정리해 주세요.\n';

  try {
    const service = createDesktopIpcService({
      chatHistoryService: createPersistentChatHistoryService({
        dbPath: temp.dbPath,
        now: () => '2026-06-08T03:10:00.000Z',
        createId: createDeterministicIdFactory(),
      }),
    });

    const result = await service.commands.submitPrompt({
      promptKo,
      selectedModel: 'claude-sonnet-4',
      optimizationMode: 'long_context',
    });
    const chatFeed = await service.queries.getChatFeed({});
    const handle = await openSqliteDatabase(temp.dbPath);

    try {
      const [taskRow] = await handle.connection.query<{ id: string; status: string }>(`
        SELECT id, status
        FROM tasks
        WHERE id = '${result.taskId}';
      `);
      const [conversationRow] = await handle.connection.query<{ id: string; selected_model: string; mode: string }>(`
        SELECT id, selected_model, mode
        FROM conversations
        WHERE id = '${result.conversationId}';
      `);
      const [messageRow] = await handle.connection.query<{ id: string; content_ko: string; run_id: string }>(`
        SELECT id, content_ko, run_id
        FROM messages
        WHERE id = '${result.messageId}';
      `);
      const [runRow] = await handle.connection.query<{ id: string; status: string; model: string; mode: string }>(`
        SELECT id, status, model, mode
        FROM run_records
        WHERE id = '${result.runId}';
      `);
      const [stageRow] = await handle.connection.query<{ run_id: string; stage: string; status: string }>(`
        SELECT run_id, stage, status
        FROM run_stages
        WHERE run_id = '${result.runId}';
      `);

      assert.ok(taskRow);
      assert.ok(conversationRow);
      assert.ok(messageRow);
      assert.ok(runRow);
      assert.ok(stageRow);
      assert.equal(taskRow.status, 'planning');
      assert.equal(conversationRow.selected_model, 'claude-sonnet-4');
      assert.equal(conversationRow.mode, 'long_context');
      assert.equal(messageRow.content_ko, promptKo);
      assert.equal(messageRow.run_id, result.runId);
      assert.equal(runRow.status, 'queued');
      assert.equal(runRow.model, 'claude-sonnet-4');
      assert.equal(runRow.mode, 'long_context');
      assert.equal(stageRow.stage, 'queued');
      assert.equal(stageRow.status, 'pending');
    } finally {
      await handle.close();
    }

    assert.equal(chatFeed.activeTaskId, result.taskId);
    assert.equal(chatFeed.activeConversationId, result.conversationId);
    assert.equal(chatFeed.activeRun?.runId, result.runId);
    assert.equal(chatFeed.activeRun?.status, 'queued');
    assert.equal(chatFeed.activeRun?.stage, 'queued');
    assert.equal(chatFeed.messages.length, 1);
    assert.equal(chatFeed.messages[0]?.messageId, result.messageId);
    assert.equal(chatFeed.messages[0]?.contentKo, promptKo);
  } finally {
    temp.cleanup();
  }
});

test('story-2.2:AC-3 and story-2.2:VAL-2 recreating the desktop IPC service against the same SQLite file restores the long Korean chat history', async () => {
  const temp = createTempDatabase();
  const longPromptKo = [
    '사업계획서 초안을 만들기 전에 다음 장문 문서를 먼저 읽고 정리해 주세요.',
    '',
    '1. 시장 규모와 성장률은 숫자를 그대로 남겨 주세요.',
    '2. 경쟁사 비교 표는 항목 순서를 유지해 주세요.',
    '3. 리스크와 대응 전략은 체크리스트 형식으로 정리해 주세요.',
    '',
    '마지막에는 한국어 실행 계획 5단계를 붙여 주세요.',
  ].join('\n');

  try {
    const firstService = createDesktopIpcService({
      chatHistoryService: createPersistentChatHistoryService({
        dbPath: temp.dbPath,
        now: () => '2026-06-08T03:40:00.000Z',
        createId: createDeterministicIdFactory(),
      }),
    });

    const initialResult = await firstService.commands.submitPrompt({
      promptKo: longPromptKo,
      selectedModel: 'gpt-4.1',
      optimizationMode: 'quality',
    });

    const secondService = createDesktopIpcService({
      chatHistoryService: createPersistentChatHistoryService({
        dbPath: temp.dbPath,
      }),
    });
    const restoredFeed = await secondService.queries.getChatFeed({});

    assert.equal(restoredFeed.activeTaskId, initialResult.taskId);
    assert.equal(restoredFeed.activeConversationId, initialResult.conversationId);
    assert.equal(restoredFeed.messages.length, 1);
    assert.equal(restoredFeed.messages[0]?.messageId, initialResult.messageId);
    assert.equal(restoredFeed.messages[0]?.contentKo, longPromptKo);
    assert.equal(restoredFeed.items.length, 1);
    assert.match(restoredFeed.items[0]?.preview ?? '', /시장 규모와 성장률/);
    assert.equal(restoredFeed.activeRun?.runId, initialResult.runId);
    assert.equal(restoredFeed.activeRun?.status, 'queued');
  } finally {
    temp.cleanup();
  }
});
