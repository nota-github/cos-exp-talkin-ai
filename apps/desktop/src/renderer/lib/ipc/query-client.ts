import type {
  DesktopInvalidationEvent,
  DesktopQueryName,
  DesktopQueryRequest,
  DesktopQueryResponse,
  InvalidationTarget,
} from '../../../shared/ipc/contracts';
import { createRendererDesktopClient, type RendererDesktopClient } from './client';

type QueryStatus = 'idle' | 'loading' | 'success' | 'error';
type QueryListener = () => void;

export type DesktopQueryDescriptor<TName extends DesktopQueryName> = {
  key: string;
  name: TName;
  request: DesktopQueryRequest<TName>;
};

export type DesktopQuerySnapshot<TData> = {
  status: QueryStatus;
  data: TData | null;
  error: Error | null;
  updatedAt: string | null;
};

type QueryEntry<TName extends DesktopQueryName = DesktopQueryName> = {
  descriptor: DesktopQueryDescriptor<TName>;
  listeners: Set<QueryListener>;
  snapshot: DesktopQuerySnapshot<DesktopQueryResponse<TName>>;
  inFlight: Promise<DesktopQueryResponse<TName>> | null;
  needsRefetchAfterFlight: boolean;
};

type ProjectionInvalidationTarget = Extract<InvalidationTarget, { kind: 'projection' }>;
type EntityInvalidationTarget = Extract<InvalidationTarget, { kind: 'entity' }>;

type QueryLike<TName extends DesktopQueryName> = (
  request: DesktopQueryRequest<TName>,
) => Promise<DesktopQueryResponse<TName>>;

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
    .join(',')}}`;
}

function createIdleSnapshot<TData>(): DesktopQuerySnapshot<TData> {
  return {
    status: 'idle',
    data: null,
    error: null,
    updatedAt: null,
  };
}

function getTargetKey<TName extends DesktopQueryName>(
  descriptor: DesktopQueryDescriptor<TName>,
): string | null {
  switch (descriptor.name) {
    case 'getProjectDetail':
      return descriptor.request.projectId;
    case 'getHistoryFeed':
      return 'history-feed';
    case 'getHistoryEntry':
      return descriptor.request.runId;
    case 'getUsageDashboard':
      return descriptor.request.range;
    case 'getWorkbenchLayout':
      return descriptor.request.layoutId ?? null;
    default:
      return null;
  }
}

function matchesProjectionTarget<TName extends DesktopQueryName>(
  descriptor: DesktopQueryDescriptor<TName>,
  target: ProjectionInvalidationTarget,
): boolean {
  const projectionToQueryName: Record<ProjectionInvalidationTarget['projection'], DesktopQueryName> = {
    chatFeed: 'getChatFeed',
    workbenchLayout: 'getWorkbenchLayout',
    boardColumns: 'getBoardColumns',
    projectDetail: 'getProjectDetail',
    usageDashboard: 'getUsageDashboard',
    historyFeed: 'getHistoryFeed',
    historyEntry: 'getHistoryEntry',
    settings: 'getSettings',
  };

  if (projectionToQueryName[target.projection] !== descriptor.name) {
    return false;
  }

  if (!target.keys || target.keys.length === 0) {
    return true;
  }

  const queryTargetKey = getTargetKey(descriptor);
  return queryTargetKey !== null && target.keys.includes(queryTargetKey);
}

function matchesEntityTarget<TName extends DesktopQueryName>(
  descriptor: DesktopQueryDescriptor<TName>,
  target: EntityInvalidationTarget,
): boolean {
  const entityDependencies: Record<EntityInvalidationTarget['entity'], DesktopQueryName[]> = {
    task: ['getChatFeed', 'getWorkbenchLayout', 'getBoardColumns', 'getProjectDetail'],
    conversation: ['getChatFeed'],
    run: ['getHistoryFeed', 'getHistoryEntry'],
    settings: ['getSettings'],
  };

  return entityDependencies[target.entity].includes(descriptor.name);
}

function matchesInvalidationTarget<TName extends DesktopQueryName>(
  descriptor: DesktopQueryDescriptor<TName>,
  target: InvalidationTarget,
): boolean {
  if (target.kind === 'projection') {
    return matchesProjectionTarget(descriptor, target);
  }

  return matchesEntityTarget(descriptor, target);
}

function invokeQuery<TName extends DesktopQueryName>(
  client: RendererDesktopClient,
  descriptor: DesktopQueryDescriptor<TName>,
): Promise<DesktopQueryResponse<TName>> {
  const query = client.queries[descriptor.name] as QueryLike<TName>;
  return query(descriptor.request);
}

export function createDesktopQueryDescriptor<TName extends DesktopQueryName>(
  name: TName,
  request: DesktopQueryRequest<TName>,
): DesktopQueryDescriptor<TName> {
  return {
    key: `${name}:${stableSerialize(request)}`,
    name,
    request,
  };
}

export class DesktopQueryCache {
  private readonly entries = new Map<string, QueryEntry>();
  private readonly unsubscribeInvalidation: (() => void) | null;
  private readonly client: RendererDesktopClient;

  constructor(client: RendererDesktopClient) {
    this.client = client;
    this.unsubscribeInvalidation = client.available
      ? client.events.onInvalidation((event) => {
          void this.handleInvalidationEvent(event);
        })
      : null;
  }

  dispose() {
    this.unsubscribeInvalidation?.();
  }

  getSnapshot<TName extends DesktopQueryName>(
    descriptor: DesktopQueryDescriptor<TName>,
  ): DesktopQuerySnapshot<DesktopQueryResponse<TName>> {
    return this.ensureEntry(descriptor).snapshot;
  }

  subscribe<TName extends DesktopQueryName>(
    descriptor: DesktopQueryDescriptor<TName>,
    listener: QueryListener,
  ): () => void {
    const entry = this.ensureEntry(descriptor);
    entry.listeners.add(listener);

    return () => {
      entry.listeners.delete(listener);
    };
  }

  async fetchQuery<TName extends DesktopQueryName>(
    descriptor: DesktopQueryDescriptor<TName>,
  ): Promise<DesktopQueryResponse<TName>> {
    const entry = this.ensureEntry(descriptor);
    if (entry.inFlight) {
      return entry.inFlight as Promise<DesktopQueryResponse<TName>>;
    }

    entry.snapshot = {
      ...entry.snapshot,
      status: 'loading',
      error: null,
    };
    this.notify(entry);

    const pending = invokeQuery(this.client, descriptor)
      .then((data) => {
        const currentEntry = this.ensureEntry(descriptor);
        currentEntry.snapshot = {
          status: 'success',
          data,
          error: null,
          updatedAt: new Date().toISOString(),
        };
        this.notify(currentEntry);
        return data;
      })
      .catch((error) => {
        const currentEntry = this.ensureEntry(descriptor);
        currentEntry.snapshot = {
          ...currentEntry.snapshot,
          status: 'error',
          error: normalizeError(error),
        };
        this.notify(currentEntry);
        throw currentEntry.snapshot.error;
      })
      .finally(() => {
        const currentEntry = this.ensureEntry(descriptor);
        currentEntry.inFlight = null;
      });

    entry.inFlight = pending as Promise<DesktopQueryResponse<DesktopQueryName>>;

    return pending;
  }

  private ensureEntry<TName extends DesktopQueryName>(
    descriptor: DesktopQueryDescriptor<TName>,
  ): QueryEntry<TName> {
    const existing = this.entries.get(descriptor.key);
    if (existing) {
      return existing as QueryEntry<TName>;
    }

    const entry: QueryEntry<TName> = {
      descriptor,
      listeners: new Set<QueryListener>(),
      snapshot: createIdleSnapshot<DesktopQueryResponse<TName>>(),
      inFlight: null,
      needsRefetchAfterFlight: false,
    };
    this.entries.set(descriptor.key, entry as QueryEntry);
    return entry;
  }

  private async invalidateQuery<TName extends DesktopQueryName>(
    descriptor: DesktopQueryDescriptor<TName>,
  ) {
    const entry = this.ensureEntry(descriptor);

    if (!entry.inFlight) {
      await this.fetchQuery(descriptor);
      return;
    }

    entry.needsRefetchAfterFlight = true;

    try {
      await entry.inFlight;
    } catch {
      // The queued refetch below is responsible for converging on fresh source-of-truth data.
    }

    const currentEntry = this.ensureEntry(descriptor);

    if (!currentEntry.needsRefetchAfterFlight) {
      return;
    }

    currentEntry.needsRefetchAfterFlight = false;
    await this.fetchQuery(descriptor);
  }

  private async handleInvalidationEvent(event: DesktopInvalidationEvent) {
    const refetches: Promise<unknown>[] = [];

    for (const entry of this.entries.values()) {
      if (event.targets.some((target) => matchesInvalidationTarget(entry.descriptor, target))) {
        refetches.push(this.invalidateQuery(entry.descriptor));
      }
    }

    await Promise.allSettled(refetches);
  }

  private notify(entry: QueryEntry) {
    for (const listener of entry.listeners) {
      listener();
    }
  }
}

let defaultDesktopClient: RendererDesktopClient | null = null;
let defaultDesktopQueryCache: DesktopQueryCache | null = null;

export function getRendererDesktopClient() {
  if (!defaultDesktopClient) {
    defaultDesktopClient = createRendererDesktopClient();
  }

  return defaultDesktopClient;
}

export function getDesktopQueryCache() {
  if (!defaultDesktopQueryCache) {
    defaultDesktopQueryCache = new DesktopQueryCache(getRendererDesktopClient());
  }

  return defaultDesktopQueryCache;
}
