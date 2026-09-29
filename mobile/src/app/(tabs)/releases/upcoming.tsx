/**
 * Every Upcoming Release from New releases, the shelf's "View more" (DESIGN-UI section 3, task 0037): the weeks read
 * forwards, nearest first, with no quiet gaps, and the rows are the released weeks' own.
 */
import { useMemo } from 'react';
import { FlatList } from 'react-native';

import { useAppBarAtRest } from '@/components/AppBar';
import { EmptyState } from '@/components/EmptyState';
import { useDockClearance } from '@/components/player/Dock';
import { FactLine, ReleaseRow, STRICT_ROW_LIST } from '@/components/ReleaseRow';
import { WeekHead } from '@/components/WeekHead';
import { actorSentence, copy, dayLabel, SELF_RELEASED } from '@/copy';
import type { ApiUpcomingRelease } from '@/domain/apiTypes';
import { releaseDay } from '@/lib/dates';
import { dayKey, useNow } from '@/lib/useNow';
import { buildUpcomingWeekSections } from '@/lib/weekSections';
import { useLiveQuery } from '@/state/appState';
import { readNewReleases } from '@/store';

type Item =
  | { key: string; kind: 'empty' }
  | { key: string; kind: 'week'; heading: string; detail: string }
  | { key: string; kind: 'release'; release: ApiUpcomingRelease; day: string };

function render({ item }: { item: Item }) {
  switch (item.kind) {
    case 'empty':
      return <EmptyState filling={copy.empty.fillingReleases} nothing={copy.empty.nothing} />;
    case 'week':
      return <WeekHead week={item.heading} range={item.detail} />;
    case 'release':
      return <ReleaseRow release={item.release} detail={<FactLine parts={[item.release.label ?? SELF_RELEASED, actorSentence(item.release)]} trailing={item.day} />} />;
  }
}

export default function UpcomingReleases() {
  useAppBarAtRest();
  const clearance = useDockClearance();
  const day = dayKey(useNow());
  const view = useLiveQuery((db) => readNewReleases(db, { now: new Date() }), [day]);

  const items = useMemo(() => {
    const list: Item[] = [];
    if (view === null) return list;
    const at = new Date(day);
    for (const week of buildUpcomingWeekSections(view.upcoming, (r) => releaseDay(r.releaseDate), at)) {
      list.push({ key: week.key, kind: 'week', heading: week.heading, detail: week.detail });
      for (const r of week.entries) {
        list.push({ key: `${r.itemType}:${r.itemId}`, kind: 'release', release: r, day: dayLabel(releaseDay(r.releaseDate), at) });
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
      {...STRICT_ROW_LIST}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 32 + clearance }}
    />
  );
}
