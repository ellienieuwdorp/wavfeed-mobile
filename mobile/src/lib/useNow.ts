/** The clock the relative lines read ("Updated 12 min ago", "Today"), ticking every half minute while mounted. */
import { useEffect, useState } from 'react';

export const NOW_TICK_MS = 30_000;

export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), NOW_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Local midnight today, as a number: a dependency that moves once a day. */
export function dayKey(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** The first instant of today's GMT day, the day a release date is judged against (ADR-0017): moves once a day. */
export function releaseDayKey(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}
