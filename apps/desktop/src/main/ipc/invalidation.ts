import { randomUUID } from 'node:crypto';
import {
  ipcChannels,
  type DesktopInvalidationEvent,
  type InvalidationTarget,
} from '../../shared/ipc/contracts.ts';

type InvalidationBroadcaster = (channel: string, payload: unknown) => void;

export type BackgroundInvalidationSource = Extract<
  DesktopInvalidationEvent['source'],
  { type: 'workflow' | 'system' }
>;

export type InvalidationContext = {
  taskId?: string | null;
  conversationId?: string | null;
  runId?: string | null;
  includeUsageDashboard?: boolean;
};

export type CreateDesktopInvalidationEmitterOptions = {
  broadcast?: InvalidationBroadcaster;
  now?: () => string;
  createEventId?: () => string;
};

function defaultCreateEventId() {
  return `event-${randomUUID()}`;
}

function serializeTarget(target: InvalidationTarget) {
  if (target.kind === 'entity') {
    return `${target.kind}:${target.entity}:${[...target.ids].sort().join(',')}`;
  }

  return `${target.kind}:${target.projection}:${[...(target.keys ?? [])].sort().join(',')}`;
}

export function dedupeInvalidationTargets(targets: readonly InvalidationTarget[]) {
  const uniqueTargets = new Map<string, InvalidationTarget>();

  for (const target of targets) {
    uniqueTargets.set(serializeTarget(target), target);
  }

  return [...uniqueTargets.values()];
}

export function mergeInvalidationTargets(groups: ReadonlyArray<readonly InvalidationTarget[]>) {
  return dedupeInvalidationTargets(groups.flatMap((group) => [...group]));
}

export function buildTaskProjectionInvalidationTargets(
  context: InvalidationContext,
): InvalidationTarget[] {
  const targets: InvalidationTarget[] = [
    {
      kind: 'projection',
      projection: 'chatFeed',
    },
    {
      kind: 'projection',
      projection: 'workbenchLayout',
    },
    {
      kind: 'projection',
      projection: 'boardColumns',
    },
    {
      kind: 'projection',
      projection: 'projectList',
    },
    {
      kind: 'projection',
      projection: 'projectDetail',
    },
    {
      kind: 'projection',
      projection: 'historyFeed',
    },
  ];

  if (context.taskId) {
    targets.push({
      kind: 'entity',
      entity: 'task',
      ids: [context.taskId],
    });
  }

  if (context.conversationId) {
    targets.push({
      kind: 'entity',
      entity: 'conversation',
      ids: [context.conversationId],
    });
  }

  if (context.runId) {
    targets.push(
      {
        kind: 'entity',
        entity: 'run',
        ids: [context.runId],
      },
      {
        kind: 'projection',
        projection: 'historyEntry',
        keys: [context.runId],
      },
    );
  }

  if (context.includeUsageDashboard) {
    targets.push({
      kind: 'projection',
      projection: 'usageDashboard',
      keys: ['month', 'all_time'],
    });
  }

  return dedupeInvalidationTargets(targets);
}

export function createDesktopInvalidationEmitter(
  options: CreateDesktopInvalidationEmitterOptions = {},
) {
  const now = options.now ?? (() => new Date().toISOString());
  const createEventId = options.createEventId ?? defaultCreateEventId;

  return {
    emit(source: BackgroundInvalidationSource, targets: readonly InvalidationTarget[]) {
      if (!options.broadcast || targets.length === 0) {
        return;
      }

      options.broadcast(ipcChannels.events.invalidated, {
        eventId: createEventId(),
        issuedAt: now(),
        source,
        targets: dedupeInvalidationTargets(targets),
      } satisfies DesktopInvalidationEvent);
    },
  };
}
