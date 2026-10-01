/**
 * Every Upcoming Release people you follow bought, the Bought shelf's "View more" (DESIGN-UI section 3, task 0037):
 * the weeks read forwards, nearest first, and a row is a Bought row with its release day as the trailing fact and
 * "1 of 4 tracks" after the label once a Track plays (task 0041, decision 9).
 */
import { useMemo } from 'react';
import { FlatList } from 'react-native';

import { useAppBarAtRest } from '@/components/AppBar';
import { Buyers, buyersFacts } from '@/components/Buyers';
import { EmptyState } from '@/components/EmptyState';
import { useDockClearance } from '@/components/player/Dock';
import { ReleaseRow, ROW_LIST } from '@/components/ReleaseRow';
import { WeekHead } from '@/components/WeekHead';
import { copy, dayLabel, outOnPhrase, spokenFacts, tracksOutPhrase } from '@/copy';
import type { ApiFeedItem } from '@/domain/apiTypes';
import { boughtHalves } from '@/domain/boughtChart';
import { releaseDay } from '@/lib/dates';
import { dayKey, releaseDayKey, useNow } from '@/lib/useNow';
import { buildUpcomingWeekSections } from '@/lib/weekSections';
import { useLiveQuery } from '@/state/appState';
import { readBoughtReleases } from '@/store/queries';

type Item =
  | { key: string; kind: 'empty' }
  | { key: string; kind: 'week'; heading: string; detail: string }
  | { key: string; kind: 'release'; release: ApiFeedItem; day: string; out: string; count: string | null };

function render({ item }: { item: Item }) {
  switch (item.kind) {
    case 'empty':
      return <EmptyState filling={copy.empty.fillingBought} nothing={copy.empty.nothing} />;
    case 'week':
      return <WeekHead week={item.heading} range={item.detail} />;
    case 'release':
      return (
        <ReleaseRow
          release={item.release}
          spoken={spokenFacts([item.count, item.out])}
          facts={buyersFacts(item.release, item.count, item.out)}
          boughtBy={item.release.buyers}
          detail={<Buyers release={item.release} fact={item.count} trailing={item.day} />}
        />
      );
  }
}

export default function UpcomingBought() {
  useAppBarAtRest();
  const clearance = useDockClearance();
  const now = useNow();
  const day = dayKey(now);
  const gmtDay = releaseDayKey(now);
  const held = useLiveQuery(readBoughtReleases);

  const items = useMemo(() => {
    const list: Item[] = [];
    if (held === null) return list;
    const at = new Date(day);
    const dayOf = (date: Date) => releaseDay(date.toISOString());
    const upcoming = boughtHalves(held, new Date(gmtDay)).upcoming.flatMap((r) => (r.releaseDate === null ? [] : [{ item: r.item, on: dayOf(r.releaseDate) }]));
    for (const week of buildUpcomingWeekSections(upcoming, (r) => r.on, at)) {
      list.push({ key: week.key, kind: 'week', heading: week.heading, detail: week.detail });
      for (const r of week.entries) {
        const count = tracksOutPhrase(r.item.numStreamableTracks, r.item.numTracks);
        list.push({ key: `${r.item.itemType}:${r.item.itemId}`, kind: 'release', release: r.item, day: dayLabel(r.on, at), out: outOnPhrase(r.on, at), count });
      }
    }
    if (list.length === 0) list.push({ key: 'empty', kind: 'empty' });
    return list;
  }, [held, day, gmtDay]);

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
