/**
 * New releases on the store: the Upcoming band with its forward week heads, then the released weeks and the quiet
 * gaps between them (DESIGN-UI section 3). Rows carry label, who bought or wishlisted it, and the day.
 */
import { useMemo } from 'react';
import { FlatList, RefreshControl } from 'react-native';

import { useAppBar } from '@/components/AppBar';
import { EmptyState } from '@/components/EmptyState';
import { GapRow } from '@/components/GapRow';
import { useDockClearance } from '@/components/player/Dock';
import type { RowRelease } from '@/components/playable';
import { FactLine, ReleaseRow, STRICT_ROW_LIST } from '@/components/ReleaseRow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { BandHead, WeekHead } from '@/components/WeekHead';
import { actorSentence, copy, dayLabel, PAGES_GAP_TAIL, SELF_RELEASED, UPCOMING_HEAD } from '@/copy';
import type { ApiFanRef } from '@/domain/apiTypes';
import { releaseDay } from '@/lib/dates';
import { dayKey, useNow } from '@/lib/useNow';
import { buildSectionsFromWeeks, buildUpcomingWeekSections } from '@/lib/weekSections';
import { useLiveQuery } from '@/state/appState';
import { useRefresh } from '@/state/refresh';
import { readNewReleases } from '@/store';
import { useTokens } from '@/theme/tokens';

type Row = RowRelease & { readonly label: string | null; readonly buyers: readonly ApiFanRef[]; readonly wishlisters: readonly ApiFanRef[] };

type Item =
  | { key: string; kind: 'header' }
  | { key: string; kind: 'empty' }
  | { key: string; kind: 'band' }
  | { key: string; kind: 'week'; heading: string; detail: string }
  | { key: string; kind: 'release'; release: Row; day: string }
  | { key: string; kind: 'gap'; text: string };

function render({ item }: { item: Item }) {
  switch (item.kind) {
    case 'header':
      return <ScreenHeader />;
    case 'empty':
      return <EmptyState filling={copy.empty.fillingReleases} nothing={copy.empty.nothing} />;
    case 'band':
      return <BandHead label={UPCOMING_HEAD} />;
    case 'week':
      return <WeekHead week={item.heading} range={item.detail} />;
    case 'gap':
      return <GapRow text={item.text} />;
    case 'release':
      return <ReleaseRow release={item.release} detail={<FactLine parts={[item.release.label ?? SELF_RELEASED, actorSentence(item.release)]} trailing={item.day} />} />;
  }
}

export default function NewReleases() {
  const { c } = useTokens();
  const clearance = useDockClearance();
  const now = useNow();
  const day = dayKey(now);
  const view = useLiveQuery((db) => readNewReleases(db, { now: new Date() }), [day]);
  const { refreshing, onRefresh } = useRefresh();
  const appBar = useAppBar();

  const items = useMemo(() => {
    const list: Item[] = [{ key: 'header', kind: 'header' }];
    if (view === null) return list;
    const at = new Date(day);
    const upcoming = buildUpcomingWeekSections(view.upcoming, (r) => releaseDay(r.releaseDate), at);
    if (upcoming.length > 0) list.push({ key: 'band', kind: 'band' });
    for (const week of upcoming) {
      list.push({ key: week.key, kind: 'week', heading: week.heading, detail: week.detail });
      for (const r of week.entries) {
        list.push({ key: `u:${r.itemType}:${r.itemId}`, kind: 'release', release: r, day: dayLabel(releaseDay(r.releaseDate), at) });
      }
    }
    const released = buildSectionsFromWeeks(
      view.weeks.map((w) => ({ start: w.weekStart, entries: w.releases })),
      at,
      { gapTail: PAGES_GAP_TAIL },
    );
    for (const section of released) {
      if (section.kind === 'gap') {
        list.push({ key: section.key, kind: 'gap', text: section.label });
        continue;
      }
      list.push({ key: section.key, kind: 'week', heading: section.heading, detail: section.detail });
      for (const placed of section.entries) {
        list.push({ key: placed.key, kind: 'release', release: placed.release, day: dayLabel(placed.date, at) });
      }
    }
    if (list.length === 1) list.push({ key: 'empty', kind: 'empty' });
    return list;
  }, [view, day]);

  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.key}
      renderItem={render}
      {...STRICT_ROW_LIST}
      {...appBar.scroll}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 32 + clearance }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[c.accent]} progressBackgroundColor={c.surface} progressViewOffset={appBar.refreshOffset} />}
    />
  );
}
