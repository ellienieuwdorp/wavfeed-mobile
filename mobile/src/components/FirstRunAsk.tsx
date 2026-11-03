/**
 * Presents the usage ask once, after a sign-in: when the store
 * holds a signed-in Fan that is not the Demo, no answer is held and Connect is not open (`usageAskDue`). So it follows
 * the sign-in that closes Connect on a first run or replaces the Demo, and on an install that predates the sender it
 * comes on the first launch after the update; the first screen and looking around never see it. The `usageAsked` flag in kv
 * keeps it to once, and "Remove everything gathered" takes the flag with the store, so the ask returns. A build that
 * can never send never asks. Renders nothing.
 */
import { router, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useAppState } from '@/state/appState';
import { readKv, writeKv } from '@/store';
import { useSharing } from '@/tally/Sharing';
import { usageAskDue } from '@/tally/tally';

export const USAGE_ASKED_KEY = 'usageAsked';

export function FirstRunAsk() {
  const { db, gather } = useAppState();
  const { canSend, loaded, sharing } = useSharing();
  const pathname = usePathname();
  const asked = useRef(false);
  const due = usageAskDue({ canSend, loaded, sharing, fanId: gather.identity?.fanId ?? null, pathname });
  useEffect(() => {
    if (!due || asked.current) return;
    asked.current = true;
    void (async () => {
      if ((await readKv<boolean>(db, USAGE_ASKED_KEY)) !== null) return;
      await writeKv(db, USAGE_ASKED_KEY, true);
      router.push('/usage');
    })().catch(() => undefined);
  }, [db, due]);
  return null;
}
