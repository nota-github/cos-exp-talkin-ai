import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createChatRunPersistence,
  getSchemaVersion,
  migrateDesktopSchema,
  openSqliteDatabase,
  type ChatRunPersistence,
} from '../src/main/persistence/index.ts';

type TempDesktopPersistence = {
  dbPath: string;
  directory: string;
  persistence: ChatRunPersistence;
  cleanup(): Promise<void>;
};

async function createTempDesktopPersistence(): Promise<TempDesktopPersistence> {
  const directory = mkdtempSync(join(tmpdir(), 'talkin-ai-work-mgmt-'));
  const dbPath = join(directory, 'talkin-ai.db');
  writeFileSync(dbPath, '');

  const handle = await openSqliteDatabase(dbPath);
  await migrateDesktopSchema(handle.connection);
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

test('story-5.1:AC-1 migrates work-management tables into the desktop schema', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'talkin-ai-work-mgmt-schema-'));
  const dbPath = join(directory, 'blank.db');
  writeFileSync(dbPath, '');
  const handle = await openSqliteDatabase(dbPath);

  try {
    const version = await migrateDesktopSchema(handle.connection);
    const tables = (
      await handle.connection.query<{ name: string }>(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name ASC;
      `)
    ).map((row) => row.name);

    assert.equal(version, 4);
    assert.equal(await getSchemaVersion(handle.connection), 4);
    assert.deepEqual(tables, [
      'conversations',
      'file_assets',
      'messages',
      'projects',
      'prompt_artifacts',
      'run_records',
      'run_stages',
      'settings',
      'tasks',
      'usage_records',
      'workbench_layouts',
      'workbench_panels',
    ]);
  } finally {
    await handle.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('story-5.1:VAL-1 and story-5.1:VAL-2 project workbench and board queries read from canonical task state', async () => {
  const temp = await createTempDesktopPersistence();

  try {
    const project = await temp.persistence.projects.create({
      id: 'project-001',
      name: '사업계획서',
      description: '장기 사업계획서 작업',
      goal: '시장 진입 전략과 수익화 구조 정리',
      createdAt: '2026-06-08T02:00:00.000Z',
      updatedAt: '2026-06-08T02:00:00.000Z',
    });
    const layout = await temp.persistence.workbenchLayouts.create({
      id: 'layout-001',
      name: '기본 작업대',
      createdAt: '2026-06-08T02:00:00.000Z',
      updatedAt: '2026-06-08T02:00:00.000Z',
    });

    await temp.persistence.tasks.create({
      id: 'task-001',
      title: '신규 파트너 제안서 초안',
      status: 'planning',
      projectId: null,
      sourceScreen: 'chat',
      usageCategory: 'general',
      createdAt: '2026-06-08T02:01:00.000Z',
      updatedAt: '2026-06-08T02:01:00.000Z',
      lastActivityAt: '2026-06-08T02:01:00.000Z',
    });
    await temp.persistence.tasks.create({
      id: 'task-002',
      title: '경쟁사 리서치 정리',
      status: 'in_progress',
      projectId: project.id,
      sourceScreen: 'projects',
      usageCategory: 'project_linked',
      createdAt: '2026-06-08T01:40:00.000Z',
      updatedAt: '2026-06-08T01:45:00.000Z',
      lastActivityAt: '2026-06-08T01:45:00.000Z',
    });

    const linkedTask = await temp.persistence.tasks.updateWorkflow({
      taskId: 'task-001',
      projectId: project.id,
      status: 'ai_review',
      updatedAt: '2026-06-08T02:05:00.000Z',
      lastActivityAt: '2026-06-08T02:05:00.000Z',
    });

    await temp.persistence.workbenchPanels.save({
      id: 'panel-001',
      layoutId: layout.id,
      panelSlot: 'north-west',
      taskId: 'task-001',
      pinned: true,
      updatedAt: '2026-06-08T02:05:00.000Z',
    });

    const storedTask = await temp.persistence.tasks.getById('task-001');
    const recentTasks = await temp.persistence.tasks.listRecent(5);
    const boardColumns = await temp.persistence.board.getColumns();
    const projectList = await temp.persistence.projects.list();
    const projectDetail = await temp.persistence.projects.getDetail(project.id);
    const layoutDetail = await temp.persistence.workbenchLayouts.getDetail(layout.id);
    const panelByTask = await temp.persistence.workbenchPanels.getByTask(layout.id, 'task-001');

    assert.equal(linkedTask?.status, 'ai_review');
    assert.equal(storedTask?.status, 'ai_review');
    assert.equal(storedTask?.projectId, project.id);

    assert.deepEqual(recentTasks, [
      {
        taskId: 'task-001',
        title: '신규 파트너 제안서 초안',
        status: 'ai_review',
        projectId: 'project-001',
        projectName: '사업계획서',
        sourceScreen: 'chat',
        lastActivityAt: '2026-06-08T02:05:00.000Z',
      },
      {
        taskId: 'task-002',
        title: '경쟁사 리서치 정리',
        status: 'in_progress',
        projectId: 'project-001',
        projectName: '사업계획서',
        sourceScreen: 'projects',
        lastActivityAt: '2026-06-08T01:45:00.000Z',
      },
    ]);

    assert.deepEqual(boardColumns, [
      {
        status: 'planning',
        cards: [],
      },
      {
        status: 'in_progress',
        cards: [
          {
            taskId: 'task-002',
            title: '경쟁사 리서치 정리',
            projectId: 'project-001',
            projectName: '사업계획서',
            lastActivityAt: '2026-06-08T01:45:00.000Z',
          },
        ],
      },
      {
        status: 'ai_review',
        cards: [
          {
            taskId: 'task-001',
            title: '신규 파트너 제안서 초안',
            projectId: 'project-001',
            projectName: '사업계획서',
            lastActivityAt: '2026-06-08T02:05:00.000Z',
          },
        ],
      },
      {
        status: 'human_review',
        cards: [],
      },
      {
        status: 'completed',
        cards: [],
      },
    ]);

    assert.deepEqual(projectList, [
      {
        id: 'project-001',
        name: '사업계획서',
        description: '장기 사업계획서 작업',
        goal: '시장 진입 전략과 수익화 구조 정리',
        createdAt: '2026-06-08T02:00:00.000Z',
        updatedAt: '2026-06-08T02:00:00.000Z',
        taskCount: 2,
        fileAssetCount: 0,
        lastTaskActivityAt: '2026-06-08T02:05:00.000Z',
      },
    ]);

    assert.deepEqual(projectDetail, {
      id: 'project-001',
      name: '사업계획서',
      description: '장기 사업계획서 작업',
      goal: '시장 진입 전략과 수익화 구조 정리',
      createdAt: '2026-06-08T02:00:00.000Z',
      updatedAt: '2026-06-08T02:00:00.000Z',
      tasks: [
        {
          taskId: 'task-001',
          title: '신규 파트너 제안서 초안',
          status: 'ai_review',
          lastActivityAt: '2026-06-08T02:05:00.000Z',
        },
        {
          taskId: 'task-002',
          title: '경쟁사 리서치 정리',
          status: 'in_progress',
          lastActivityAt: '2026-06-08T01:45:00.000Z',
        },
      ],
      fileAssets: [],
    });

    assert.deepEqual(layoutDetail, {
      layout: {
        id: 'layout-001',
        name: '기본 작업대',
        createdAt: '2026-06-08T02:00:00.000Z',
        updatedAt: '2026-06-08T02:05:00.000Z',
      },
      panels: [
        {
          id: 'panel-001',
          layoutId: 'layout-001',
          panelSlot: 'north-west',
          taskId: 'task-001',
          pinned: true,
          updatedAt: '2026-06-08T02:05:00.000Z',
        },
      ],
    });

    assert.deepEqual(panelByTask, {
      id: 'panel-001',
      layoutId: 'layout-001',
      panelSlot: 'north-west',
      taskId: 'task-001',
      pinned: true,
      updatedAt: '2026-06-08T02:05:00.000Z',
    });
  } finally {
    await temp.cleanup();
  }
});

test('story-5.1:VAL-3 file asset metadata rows support CRUD and project-scoped listings', async () => {
  const temp = await createTempDesktopPersistence();

  try {
    await temp.persistence.projects.create({
      id: 'project-asset',
      name: '문서 요약',
      description: '자료 모음',
      goal: '첨부 문서와 요약본 관리',
      createdAt: '2026-06-08T03:00:00.000Z',
      updatedAt: '2026-06-08T03:00:00.000Z',
    });

    const created = await temp.persistence.fileAssets.create({
      id: 'asset-001',
      projectId: 'project-asset',
      displayName: 'market-entry.pdf',
      storagePath: '/tmp/market-entry.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4096,
    });
    const updated = await temp.persistence.fileAssets.update({
      id: 'asset-001',
      projectId: 'project-asset',
      displayName: 'market-entry-summary.pdf',
      storagePath: '/tmp/market-entry-summary.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 6144,
    });
    const stored = await temp.persistence.fileAssets.getById('asset-001');
    const listed = await temp.persistence.fileAssets.listByProject('project-asset');
    const projectDetail = await temp.persistence.projects.getDetail('project-asset');

    assert.deepEqual(created, {
      id: 'asset-001',
      projectId: 'project-asset',
      displayName: 'market-entry.pdf',
      storagePath: '/tmp/market-entry.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4096,
    });
    assert.deepEqual(updated, {
      id: 'asset-001',
      projectId: 'project-asset',
      displayName: 'market-entry-summary.pdf',
      storagePath: '/tmp/market-entry-summary.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 6144,
    });
    assert.deepEqual(stored, updated);
    assert.deepEqual(listed, [updated]);
    assert.deepEqual(projectDetail?.fileAssets, [updated]);

    await temp.persistence.fileAssets.delete('asset-001');

    assert.equal(await temp.persistence.fileAssets.getById('asset-001'), null);
    assert.deepEqual(await temp.persistence.fileAssets.listByProject('project-asset'), []);
  } finally {
    await temp.cleanup();
  }
});
