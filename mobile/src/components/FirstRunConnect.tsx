/**
 * Presents Connect Bandcamp once, by itself, on the first launch of a store that has never held a signed-in Fan
 * (task 0036); the `connectShown` flag in kv keeps it to once, and Settings reopens it after. Its children mount once
 * that is decided, so the usage ask (task 0044) reads a settled store and never races it.
 */
import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useAppState } from '@/state/appState';
import { CONNECT_SHOWN_KEY, readStoredIdentity } from '@/state/gatherSink';
import { readKv, writeKv } from '@/store';
import { connectHref } from '@/tally/actions';

export function FirstRunConnect({ children }: { children: ReactNode }) {
  const { db } = useAppState();
  const ready = useRootNavigationState()?.key !== undefined;
  const asked = useRef(false);
  const [decided, setDecided] = useState(false);
  useEffect(() => {
    if (!ready || asked.current) return;
    asked.current = true;
    void (async () => {
      if ((await readKv<boolean>(db, CONNECT_SHOWN_KEY)) !== null) return;
      await writeKv(db, CONNECT_SHOWN_KEY, true);
      if ((await readStoredIdentity(db)) !== null) return;
      router.push(connectHref('first_run'));
    })()
      .catch(() => undefined)
      .then(() => setDecided(true));
  }, [db, ready]);
  return decided ? children : null;
}
