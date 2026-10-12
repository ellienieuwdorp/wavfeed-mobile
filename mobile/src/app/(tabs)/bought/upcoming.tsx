/**
 * Every Upcoming Release people you follow bought (DESIGN-UI section 3, task 0037): the weeks read forwards, nearest
 * first, in New releases' rows. Nothing links here since the Bought view lost its shelf (task 0071, decision 14); the
 * route goes with Bought's tab (task 0071, slice 4).
 */
import { useMemo } from 'react';
import { FlatList } from 'react-native';

import { useAppBarAtRest } from '@/components/AppBar';
import { EmptyState } from '@/components/EmptyState';
import { useDockClearance } from '@/components/player/Dock';
import { ReleaseRow, ROW_LIST } from '@/components/ReleaseRow';
import { WeekHead } from '@/components/WeekHead';
import { copy, outOnPhrase } from '@/copy';
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
  | { key: string; kind: 'release'; release: ApiFeedItem; day: string; rule: boolean };

function render({ item }: { item: Item }) {
  switch (item.kind) {
    case 'empty':
      return <EmptyState filling={copy.empty.fillingBought} nothing={copy.empty.nothing} />;
    case 'week':
      return <WeekHead week={item.heading} range={item.detail} />;
    case 'release':
      return <ReleaseRow release={item.release} day={item.day} tracksOut={item.release.numStreamableTracks} numTracks={item.release.numTracks} buyers={item.release.buyers} rule={item.rule} />;
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
      week.entries.forEach((r, n) => {
        list.push({ key: `${r.item.itemType}:${r.item.itemId}`, kind: 'release', release: r.item, day: outOnPhrase(r.on, at), rule: n < week.entries.length - 1 });
      });
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
