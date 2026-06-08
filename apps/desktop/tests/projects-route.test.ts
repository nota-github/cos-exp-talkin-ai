import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPersistentBoardService } from '../src/main/board/index.ts';
import { createPersistentChatHistoryService } from '../src/main/chat/index.ts';
import { createDesktopIpcService } from '../src/main/ipc/register-ipc.ts';
import {
  createChatRunPersistence,
  migrateDesktopSchema,
} from '../src/main/persistence/index.ts';
import { openSqliteDatabase } from '../src/main/persistence/database.ts';
import { createPersistentProjectService } from '../src/main/projects/index.ts';
import {
  filterProjectTasks,
  getBoardSurfaceState,
  getProjectHubSurfaceState,
  openBoardTaskInChat,
  openBoardTaskInWorkbench,
  openProjectTaskInChat,
  openProjectTaskInWorkbench,
  previewBoardColumns,
  previewProjectDetails,
  previewProjectList,
} from '../src/renderer/routes/projects-surface.ts';
import { createPersistentWorkbenchService } from '../src/main/workbench/index.ts';
import type { DesktopInvalidationEvent } from '../src/shared/ipc/contracts.ts';

const projectsRouteSource = readFileSync(
  new URL('../src/renderer/routes/ProjectsRoute.tsx', import.meta.url),
  'utf8',
);
const projectsSurfaceSource = readFileSync(
  new URL('../src/renderer/routes/projects-surface.ts', import.meta.url),
  'utf8',
);
const projectsStylesSource = readFileSync(
  new URL('../src/renderer/styles.css', import.meta.url),
  'utf8',
);

function createTempDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'talkin-ai-projects-route-'));
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

function createDeterministicIdFactory() {
  const counts = new Map<string, number>();

  return (prefix: string) => {
    const nextValue = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, nextValue);
    return `${prefix}-${String(nextValue).padStart(3, '0')}`;
  };
}

function createSequenceNow(...values: string[]) {
  let index = 0;
  const fallback = values[values.length - 1] ?? '2026-06-08T05:00:00.000Z';

  return () => {
    const value = values[index] ?? fallback;
    index += 1;
    return value;
  };
}

async function withFixedDate<TValue>(iso: string, work: () => Promise<TValue>) {
  const RealDate = Date;

  class FixedDate extends RealDate {
    constructor(value?: ConstructorParameters<typeof Date>[0]) {
      super(value ?? iso);
    }

    static now() {
      return new RealDate(iso).getTime();
    }

    static parse(value: string) {
      return RealDate.parse(value);
    }

    static UTC(
      year: number,
      monthIndex?: number,
      date?: number,
      hours?: number,
      minutes?: number,
      seconds?: number,
      ms?: number,
    ) {
      return RealDate.UTC(year, monthIndex, date, hours, minutes, seconds, ms);
    }
  }

  globalThis.Date = FixedDate as typeof Date;

  try {
    return await work();
  } finally {
    globalThis.Date = RealDate;
  }
}

async function seedProject(dbPath: string, input: {
  id: string;
  name: string;
  description: string;
  goal: string;
  createdAt: string;
  updatedAt: string;
}) {
  const handle = await openSqliteDatabase(dbPath);
  const persistence = createChatRunPersistence(handle.connection);

  try {
    await migrateDesktopSchema(handle.connection);
    await persistence.projects.create({
      id: input.id,
      name: input.name,
      description: input.description,
      goal: input.goal,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    });
  } finally {
    await persistence.close();
  }
}

async function seedProjectFile(dbPath: string, input: {
  id: string;
  projectId: string;
  displayName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
}) {
  const handle = await openSqliteDatabase(dbPath);
  const persistence = createChatRunPersistence(handle.connection);

  try {
    await migrateDesktopSchema(handle.connection);
    await persistence.fileAssets.create({
      id: input.id,
      projectId: input.projectId,
      displayName: input.displayName,
      storagePath: input.storagePath,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    });
  } finally {
    await persistence.close();
  }
}

test('story-5.5:VAL-1, story-5.5:AC-1, story-5.5:AC-2, and story-5.5:AC-3 moveTaskStatus keeps board, DB, chat, and workbench in sync through canonical task state', async () => {
  const temp = createTempDatabase();

  try {
    await seedProject(temp.dbPath, {
      id: 'project-001',
      name: '사업계획서',
      description: '칸반 상태 동기화 확인용 프로젝트',
      goal: '같은 task가 board, chat, workbench에서 같은 상태를 보이는지 확인',
      createdAt: '2026-06-08T05:00:00.000Z',
      updatedAt: '2026-06-08T05:00:00.000Z',
    });
    const idFactory = createDeterministicIdFactory();
    const service = createDesktopIpcService({
      boardService: createPersistentBoardService({
        dbPath: temp.dbPath,
        now: createSequenceNow(
          '2026-06-08T05:02:00.000Z',
          '2026-06-08T05:04:00.000Z',
          '2026-06-08T05:05:00.000Z',
        ),
      }),
      chatHistoryService: createPersistentChatHistoryService({
        dbPath: temp.dbPath,
        now: createSequenceNow('2026-06-08T05:01:00.000Z'),
        createId: idFactory,
      }),
      workbenchService: createPersistentWorkbenchService({
        dbPath: temp.dbPath,
        now: createSequenceNow('2026-06-08T05:03:00.000Z', '2026-06-08T05:06:00.000Z'),
        createId: idFactory,
      }),
    });

    const submitResult = await service.commands.submitPrompt({
      promptKo: '파트너 제안서 초안을 칸반으로 관리할 수 있게 만들어줘.',
      selectedModel: 'claude-sonnet-4',
      optimizationMode: 'quality',
      projectId: 'project-001',
    });
    await service.commands.openInWorkbench({
      taskId: submitResult.taskId,
    });

    const initialBoard = await service.queries.getBoardColumns({});
    const initialCard =
      initialBoard.columns.find((column) => column.status === 'planning')?.cards.find(
        (card) => card.taskId === submitResult.taskId,
      ) ?? null;

    assert.equal(initialBoard.columns.length, 5);
    assert.equal(initialCard?.projectName, '사업계획서');
    assert.equal(initialCard?.status, 'planning');
    assert.equal(initialCard?.conversationId, submitResult.conversationId);
    assert.equal(initialCard?.toolSummary, 'Claude Sonnet · 품질 우선');
    assert.equal(typeof initialCard?.lastActivity, 'string');

    const handle = await openSqliteDatabase(temp.dbPath);

    try {
      const [beforeTaskRow] = await handle.connection.query<{ status: string }>(`
        SELECT status
        FROM tasks
        WHERE id = '${submitResult.taskId}';
      `);

      assert.equal(beforeTaskRow?.status, 'planning');

      await service.commands.moveTaskStatus({
        taskId: submitResult.taskId,
        status: 'ai_review',
      });

      const updatedBoard = await service.queries.getBoardColumns({});
      const updatedCard =
        updatedBoard.columns.find((column) => column.status === 'ai_review')?.cards.find(
          (card) => card.taskId === submitResult.taskId,
        ) ?? null;
      const workbenchLayout = await service.queries.getWorkbenchLayout({});
      const chatFeed = await service.queries.getChatFeed({
        conversationId: submitResult.conversationId,
      });

      const [afterTaskRow] = await handle.connection.query<{ status: string }>(`
        SELECT status
        FROM tasks
        WHERE id = '${submitResult.taskId}';
      `);

      assert.equal(afterTaskRow?.status, 'ai_review');
      assert.equal(
        updatedBoard.columns.find((column) => column.status === 'planning')?.cards.some(
          (card) => card.taskId === submitResult.taskId,
        ),
        false,
      );
      assert.equal(updatedCard?.status, 'ai_review');
      assert.equal(updatedCard?.projectName, '사업계획서');
      assert.equal(
        workbenchLayout.panels.find((panel) => panel.taskId === submitResult.taskId)?.status,
        'ai_review',
      );
      assert.equal(
        chatFeed.items.find((item) => item.taskId === submitResult.taskId)?.status,
        'ai_review',
      );
    } finally {
      await handle.close();
    }
  } finally {
    temp.cleanup();
  }
});

test('story-5.5:VAL-2 and story-5.5:AC-4 kanban card actions can open the same task in workbench or detailed chat', async () => {
  let workbenchPath = '';
  let observedWorkbenchTaskId: string | null = null;

  const openedWorkbench = await openBoardTaskInWorkbench({
    desktopAvailable: true,
    taskId: 'task-201',
    navigate: (path) => {
      workbenchPath = path;
    },
    openInWorkbench: async (request) => {
      observedWorkbenchTaskId = request.taskId;

      return {
        layoutId: 'layout-primary',
        taskId: request.taskId,
        panelSlot: 'north-west',
      };
    },
  });

  let chatPath = '';
  const openedChat = openBoardTaskInChat({
    conversationId: 'conversation-201',
    navigate: (path) => {
      chatPath = path;
    },
  });

  assert.equal(openedWorkbench, true);
  assert.equal(observedWorkbenchTaskId, 'task-201');
  assert.equal(workbenchPath, '/workbench');
  assert.equal(openedChat, true);
  assert.equal(chatPath, '/?conversationId=conversation-201');
  assert.match(projectsRouteSource, /desktopClient\.commands\.moveTaskStatus/);
  assert.match(projectsRouteSource, /desktopClient\.commands\.openInWorkbench/);
  assert.match(projectsSurfaceSource, /conversationId=/);
});

test('story-5.5:VAL-3, story-5.5:AC-5, and story-5.5:AC-6 board surface distinguishes loading, empty, and populated workflow states', () => {
  const idleState = getBoardSurfaceState({
    desktopAvailable: true,
    queryStatus: 'idle',
    boardColumns: null,
  });
  const loadingState = getBoardSurfaceState({
    desktopAvailable: true,
    queryStatus: 'loading',
    boardColumns: null,
  });
  const emptyState = getBoardSurfaceState({
    desktopAvailable: true,
    queryStatus: 'success',
    boardColumns: {
      columns: previewBoardColumns.columns.map((column) => ({
        ...column,
        cards: [],
      })),
    },
  });
  const populatedState = getBoardSurfaceState({
    desktopAvailable: true,
    queryStatus: 'success',
    boardColumns: previewBoardColumns,
  });

  assert.equal(idleState.showLoadingState, true);
  assert.equal(idleState.showInteractiveContent, false);
  assert.equal(idleState.previewMode, false);
  assert.equal(idleState.totalTaskCount, 0);
  assert.equal(idleState.emptyColumnCount, 5);
  assert.equal(idleState.columns.every((column) => column.cards.length === 0), true);
  assert.equal(loadingState.showLoadingState, true);
  assert.equal(emptyState.showInteractiveContent, true);
  assert.equal(emptyState.totalTaskCount, 0);
  assert.equal(emptyState.emptyColumnCount, 5);
  assert.equal(populatedState.showInteractiveContent, true);
  assert.equal(populatedState.totalTaskCount, 4);
  assert.equal(populatedState.emptyColumnCount, 1);
  assert.match(projectsRouteSource, /보조 흐름 보드/);
  assert.match(projectsRouteSource, /아직 이 단계의 작업이 없습니다/);
  assert.match(projectsRouteSource, /className="board-grid"/);
  assert.match(projectsStylesSource, /\.board-grid\s*\{/);
  assert.match(projectsStylesSource, /\.board-card\s*\{/);
  assert.match(projectsStylesSource, /\.board-column-empty\s*\{/);
});

test('story-5.6:VAL-1, story-5.6:AC-1, and story-5.6:AC-3 createProject/updateProject persist across restart and keep project list sorted by the latest hub change', async () => {
  const temp = createTempDatabase();

  try {
    const idFactory = createDeterministicIdFactory();
    const firstService = createDesktopIpcService({
      chatHistoryService: createPersistentChatHistoryService({
        dbPath: temp.dbPath,
        now: createSequenceNow('2026-06-08T05:01:00.000Z'),
        createId: idFactory,
      }),
      projectService: createPersistentProjectService({
        dbPath: temp.dbPath,
        createId: idFactory,
        now: createSequenceNow(
          '2026-06-08T05:00:00.000Z',
          '2026-06-08T05:02:00.000Z',
          '2026-06-08T05:03:00.000Z',
        ),
      }),
    });

    const firstProject = await firstService.commands.createProject({
      name: '문서 요약',
      description: '긴 PDF를 요약하는 허브',
      goal: '핵심 문서를 1페이지 인사이트로 압축',
    });
    const secondProject = await firstService.commands.createProject({
      name: '사업계획서',
      description: '제안서와 목차 초안을 묶는 허브',
      goal: '시장 진입 전략을 구조화',
    });

    await firstService.commands.submitPrompt({
      promptKo: '첫 번째 프로젝트에 연결된 시장 진입 전략 초안을 만들어줘.',
      selectedModel: 'gpt-4.1',
      optimizationMode: 'balanced',
      projectId: firstProject.projectId,
    });

    await firstService.commands.updateProject({
      projectId: firstProject.projectId,
      name: '문서 요약 허브',
      description: '긴 PDF와 후속 질문을 정리하는 허브',
      goal: '핵심 문서를 1페이지 인사이트로 압축',
    });

    const restartedService = createDesktopIpcService({
      projectService: createPersistentProjectService({
        dbPath: temp.dbPath,
        createId: idFactory,
        now: createSequenceNow('2026-06-08T05:03:00.000Z'),
      }),
    });

    const projectList = await restartedService.queries.getProjectList({});
    const projectDetail = await restartedService.queries.getProjectDetail({
      projectId: firstProject.projectId,
    });

    assert.equal(projectList.projects.length, 2);
    assert.equal(projectList.projects[0]?.projectId, firstProject.projectId);
    assert.equal(projectList.projects[0]?.name, '문서 요약 허브');
    assert.equal(projectList.projects[0]?.taskCount, 1);
    assert.equal(projectList.projects[0]?.lastActivityAt, '2026-06-08T05:03:00.000Z');
    assert.equal(projectList.projects[1]?.projectId, secondProject.projectId);
    assert.equal(projectDetail.name, '문서 요약 허브');
    assert.equal(projectDetail.description, '긴 PDF와 후속 질문을 정리하는 허브');
    assert.equal(projectDetail.goal, '핵심 문서를 1페이지 인사이트로 압축');
  } finally {
    temp.cleanup();
  }
});

test('story-5.6:AC-3 updateProject reorders the in-memory project hub by the latest project edit even when tasks already exist', async () => {
  await withFixedDate('2026-06-08T02:00:00.000Z', async () => {
    const service = createDesktopIpcService();

    const beforeUpdate = await service.queries.getProjectList({});
    assert.equal(beforeUpdate.projects[0]?.projectId, 'project-003');

    await service.commands.updateProject({
      projectId: 'project-002',
      name: '제품 리서치 허브',
      description: '리서치 task와 후속 비교 메모를 묶는 허브',
      goal: '근거 정리와 요약 결과를 한곳에서 관리',
    });

    const afterUpdate = await service.queries.getProjectList({});

    assert.equal(afterUpdate.projects[0]?.projectId, 'project-002');
    assert.equal(afterUpdate.projects[0]?.name, '제품 리서치 허브');
    assert.equal(afterUpdate.projects[0]?.lastActivityAt, '2026-06-08T02:00:00.000Z');
  });
});

test('story-5.6:VAL-2, story-5.6:AC-2, and story-5.6:AC-4 setTaskProject links and unlinks canonical tasks while invalidating related projections', async () => {
  const temp = createTempDatabase();

  try {
    await seedProject(temp.dbPath, {
      id: 'project-001',
      name: '사업계획서',
      description: '프로젝트 연결 테스트용 허브',
      goal: 'task 연결 상태가 관련 화면에 동기화되는지 확인',
      createdAt: '2026-06-08T05:00:00.000Z',
      updatedAt: '2026-06-08T05:00:00.000Z',
    });
    const events: DesktopInvalidationEvent[] = [];
    const idFactory = createDeterministicIdFactory();
    const service = createDesktopIpcService({
      broadcast: (_channel, payload) => {
        events.push(payload as DesktopInvalidationEvent);
      },
      boardService: createPersistentBoardService({
        dbPath: temp.dbPath,
        now: createSequenceNow(
          '2026-06-08T05:04:00.000Z',
          '2026-06-08T05:05:00.000Z',
          '2026-06-08T05:06:00.000Z',
        ),
      }),
      chatHistoryService: createPersistentChatHistoryService({
        dbPath: temp.dbPath,
        now: createSequenceNow('2026-06-08T05:01:00.000Z'),
        createId: idFactory,
      }),
      projectService: createPersistentProjectService({
        dbPath: temp.dbPath,
        createId: idFactory,
        now: createSequenceNow('2026-06-08T05:02:00.000Z', '2026-06-08T05:03:00.000Z'),
      }),
      workbenchService: createPersistentWorkbenchService({
        dbPath: temp.dbPath,
        now: createSequenceNow('2026-06-08T05:02:30.000Z', '2026-06-08T05:03:30.000Z'),
        createId: idFactory,
      }),
    });

    const submitResult = await service.commands.submitPrompt({
      promptKo: '아직 프로젝트가 없는 FAQ 초안을 만들어줘.',
      selectedModel: 'gpt-4.1',
      optimizationMode: 'balanced',
    });
    await service.commands.openInWorkbench({
      taskId: submitResult.taskId,
    });

    const initialBoard = await service.queries.getBoardColumns({});
    const initialWorkbench = await service.queries.getWorkbenchLayout({});

    assert.equal(
      initialBoard.columns.flatMap((column) => column.cards).find((card) => card.taskId === submitResult.taskId)
        ?.projectName,
      '프로젝트 미지정',
    );
    assert.equal(
      initialWorkbench.recentTasks.find((task) => task.taskId === submitResult.taskId)?.projectName,
      '개인 작업',
    );

    await service.commands.setTaskProject({
      taskId: submitResult.taskId,
      projectId: 'project-001',
    });

    const linkedProjectList = await service.queries.getProjectList({});
    const linkedProjectDetail = await service.queries.getProjectDetail({
      projectId: 'project-001',
    });
    const linkedBoard = await service.queries.getBoardColumns({});
    const linkedWorkbench = await service.queries.getWorkbenchLayout({});
    const linkEvent = events.at(-1);

    assert.equal(
      linkedProjectList.projects.find((project) => project.projectId === 'project-001')?.taskCount,
      1,
    );
    assert.equal(
      linkedProjectList.recentTasks.find((task) => task.taskId === submitResult.taskId)?.projectId,
      'project-001',
    );
    assert.equal(linkedProjectDetail.tasks.length, 1);
    assert.equal(linkedProjectDetail.tasks[0]?.taskId, submitResult.taskId);
    assert.equal(
      linkedBoard.columns.flatMap((column) => column.cards).find((card) => card.taskId === submitResult.taskId)
        ?.projectName,
      '사업계획서',
    );
    assert.equal(
      linkedWorkbench.recentTasks.find((task) => task.taskId === submitResult.taskId)?.projectName,
      '사업계획서',
    );
    assert.equal(linkEvent?.source.name, 'setTaskProject');
    assert.deepEqual(linkEvent?.targets, [
      {
        kind: 'entity',
        entity: 'task',
        ids: [submitResult.taskId],
      },
      {
        kind: 'entity',
        entity: 'project',
        ids: ['project-001'],
      },
      {
        kind: 'projection',
        projection: 'projectList',
      },
      {
        kind: 'projection',
        projection: 'boardColumns',
      },
      {
        kind: 'projection',
        projection: 'workbenchLayout',
      },
      {
        kind: 'projection',
        projection: 'projectDetail',
        keys: ['project-001'],
      },
    ]);

    await service.commands.setTaskProject({
      taskId: submitResult.taskId,
      projectId: null,
    });

    const unlinkedProjectList = await service.queries.getProjectList({});
    const unlinkedProjectDetail = await service.queries.getProjectDetail({
      projectId: 'project-001',
    });
    const unlinkedBoard = await service.queries.getBoardColumns({});
    const unlinkedWorkbench = await service.queries.getWorkbenchLayout({});

    assert.equal(
      unlinkedProjectList.projects.find((project) => project.projectId === 'project-001')?.taskCount,
      0,
    );
    assert.equal(
      unlinkedProjectList.recentTasks.find((task) => task.taskId === submitResult.taskId)?.projectId,
      null,
    );
    assert.equal(unlinkedProjectDetail.tasks.length, 0);
    assert.equal(
      unlinkedBoard.columns.flatMap((column) => column.cards).find((card) => card.taskId === submitResult.taskId)
        ?.projectName,
      '프로젝트 미지정',
    );
    assert.equal(
      unlinkedWorkbench.recentTasks.find((task) => task.taskId === submitResult.taskId)?.projectName,
      '개인 작업',
    );
  } finally {
    temp.cleanup();
  }
});

test('story-5.6:VAL-3 and story-5.6:AC-5 project hub surface distinguishes loading, empty, and populated hub states', () => {
  const idleState = getProjectHubSurfaceState({
    desktopAvailable: true,
    queryStatus: 'idle',
    projectList: null,
  });
  const emptyState = getProjectHubSurfaceState({
    desktopAvailable: true,
    queryStatus: 'success',
    projectList: {
      projects: [],
      recentTasks: [],
    },
  });
  const populatedState = getProjectHubSurfaceState({
    desktopAvailable: true,
    queryStatus: 'success',
    projectList: previewProjectList,
  });

  assert.equal(idleState.showLoadingState, true);
  assert.equal(idleState.showInteractiveContent, false);
  assert.equal(idleState.totalProjectCount, 0);
  assert.equal(emptyState.showInteractiveContent, true);
  assert.equal(emptyState.showEmptyState, true);
  assert.equal(emptyState.totalProjectCount, 0);
  assert.equal(populatedState.showInteractiveContent, true);
  assert.equal(populatedState.showEmptyState, false);
  assert.equal(populatedState.totalProjectCount, 3);
  assert.equal(populatedState.linkedTaskCount, 3);
  assert.equal(populatedState.unlinkedTaskCount, 1);
  assert.match(projectsRouteSource, /긴 한국어 작업을 묶고, 흐름과 연결 상태를 한 번에 정리하세요/);
  assert.match(projectsRouteSource, /아직 만든 프로젝트가 없습니다/);
  assert.match(projectsRouteSource, /최근 task 인박스/);
  assert.match(projectsRouteSource, /보조 흐름 보드/);
  assert.match(projectsStylesSource, /\.project-hub-layout\s*\{/);
  assert.match(projectsStylesSource, /\.project-list-card\s*\{/);
  assert.match(projectsStylesSource, /\.project-task-command-card\s*\{/);
});

test('story-5.7:VAL-1, story-5.7:AC-1, and story-5.7:AC-2 project detail returns rich task, file, and activity data and supports in-project task search', async () => {
  const temp = createTempDatabase();

  try {
    await seedProject(temp.dbPath, {
      id: 'project-001',
      name: '사업계획서',
      description: '상세 허브와 검색 검증용 프로젝트',
      goal: 'task, 파일, 최근 맥락이 함께 모이는지 확인',
      createdAt: '2026-06-08T05:00:00.000Z',
      updatedAt: '2026-06-08T05:00:00.000Z',
    });

    const idFactory = createDeterministicIdFactory();
    const submitService = createDesktopIpcService({
      chatHistoryService: createPersistentChatHistoryService({
        dbPath: temp.dbPath,
        now: createSequenceNow(
          '2026-06-08T05:01:00.000Z',
          '2026-06-08T05:02:00.000Z',
          '2026-06-08T05:03:00.000Z',
        ),
        createId: idFactory,
      }),
      projectService: createPersistentProjectService({
        dbPath: temp.dbPath,
        createId: idFactory,
        now: createSequenceNow('2026-06-08T05:04:00.000Z'),
      }),
    });

    await submitService.commands.submitPrompt({
      promptKo: '시장 진입 전략이 먼저 보이도록 사업계획서 초안을 정리해줘.',
      selectedModel: 'gpt-4.1',
      optimizationMode: 'balanced',
      projectId: 'project-001',
    });
    await submitService.commands.submitPrompt({
      promptKo: '긴 PDF 핵심 주장만 뽑아 한국어 인사이트 7개로 요약해줘.',
      selectedModel: 'claude-sonnet-4',
      optimizationMode: 'quality',
      projectId: 'project-001',
    });
    await submitService.commands.submitPrompt({
      promptKo: '브랜드 카피 후보를 더 짧고 강하게 다듬어줘.',
      selectedModel: 'gemini-1.5-pro',
      optimizationMode: 'savings',
      projectId: 'project-001',
    });

    await seedProjectFile(temp.dbPath, {
      id: 'file-001',
      projectId: 'project-001',
      displayName: 'partner-brief.pdf',
      storagePath: '/tmp/partner-brief.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4096,
    });

    const detailService = createDesktopIpcService({
      projectService: createPersistentProjectService({
        dbPath: temp.dbPath,
        createId: idFactory,
        now: createSequenceNow('2026-06-08T05:06:00.000Z'),
      }),
    });

    const detail = await detailService.queries.getProjectDetail({
      projectId: 'project-001',
    });

    assert.equal(detail.files.length, 1);
    assert.deepEqual(detail.files[0], {
      fileId: 'file-001',
      displayName: 'partner-brief.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4096,
    });
    assert.equal(detail.tasks.length, 3);
    assert.equal(detail.tasks[0]?.taskId, 'task-003');
    assert.equal(detail.tasks[0]?.conversationId, 'conversation-003');
    assert.equal(detail.tasks[0]?.sourceScreen, 'chat');
    assert.match(detail.tasks[0]?.summary ?? '', /브랜드 카피/);
    assert.equal(detail.recentActivity.length, 3);
    assert.equal(detail.recentActivity[0]?.taskId, 'task-003');
    assert.match(detail.recentActivity[0]?.summary ?? '', /브랜드 카피/);

    assert.deepEqual(
      filterProjectTasks(detail.tasks, '시장 진입').map((task) => task.taskId),
      ['task-001'],
    );
    assert.deepEqual(
      filterProjectTasks(detail.tasks, '한국어 인사이트').map((task) => task.taskId),
      ['task-002'],
    );
    assert.equal(filterProjectTasks(detail.tasks, '없는 검색어').length, 0);
  } finally {
    temp.cleanup();
  }
});

test('story-5.7:VAL-2 and story-5.7:AC-3 project detail task actions can open the same task in workbench or chat', async () => {
  let workbenchPath = '';
  let observedWorkbenchTaskId: string | null = null;

  const openedWorkbench = await openProjectTaskInWorkbench({
    desktopAvailable: true,
    taskId: 'task-301',
    navigate: (path) => {
      workbenchPath = path;
    },
    openInWorkbench: async (request) => {
      observedWorkbenchTaskId = request.taskId;

      return {
        layoutId: 'layout-primary',
        taskId: request.taskId,
        panelSlot: 'north-west',
      };
    },
  });

  let chatPath = '';
  const openedChat = openProjectTaskInChat({
    conversationId: 'conversation-301',
    navigate: (path) => {
      chatPath = path;
    },
  });

  assert.equal(openedWorkbench, true);
  assert.equal(observedWorkbenchTaskId, 'task-301');
  assert.equal(workbenchPath, '/workbench');
  assert.equal(openedChat, true);
  assert.equal(chatPath, '/?conversationId=conversation-301');
  assert.match(projectsRouteSource, /작업대에서 이어가기/);
  assert.match(projectsRouteSource, /연결된 task 검색/);
  assert.match(projectsRouteSource, /최근 대화 맥락/);
});

test('story-5.7:VAL-3, story-5.7:AC-4, story-5.7:AC-5, and story-5.7:AC-6 project detail hub distinguishes file-empty and file-present context sections', () => {
  const populatedDetail = previewProjectDetails['project-001'];
  const emptyFileDetail = previewProjectDetails['project-003'];

  assert.equal(populatedDetail.files.length, 2);
  assert.equal(populatedDetail.recentActivity.length, 2);
  assert.equal(emptyFileDetail.files.length, 0);
  assert.equal(emptyFileDetail.tasks[0]?.conversationId, 'preview-conversation-001');
  assert.equal(emptyFileDetail.recentActivity[0]?.taskId, 'preview-task-001');
  assert.match(projectsRouteSource, /프로젝트 상세 허브/);
  assert.match(projectsRouteSource, /task, 파일, 대화 흐름을 함께 봅니다/);
  assert.match(projectsRouteSource, /첫 참고 파일이 아직 없습니다/);
  assert.match(projectsRouteSource, /방금 이어진 의도와 후속 지시/);
  assert.match(projectsStylesSource, /\.project-detail-grid\s*\{/);
  assert.match(projectsStylesSource, /\.project-detail-task-card\s*\{/);
  assert.match(projectsStylesSource, /\.project-file-empty\s*\{/);
  assert.match(projectsStylesSource, /\.project-context-card\s*\{/);
});

test('story-5.8:VAL-1, story-5.8:VAL-2, story-5.8:VAL-3, story-5.8:AC-1, story-5.8:AC-2, story-5.8:AC-3, and story-5.8:AC-4 attach, persist, list, and unlink project files without deleting the original local file', async () => {
  const temp = createTempDatabase();

  try {
    await seedProject(temp.dbPath, {
      id: 'project-001',
      name: '사업계획서',
      description: '파일 연결 테스트용 프로젝트',
      goal: '참고 문서를 프로젝트 허브에 연결하고 다시 확인',
      createdAt: '2026-06-08T05:00:00.000Z',
      updatedAt: '2026-06-08T05:00:00.000Z',
    });

    const sourceFilePath = join(temp.directory, 'local-source.pdf');
    const sourceBytes = Buffer.from('%PDF-1.4\nproject file sample\n');
    writeFileSync(sourceFilePath, sourceBytes);

    const idFactory = createDeterministicIdFactory();
    const firstService = createDesktopIpcService({
      projectService: createPersistentProjectService({
        dbPath: temp.dbPath,
        createId: idFactory,
        now: createSequenceNow('2026-06-08T05:01:00.000Z', '2026-06-08T05:02:00.000Z'),
      }),
    });

    const attachResult = await firstService.commands.attachProjectFile({
      projectId: 'project-001',
      file: {
        displayName: 'partner-brief.pdf',
        mimeType: 'application/pdf',
        bytes: new Uint8Array(sourceBytes),
      },
    });
    const attachedDetail = await firstService.queries.getProjectDetail({
      projectId: 'project-001',
    });

    assert.equal(attachResult.projectId, 'project-001');
    assert.equal(attachResult.fileId, 'file-001');
    assert.equal(attachResult.displayName, 'partner-brief.pdf');
    assert.equal(attachResult.mimeType, 'application/pdf');
    assert.equal(attachResult.sizeBytes, sourceBytes.byteLength);
    assert.equal(existsSync(attachResult.storagePath), true);
    assert.equal(readFileSync(attachResult.storagePath).equals(sourceBytes), true);
    assert.deepEqual(attachedDetail.files, [
      {
        fileId: 'file-001',
        displayName: 'partner-brief.pdf',
        mimeType: 'application/pdf',
        sizeBytes: sourceBytes.byteLength,
      },
    ]);

    const restartedService = createDesktopIpcService({
      projectService: createPersistentProjectService({
        dbPath: temp.dbPath,
        createId: idFactory,
        now: createSequenceNow('2026-06-08T05:03:00.000Z', '2026-06-08T05:04:00.000Z'),
      }),
    });
    const restartedDetail = await restartedService.queries.getProjectDetail({
      projectId: 'project-001',
    });

    const handle = await openSqliteDatabase(temp.dbPath);
    const persistence = createChatRunPersistence(handle.connection);

    try {
      const storedFile = await persistence.fileAssets.getById('file-001');

      assert.deepEqual(restartedDetail.files, attachedDetail.files);
      assert.equal(storedFile?.storagePath, attachResult.storagePath);
      assert.equal(storedFile?.sizeBytes, sourceBytes.byteLength);
    } finally {
      await persistence.close();
    }

    const unlinkResult = await restartedService.commands.unlinkProjectFile({
      projectId: 'project-001',
      fileId: 'file-001',
    });
    const unlinkedDetail = await restartedService.queries.getProjectDetail({
      projectId: 'project-001',
    });

    const reopenedHandle = await openSqliteDatabase(temp.dbPath);
    const reopenedPersistence = createChatRunPersistence(reopenedHandle.connection);

    try {
      assert.deepEqual(unlinkResult, {
        projectId: 'project-001',
        fileId: 'file-001',
        storagePath: attachResult.storagePath,
        originalFileDeleted: false,
        managedCopyRetained: true,
      });
      assert.deepEqual(unlinkedDetail.files, []);
      assert.equal(await reopenedPersistence.fileAssets.getById('file-001'), null);
      assert.equal(readFileSync(sourceFilePath).equals(sourceBytes), true);
      assert.equal(existsSync(attachResult.storagePath), true);
      assert.equal(readFileSync(attachResult.storagePath).equals(sourceBytes), true);
    } finally {
      await reopenedPersistence.close();
    }
  } finally {
    temp.cleanup();
  }
});

test('story-5.8:AC-5 and story-5.8:AC-6 project detail file section keeps compact attach actions for both empty and populated states', () => {
  assert.match(projectsRouteSource, /문서 관리 화면처럼 확장하지 않고/);
  assert.match(projectsRouteSource, /첫 파일 연결/);
  assert.match(projectsRouteSource, /파일 추가/);
  assert.match(projectsRouteSource, /원본 로컬 파일은 삭제하지 않고/);
  assert.match(projectsStylesSource, /\.project-file-toolbar\s*\{/);
  assert.match(projectsStylesSource, /\.project-file-action-row\s*\{/);
  assert.match(projectsStylesSource, /\.project-file-policy\s*\{/);
});
