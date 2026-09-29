/**
 * What every view says about gathering (DESIGN-UI section 9, in the phone's places): the line under the large title,
 * "Updated 12 min ago" or, while the first walk runs unpaused, the note to keep the app open (task 0040); the catch-up
 * pair with how far back the walk has reached and the fill `walkProgress` estimates, never moving back while the app
 * runs, which the header carries over that note (see ScreenHeader); and which empty state a view with no rows draws. The first walk counts as running between turns
 * too, until it finishes or Bandcamp pauses it; only a turn in flight moves the indeterminate sweep. The Demo says it is a sample in the header line instead (task 0043).
 */
import { backTo, soFar, updatedAgo, copy } from '@/copy';
import { isDemoFan } from '@/demo/demo';
import { useNow } from '@/lib/useNow';

import { useAppState, useLiveQuery } from './appState';
import { readStoredIdentity, readStoredWalk } from './gatherSink';
import { forwardOnly, walkProgress } from './walkProgress';

export type CatchUpLine = {
  readonly primary: string;
  readonly secondary: string | null;
  readonly moving: boolean;
  /** 0 to 0.99 once there is a floor and a sample to estimate from; null draws the indeterminate sweep. */
  readonly fraction: number | null;
};

export type GatherStatus = {
  /** False until the store has answered; views draw no empty state before it. */
  readonly loaded: boolean;
  /** Whether this store has ever held a signed-in Fan. */
  readonly hasIdentity: boolean;
  readonly catchingUp: boolean;
  /** The quiet line under each large title. */
  readonly header: string | null;
  readonly catchUp: CatchUpLine | null;
};

export function useGatherStatus(): GatherStatus {
  const { gather } = useAppState();
  const now = useNow();
  const held = useLiveQuery(async (db) => ({ identity: await readStoredIdentity(db), walk: await readStoredWalk(db) }));
  const hasIdentity = held?.identity != null || gather.identity !== null;
  const walk = held?.walk ?? null;
  const catchingUp =
    hasIdentity && !gather.initialWalkDone && (gather.phase !== 'idle' || walk !== null || gather.pausedReason === null);

  let catchUp: CatchUpLine | null = null;
  if (catchingUp) {
    const { reachedAt, fraction: estimate } = walkProgress(walk, gather.storiesSoFar);
    const fraction = estimate === null || walk === null ? null : forwardOnly(walk.startedAt, estimate);
    catchUp =
      gather.storiesSoFar === 0 && gather.phase === 'probing'
        ? { primary: copy.catchUp.settingUp, secondary: null, moving: true, fraction: null }
        : {
            primary: soFar(gather.storiesSoFar),
            secondary: reachedAt === null ? copy.catchUp.gathering : backTo(reachedAt),
            moving: gather.phase !== 'idle',
            fraction,
          };
  }
  // A walk paused on a sign-out moves again only after one, so the note to keep the app open waits for it (task 0040).
  let header: string | null = null;
  if (isDemoFan(gather.identity?.fanId)) header = copy.demo.header;
  else if (catchingUp) header = gather.pausedReason === null ? copy.catchUp.keepOpen : null;
  else if (gather.lastSuccessAt !== null) header = updatedAgo(gather.lastSuccessAt, now);
  return { loaded: held !== null, hasIdentity, catchingUp, header, catchUp };
}
