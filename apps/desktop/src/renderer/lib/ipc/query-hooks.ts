import { useEffect, useSyncExternalStore } from 'react';
import type {
  DesktopQueryDescriptor,
  DesktopQuerySnapshot,
  DesktopQueryCache,
} from './query-client';
import type {
  DesktopQueryName,
  DesktopQueryResponse,
} from '../../../shared/ipc/contracts';

const disabledQuerySnapshot = {
  status: 'idle',
  data: null,
  error: null,
  updatedAt: null,
} as const;

export function useDesktopQuery<TName extends DesktopQueryName>(
  queryCache: DesktopQueryCache,
  descriptor: DesktopQueryDescriptor<TName>,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void queryCache.fetchQuery(descriptor);
  }, [descriptor.key, enabled, queryCache]);

  const getSnapshot = () =>
    enabled
      ? queryCache.getSnapshot(descriptor)
      : (disabledQuerySnapshot as DesktopQuerySnapshot<DesktopQueryResponse<TName>>);

  return useSyncExternalStore(
    (listener) => (enabled ? queryCache.subscribe(descriptor, listener) : () => undefined),
    getSnapshot,
    getSnapshot,
  );
}
