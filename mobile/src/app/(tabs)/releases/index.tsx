/**
 * New releases on the store: the Upcoming shelf, then the released weeks and the quiet gaps between them, newest
 * first (DESIGN-UI section 3). A released row is its title and credit line with the faces of who bought it,
 * its week head dating it. A Drop is the same row
 * on its day, with no day line, its count "1/4" on its art saying it is not all out (the author's request of
 * 2026-10-15), and its art plays the Release from the newest Track it let out. The filter narrows the shelf and the weeks; with nothing chosen the line under the title counts the view,
 * while a filter is active the "Filtered by" pill stands there, and a filter that keeps nothing says so with "Clear
 * filters". The filter button floats over the list (see Dock). A link to
 * `/releases?people=1` turns the people filter on at 1+ and keeps the tags.
 */
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useEffectEvent, useMemo } from 'react';
import { FlatList, RefreshControl } from 'react-native';

import { useAppBar } from '@/components/AppBar';
import { EmptyState } from '@/components/EmptyState';
import { FilterEaseCell, useListFilter } from '@/components/filter/FilterEase';
import { NothingMatches } from '@/components/filter/NothingMatches';
import { GapRow } from '@/components/GapRow';
import { useDockClearance } from '@/components/player/Dock';
import type { RowRelease } from '@/components/playable';
import { ReleaseRow, ROW_LIST } from '@/components/ReleaseRow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { UpcomingShelf, type ShelfCard } from '@/components/UpcomingShelf';
import { useWeekBands, WeekHead } from '@/components/WeekHead';
import { copy, dayLabel, onDayPhrase, outOnPhrase } from '@/copy';
import type { FanRef } from '@/domain/views';
import { filterNewReleases } from '@/domain/releaseFilter';
import { releaseDay } from '@/domain/newReleases';
import { dayKey, releaseDayKey, useNow } from '@/lib/useNow';
import { buildSectionsFromWeeks, narrowSections } from '@/lib/weekSections';
import { useAppState, useLiveQuery } from '@/state/appState';
import { isActive, namedFilter, toReleaseFilter, withPeopleLink } from '@/state/filterSettings';
import { publishView, useReleaseFilter } from '@/state/releaseFilter';
import { useRefresh } from '@/state/refresh';
import { readNewReleases } from '@/store/queries';
import { useTokens } from '@/theme/tokens';

type Row = RowRelease & { readonly buyers: readonly FanRef[] };

type Item =
  | { key: string; kind: 'header'; count: number | null; filteredBy: string | null }
  | { key: string; kind: 'empty' }
  | { key: string; kind: 'nomatch'; named: string }
  | { key: string; kind: 'shelf'; cards: readonly ShelfCard[] }
  | { key: string; kind: 'week'; heading: string; detail: string }
  | { key: string; kind: 'release'; release: Row; heardDay: string; rule: boolean }
  | { key: string; kind: 'drop'; release: Row; heardDay: string; tracksOut: number; numTracks: number | null; from: string | null; rule: boolean }
  | { key: string; kind: 'gap'; text: string };

function render({ item }: { item: Item }) {
  switch (item.kind) {
    case 'header':
      return <ScreenHeader filterable count={item.count} filteredBy={item.filteredBy} />;
    case 'empty':
      return <EmptyState filling={copy.empty.fillingReleases} nothing={copy.empty.nothing} />;
    case 'nomatch':
      return <NothingMatches named={item.named} />;
    case 'shelf':
      return <UpcomingShelf cards={item.cards} more="/releases/upcoming" />;
    case 'week':
      return <WeekHead week={item.heading} range={item.detail} />;
    case 'gap':
      return <GapRow text={item.text} />;
    case 'release':
      return <ReleaseRow release={item.release} day={null} heardDay={item.heardDay} buyers={item.release.buyers} rule={item.rule} />;
    case 'drop':
      return <ReleaseRow release={item.release} day={null} heardDay={item.heardDay} tracksOut={item.tracksOut} numTracks={item.numTracks} buyers={item.release.buyers} from={item.from} rule={item.rule} />;
  }
}

export default function NewReleases() {
  const { c } = useTokens();
  const clearance = useDockClearance();
  const now = useNow();
  const day = dayKey(now);
  // Classification changes at GMT midnight independently of the local-day labels below (ADR-0017).
  const releaseDate = releaseDayKey(now);
  const view = useLiveQuery((db) => readNewReleases(db, { now: new Date() }), releaseDate);
  const { refreshing, onRefresh } = useRefresh('releases');
  const appBar = useAppBar();
  const { db } = useAppState();
  const { loaded, settings, update } = useReleaseFilter();
  // The Filters sheet takes a tap at once; this list follows a beat later, eased (components/filter/FilterEase.tsx).
  const applied = useListFilter(settings, loaded);
  const filtered = useMemo(() => (view === null ? null : filterNewReleases(view, toReleaseFilter(applied))), [view, applied]);
  useEffect(() => {
    if (view !== null) publishView(db, view);
  }, [db, view]);
  // The quiet runs are the whole view's, so a week the filter empties never reads as a quiet one.
  const sections = useMemo(() => (view === null ? null : buildSectionsFromWeeks(view.weeks.map((w) => ({ start: w.weekStart, entries: w.releases })), new Date(day))), [view, day]);

  // A link that arrives as `?people=N` (Feed's) is taken once the saved settings are read, then cleared from
  // this screen's own route, so a later visit by the tab bar finds no param to take again.
  const { people } = useLocalSearchParams<{ people?: string }>();
  const navigation = useNavigation<{ setParams: (params: { people?: string }) => void }>();
  const takeLink = useEffectEvent((link: string) => {
    const next = withPeopleLink(settings, link);
    if (next !== null && next !== settings) update(next);
    navigation.setParams({ people: undefined });
  });
  useEffect(() => {
    if (loaded && people !== undefined) takeLink(people);
  }, [loaded, people]);

  const items = useMemo(() => {
    const named = applied !== null && isActive(applied) && filtered !== null ? namedFilter(applied, filtered.tags) : null;
    const list: Item[] = [
      {
        key: 'header',
        kind: 'header',
        count: filtered?.total ?? null,
        filteredBy: named === null ? null : copy.filter.filteredBy(named.min, named.tags),
      },
    ];
    if (filtered === null || view === null || sections === null) return list;
    const shown = filtered.view;
    const at = new Date(day);
    if (shown.upcoming.length > 0) {
      const cards = shown.upcoming.map((r) => {
        const on = releaseDay(r.releaseDate);
        return { key: `${r.itemType}:${r.itemId}`, release: r, day: onDayPhrase(on, at, { year: false }), out: outOnPhrase(on, at), tracksOut: r.numStreamableTracks, numTracks: r.numTracks, buyers: r.buyers };
      });
      list.push({ key: 'shelf', kind: 'shelf', cards });
    }
    const kept = new Set(shown.weeks.flatMap((w) => w.releases.map((placed) => placed.key)));
    const released = shown === view ? sections : narrowSections(sections, (placed) => kept.has(placed.key));
    for (const section of released) {
      if (section.kind === 'gap') {
        list.push({ key: section.key, kind: 'gap', text: section.label });
        continue;
      }
      list.push({ key: section.key, kind: 'week', heading: section.heading, detail: section.detail });
      section.entries.forEach((placed, n) => {
        // The last row of a week draws no hairline above the next week's head.
        const rule = n < section.entries.length - 1;
        // A Drop's key names its day, so a Release's Drops and later its own row never share one.
        if (placed.kind === 'drop') {
          const { tracksOut, numTracks } = placed;
          // A Drop draws no day line either; its label says the day it is out (the author's request of 2026-10-15).
          const heardDay = outOnPhrase(placed.releaseDay, at);
          list.push({ key: placed.key, kind: 'drop', release: placed.release, heardDay, tracksOut, numTracks, from: placed.newestTrackId, rule });
        } else {
          // A released row draws no day, its week head dates it; the label still says it (amended by the author 2026-10-14).
          list.push({ key: placed.key, kind: 'release', release: placed.release, heardDay: dayLabel(placed.date, at), rule });
        }
      });
    }
    if (list.length === 1) {
      if (named !== null && filtered.total > 0) list.push({ key: 'nomatch', kind: 'nomatch', named: copy.filter.nothingNamed(named.min, named.tags) });
      else list.push({ key: 'empty', kind: 'empty' });
    }
    return list;
  }, [view, sections, filtered, applied, day]);

  const bands = useWeekBands(items);

  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.key}
      renderItem={render}
      CellRendererComponent={FilterEaseCell}
      {...ROW_LIST}
      {...bands}
      {...appBar.scroll}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 32 + clearance }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[c.accent]} progressBackgroundColor={c.surface} progressViewOffset={appBar.refreshOffset} />}
    />
  );
}
