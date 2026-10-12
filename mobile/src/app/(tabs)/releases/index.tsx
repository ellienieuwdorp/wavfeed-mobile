/**
 * New releases on the store: the Upcoming shelf, then the released weeks and the quiet gaps between them, newest
 * first (DESIGN-UI section 3, task 0037). Rows carry label, who bought or wishlisted it, and the day. A Drop is the
 * same row on its day, its second line "1 of 4 tracks · out Tue 13 Oct", and its art plays the Release from the newest
 * Track it let out (task 0041, decision 10).
 */
import { useMemo } from 'react';
import { FlatList, RefreshControl } from 'react-native';

import { useAppBar } from '@/components/AppBar';
import { EmptyState } from '@/components/EmptyState';
import { GapRow } from '@/components/GapRow';
import { useDockClearance } from '@/components/player/Dock';
import type { RowRelease } from '@/components/playable';
import { FactLine, ReleaseRow, ROW_LIST } from '@/components/ReleaseRow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { UpcomingShelf, type ShelfCard } from '@/components/UpcomingShelf';
import { WeekHead } from '@/components/WeekHead';
import { actorSentence, copy, dayLabel, outOnPhrase, PAGES_GAP_TAIL, SELF_RELEASED, spokenFacts, tracksOutPhrase } from '@/copy';
import type { ApiFanRef } from '@/domain/apiTypes';
import { releaseDay } from '@/lib/dates';
import { dayKey, releaseDayKey, useNow } from '@/lib/useNow';
import { buildSectionsFromWeeks } from '@/lib/weekSections';
import { useLiveQuery } from '@/state/appState';
import { useRefresh } from '@/state/refresh';
import { readNewReleases } from '@/store';
import { useTokens } from '@/theme/tokens';

type Row = RowRelease & { readonly label: string | null; readonly buyers: readonly ApiFanRef[]; readonly wishlisters: readonly ApiFanRef[] };

type Item =
  | { key: string; kind: 'header' }
  | { key: string; kind: 'empty' }
  | { key: string; kind: 'shelf'; cards: readonly ShelfCard[] }
  | { key: string; kind: 'week'; heading: string; detail: string }
  | { key: string; kind: 'release'; release: Row; day: string }
  | { key: string; kind: 'drop'; release: Row; count: string | null; out: string; from: string | null }
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
    case 'release': {
      const parts = [item.release.label ?? SELF_RELEASED, actorSentence(item.release)];
      return <ReleaseRow release={item.release} facts={spokenFacts([...parts, item.day])} detail={<FactLine parts={parts} trailing={item.day} />} />;
    }
    case 'drop': {
      const facts = [item.count, item.out];
      return <ReleaseRow release={item.release} from={item.from} spoken={spokenFacts(facts)} detail={<FactLine parts={facts} />} />;
    }
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
        return { key: `${r.itemType}:${r.itemId}`, release: r, day: dayLabel(on, at), out: outOnPhrase(on, at), count: tracksOutPhrase(r.numStreamableTracks, r.numTracks) };
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
      for (const placed of section.entries) {
        // A Drop's key names its day, so a Release's Drops and later its own row never share one (task 0041, decision 10).
        if (placed.kind === 'drop') {
          const count = tracksOutPhrase(placed.tracksOut, placed.numTracks);
          list.push({ key: placed.key, kind: 'drop', release: placed.release, count, out: outOnPhrase(placed.releaseDay, at), from: placed.newestTrackId });
        } else {
          list.push({ key: placed.key, kind: 'release', release: placed.release, day: dayLabel(placed.date, at) });
        }
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
      {...ROW_LIST}
      {...appBar.scroll}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 32 + clearance }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[c.accent]} progressBackgroundColor={c.surface} progressViewOffset={appBar.refreshOffset} />}
    />
  );
}
