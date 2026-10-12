/**
 * Every Upcoming Release from New releases, the shelf's "View more" (DESIGN-UI section 3, task 0037): the weeks read
 * forwards, nearest first, with no quiet gaps, and the rows are the released weeks' own, their day "out Tue 13 Oct"
 * and the "1/4" pill once a Track plays (task 0071, decisions 10 and 12).
 */
import { useMemo } from 'react';
import { FlatList } from 'react-native';

import { useAppBarAtRest } from '@/components/AppBar';
import { EmptyState } from '@/components/EmptyState';
import { useDockClearance } from '@/components/player/Dock';
import { ReleaseRow, ROW_LIST } from '@/components/ReleaseRow';
import { WeekHead } from '@/components/WeekHead';
import { copy, onDayPhrase } from '@/copy';
import type { ApiUpcomingRelease } from '@/domain/apiTypes';
import { releaseDay } from '@/lib/dates';
import { dayKey, releaseDayKey, useNow } from '@/lib/useNow';
import { buildUpcomingWeekSections } from '@/lib/weekSections';
import { useLiveQuery } from '@/state/appState';
import { readNewReleases } from '@/store';

type Item =
  | { key: string; kind: 'empty' }
  | { key: string; kind: 'week'; heading: string; detail: string }
  | { key: string; kind: 'release'; release: ApiUpcomingRelease; day: string; tracksOut: number | null; numTracks: number | null; rule: boolean };

function render({ item }: { item: Item }) {
  switch (item.kind) {
    case 'empty':
      return <EmptyState filling={copy.empty.fillingReleases} nothing={copy.empty.nothing} />;
    case 'week':
      return <WeekHead week={item.heading} range={item.detail} />;
    case 'release':
      return <ReleaseRow release={item.release} day={item.day} tracksOut={item.tracksOut} numTracks={item.numTracks} buyers={item.release.buyers} rule={item.rule} />;
  }
}

export default function UpcomingReleases() {
  useAppBarAtRest();
  const clearance = useDockClearance();
  const now = useNow();
  const day = dayKey(now);
  // Classification changes at GMT midnight independently of the local-day labels below (ADR-0017, task 0070).
  const releaseDate = releaseDayKey(now);
  const view = useLiveQuery((db) => readNewReleases(db, { now: new Date() }), releaseDate);

  const items = useMemo(() => {
    const list: Item[] = [];
    if (view === null) return list;
    const at = new Date(day);
    for (const week of buildUpcomingWeekSections(view.upcoming, (r) => releaseDay(r.releaseDate), at)) {
      list.push({ key: week.key, kind: 'week', heading: week.heading, detail: week.detail });
      week.entries.forEach((r, n) => {
        const rule = n < week.entries.length - 1;
        // Every row here is upcoming, so the eyebrow drops "out" as R5 names draws it (task 0071, decision 10, amended by the author 2026-10-12).
        const day = onDayPhrase(releaseDay(r.releaseDate), at);
        list.push({ key: `${r.itemType}:${r.itemId}`, kind: 'release', release: r, day, tracksOut: r.numStreamableTracks, numTracks: r.numTracks, rule });
      });
    }
    if (list.length === 0) list.push({ key: 'empty', kind: 'empty' });
    return list;
  }, [view, day]);

  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.key}
      renderItem={render}
      {...ROW_LIST}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 32 + clearance }}
    />
  );
}
