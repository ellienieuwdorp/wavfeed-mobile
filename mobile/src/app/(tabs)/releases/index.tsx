/**
 * New releases on the store: the Upcoming shelf, then the released weeks and the quiet gaps between them, newest
 * first (DESIGN-UI section 3, task 0037). Rows carry the day, the credit line and the faces of who bought it (task
 * 0071, decisions 10 to 12). A Drop is the same row on its day, its day "out Tue 13 Oct" and its count the "1/4" pill,
 * and its art plays the Release from the newest Track it let out (task 0041, decision 10).
 */
import { useMemo } from 'react';
import { FlatList, RefreshControl } from 'react-native';

import { useAppBar } from '@/components/AppBar';
import { EmptyState } from '@/components/EmptyState';
import { GapRow } from '@/components/GapRow';
import { useDockClearance } from '@/components/player/Dock';
import type { RowRelease } from '@/components/playable';
import { ReleaseRow, ROW_LIST } from '@/components/ReleaseRow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { UpcomingShelf, type ShelfCard } from '@/components/UpcomingShelf';
import { WeekHead } from '@/components/WeekHead';
import { copy, dayLabel, onDayPhrase, outOnPhrase, PAGES_GAP_TAIL } from '@/copy';
import type { ApiFanRef } from '@/domain/apiTypes';
import { releaseDay } from '@/lib/dates';
import { dayKey, releaseDayKey, useNow } from '@/lib/useNow';
import { buildSectionsFromWeeks } from '@/lib/weekSections';
import { useLiveQuery } from '@/state/appState';
import { useRefresh } from '@/state/refresh';
import { readNewReleases } from '@/store';
import { useTokens } from '@/theme/tokens';

type Row = RowRelease & { readonly buyers: readonly ApiFanRef[] };

type Item =
  | { key: string; kind: 'header' }
  | { key: string; kind: 'empty' }
  | { key: string; kind: 'shelf'; cards: readonly ShelfCard[] }
  | { key: string; kind: 'week'; heading: string; detail: string }
  | { key: string; kind: 'release'; release: Row; day: string; rule: boolean }
  | { key: string; kind: 'drop'; release: Row; day: string; tracksOut: number; numTracks: number | null; from: string | null; rule: boolean }
  | { key: string; kind: 'gap'; text: string };

function render({ item }: { item: Item }) {
  switch (item.kind) {
    case 'header':
      return <ScreenHeader />;
    case 'empty':
      return <EmptyState filling={copy.empty.fillingReleases} nothing={copy.empty.nothing} />;
    case 'shelf':
      return <UpcomingShelf cards={item.cards} more="/releases/upcoming" />;
    case 'week':
      return <WeekHead week={item.heading} range={item.detail} />;
    case 'gap':
      return <GapRow text={item.text} />;
    case 'release':
      return <ReleaseRow release={item.release} day={item.day} buyers={item.release.buyers} rule={item.rule} />;
    case 'drop':
      return <ReleaseRow release={item.release} day={item.day} tracksOut={item.tracksOut} numTracks={item.numTracks} buyers={item.release.buyers} from={item.from} rule={item.rule} />;
  }
}

export default function NewReleases() {
  const { c } = useTokens();
  const clearance = useDockClearance();
  const now = useNow();
  const day = dayKey(now);
  // Classification changes at GMT midnight independently of the local-day labels below (ADR-0017, task 0070).
  const releaseDate = releaseDayKey(now);
  const view = useLiveQuery((db) => readNewReleases(db, { now: new Date() }), releaseDate);
  const { refreshing, onRefresh } = useRefresh('releases');
  const appBar = useAppBar();

  const items = useMemo(() => {
    const list: Item[] = [{ key: 'header', kind: 'header' }];
    if (view === null) return list;
    const at = new Date(day);
    if (view.upcoming.length > 0) {
      const cards = view.upcoming.map((r) => {
        const on = releaseDay(r.releaseDate);
        return { key: `${r.itemType}:${r.itemId}`, release: r, day: onDayPhrase(on, at), out: outOnPhrase(on, at), tracksOut: r.numStreamableTracks, numTracks: r.numTracks, buyers: r.buyers };
      });
      list.push({ key: 'shelf', kind: 'shelf', cards });
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
      section.entries.forEach((placed, n) => {
        // The last row of a week draws no hairline above the next week's head (task 0071, decision 10).
        const rule = n < section.entries.length - 1;
        // A Drop's key names its day, so a Release's Drops and later its own row never share one (task 0041, decision 10).
        if (placed.kind === 'drop') {
          const { tracksOut, numTracks } = placed;
          list.push({ key: placed.key, kind: 'drop', release: placed.release, day: outOnPhrase(placed.releaseDay, at), tracksOut, numTracks, from: placed.newestTrackId, rule });
        } else {
          list.push({ key: placed.key, kind: 'release', release: placed.release, day: dayLabel(placed.date, at), rule });
        }
      });
    }
    if (list.length === 1) list.push({ key: 'empty', kind: 'empty' });
    return list;
  }, [view, day]);

  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.key}
      renderItem={render}
      {...ROW_LIST}
      {...appBar.scroll}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 32 + clearance }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[c.accent]} progressBackgroundColor={c.surface} progressViewOffset={appBar.refreshOffset} />}
    />
  );
}
