import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  getBoardSurfaceState,
  getProjectHubSurfaceState,
  openBoardTaskInChat,
  openBoardTaskInWorkbench,
  previewBoardColumns,
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
