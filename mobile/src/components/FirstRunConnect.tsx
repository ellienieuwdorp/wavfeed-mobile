/**
 * Presents Connect Bandcamp once, by itself, on the first launch of a store that has never held a signed-in Fan
 * (task 0036); the `connectShown` flag in kv keeps it to once, and Settings reopens it after. Its children mount once
 * that is decided, told whether Connect was pushed, so the usage ask (task 0038) follows it and never races it.
 */
import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useAppState } from '@/state/appState';
import { CONNECT_SHOWN_KEY, readStoredIdentity } from '@/state/gatherSink';
import { readKv, writeKv } from '@/store';
import { connectHref } from '@/tally/actions';

export function FirstRunConnect({ children }: { children: (pushed: boolean) => ReactNode }) {
  const { db } = useAppState();
  const ready = useRootNavigationState()?.key !== undefined;
  const asked = useRef(false);
  const [pushed, setPushed] = useState<boolean | null>(null);
  useEffect(() => {
    if (!ready || asked.current) return;
    asked.current = true;
    void (async () => {
      if ((await readKv<boolean>(db, CONNECT_SHOWN_KEY)) !== null) return false;
      await writeKv(db, CONNECT_SHOWN_KEY, true);
      if ((await readStoredIdentity(db)) !== null) return false;
      router.push(connectHref('first_run'));
      return true;
    })()
      .catch(() => false)
      .then(setPushed);
  }, [db, ready]);
  return pushed === null ? null : children(pushed);
}
