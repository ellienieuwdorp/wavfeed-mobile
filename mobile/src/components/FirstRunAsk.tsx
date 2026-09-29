/**
 * Presents the usage ask once (task 0038 decision 3): after Connect closes on a first run, signed in or "Not now", and
 * on the first launch of an install that predates the sender. The `usageAsked` flag in kv keeps it to once, and
 * "Remove everything gathered" takes the flag with the store, so the ask returns. A build that can never send never
 * asks. Renders nothing.
 */
import { router, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useAppState } from '@/state/appState';
import { readKv, writeKv } from '@/store';
import { useSharing } from '@/tally/Sharing';

export const USAGE_ASKED_KEY = 'usageAsked';

/** `connectPushed`: Connect was pushed this launch, so the ask waits until it has shown and closed. */
export function FirstRunAsk({ connectPushed }: { connectPushed: boolean }) {
  const { db } = useAppState();
  const { canSend, loaded, sharing } = useSharing();
  const pathname = usePathname();
  const connectSeen = useRef(!connectPushed);
  const asked = useRef(false);
  useEffect(() => {
    if (pathname === '/connect') connectSeen.current = true;
    const due = canSend && loaded && sharing === null && connectSeen.current && pathname !== '/connect';
    if (!due || asked.current) return;
    asked.current = true;
    void (async () => {
      if ((await readKv<boolean>(db, USAGE_ASKED_KEY)) !== null) return;
      await writeKv(db, USAGE_ASKED_KEY, true);
      router.push('/usage');
    })().catch(() => undefined);
  }, [db, canSend, loaded, sharing, pathname]);
  return null;
}
