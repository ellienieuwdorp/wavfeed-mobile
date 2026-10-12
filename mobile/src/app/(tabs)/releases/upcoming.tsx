/**
 * Every Upcoming Release from New releases, the shelf's "View more" (DESIGN-UI section 3, task 0037): the weeks read
 * forwards, nearest first, with no quiet gaps, and the rows are the released weeks' own, with "1 of 4 tracks" after the
 * label once a Track plays (task 0041, decision 9).
 */
import { useMemo } from 'react';
import { FlatList } from 'react-native';

import { useAppBarAtRest } from '@/components/AppBar';
import { EmptyState } from '@/components/EmptyState';
import { useDockClearance } from '@/components/player/Dock';
import { FactLine, ReleaseRow, ROW_LIST } from '@/components/ReleaseRow';
import { WeekHead } from '@/components/WeekHead';
import { actorSentence, copy, dayLabel, outOnPhrase, SELF_RELEASED, spokenFacts, tracksOutPhrase } from '@/copy';
import type { ApiUpcomingRelease } from '@/domain/apiTypes';
import { releaseDay } from '@/lib/dates';
import { dayKey, releaseDayKey, useNow } from '@/lib/useNow';
import { buildUpcomingWeekSections } from '@/lib/weekSections';
import { useLiveQuery } from '@/state/appState';
import { readNewReleases } from '@/store';

type Item =
  | { key: string; kind: 'empty' }
  | { key: string; kind: 'week'; heading: string; detail: string }
  | { key: string; kind: 'release'; release: ApiUpcomingRelease; day: string; out: string; count: string | null };

function render({ item }: { item: Item }) {
  switch (item.kind) {
    case 'empty':
      return <EmptyState filling={copy.empty.fillingReleases} nothing={copy.empty.nothing} />;
    case 'week':
      return <WeekHead week={item.heading} range={item.detail} />;
    case 'release':
      return (
        <ReleaseRow
          release={item.release}
          spoken={spokenFacts([item.count, item.out])}
          facts={spokenFacts([item.release.label ?? SELF_RELEASED, item.count, actorSentence(item.release), item.out])}
          detail={<FactLine parts={[item.release.label ?? SELF_RELEASED, item.count, actorSentence(item.release)]} trailing={item.day} />}
        />
      );
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
      for (const r of week.entries) {
        const on = releaseDay(r.releaseDate);
        const count = tracksOutPhrase(r.numStreamableTracks, r.numTracks);
        list.push({ key: `${r.itemType}:${r.itemId}`, kind: 'release', release: r, day: dayLabel(on, at), out: outOnPhrase(on, at), count });
      }
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
