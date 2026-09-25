/**
 * Presents Connect Bandcamp once, by itself, on the first launch of a store that has never held a signed-in Fan
 * (task 0036); the `connectShown` flag in kv keeps it to once, and Settings reopens it after. Renders nothing.
 */
import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useAppState } from '@/state/appState';
import { CONNECT_SHOWN_KEY, readStoredIdentity } from '@/state/gatherSink';
import { readKv, writeKv } from '@/store';

export function FirstRunConnect() {
  const { db } = useAppState();
  const ready = useRootNavigationState()?.key !== undefined;
  const asked = useRef(false);
  useEffect(() => {
    if (!ready || asked.current) return;
    asked.current = true;
    void (async () => {
      if ((await readKv<boolean>(db, CONNECT_SHOWN_KEY)) !== null) return;
      await writeKv(db, CONNECT_SHOWN_KEY, true);
      if ((await readStoredIdentity(db)) === null) router.push('/connect');
    })().catch(() => undefined);
  }, [db, ready]);
  return null;
}
