/** Pull to refresh on a collection tab: a refresh turn, the spinner held until the turn returns (task 0036, decision 4). */
import { useCallback, useState } from 'react';

import { useAppState } from './appState';

export function useRefresh(): { refreshing: boolean; onRefresh: () => void } {
  const { runGather } = useAppState();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void runGather('refresh')
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  }, [runGather]);
  return { refreshing, onRefresh };
}
