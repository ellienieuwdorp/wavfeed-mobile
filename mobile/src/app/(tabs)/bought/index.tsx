/**
 * Bought on the store (DESIGN-UI section 3, The Bought view): "By release week" is the weekly chart, top three a week with
 * "Show all N"; "Bought by many" lists every Release in the week it reached the chosen number of people you follow, picked in
 * the menu under the mode's line in that mode only. Rows carry the faces of who bought it, which open the Bought by sheet,
 * and the label; quiet runs say their dates and stop. A switch places what one read holds (task 0036): the picker and its
 * line take the new mode at once, the rows follow in a deferred render with a spinner closing the line until they land,
 * and only a first screen of them mounts before the list grows in its own batches, since swapping the whole render window
 * in one commit (about 150 rows at the default window) is what held the old rows on screen for seconds.
 */
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { useAppBar } from '@/components/AppBar';
import { Buyers, buyersFacts } from '@/components/Buyers';
import { EmptyState } from '@/components/EmptyState';
import { GapRow } from '@/components/GapRow';
import { MenuSelect } from '@/components/MenuSelect';
import { useDockClearance } from '@/components/player/Dock';
import { ReleaseRow, ROW_LIST } from '@/components/ReleaseRow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Segmented, type Segment } from '@/components/Segmented';
import { UpcomingShelf, type ShelfCard } from '@/components/UpcomingShelf';
import { WeekHead } from '@/components/WeekHead';
import {
  BOUGHT_THRESHOLDS,
  BOUGHT_TOP_ENTRIES,
  copy,
  DEFAULT_BOUGHT_THRESHOLD,
  dayLabel,
  expanderLabel,
  outOnPhrase,
  thresholdOptionLabel,
  tracksOutPhrase,
  type BoughtMode,
} from '@/copy';
import type { ApiBoughtCrossedResponse, ApiBoughtResponse, ApiFeedItem } from '@/domain/apiTypes';
import { boughtHalves, type BoughtHalves } from '@/domain/boughtChart';
import { parseIsoDate, releaseDay as localDayOf, startOfWeek } from '@/lib/dates';
import { dayKey, releaseDayKey, useNow } from '@/lib/useNow';
import { buildSectionsFromWeeks, buildWeekSections } from '@/lib/weekSections';
import { useLiveQuery } from '@/state/appState';
import { useRefresh } from '@/state/refresh';
import { boughtView, readBoughtReleases } from '@/store/queries';
import { PRESS_FLASH, useTokens } from '@/theme/tokens';

const NO_GAP_TAIL = '';

/** The list's first cells after a switch, header included: more than a phone screen of 60pt rows under the header. */
const FIRST_SCREEN = 16;

/** Five screens ahead of the viewport, half the default: what a switch unmounts and a store version re-renders. */
const WINDOW_SIZE = 11;

const SPINNER = 20;

const MODES: readonly BoughtMode[] = ['released', 'crossed'];

const SEGMENTS: Segment<BoughtMode>[] = MODES.map((key) => ({ key, label: copy.bought.segment[key] }));

const THRESHOLD_OPTIONS = BOUGHT_THRESHOLDS.map((n) => ({ value: n, label: thresholdOptionLabel(n) }));

type Choice = { readonly mode: BoughtMode; readonly threshold: number };

type Answer = { mode: 'released'; upcoming: BoughtHalves['upcoming']; data: ApiBoughtResponse } | { mode: 'crossed'; threshold: number; data: ApiBoughtCrossedResponse };

type Item =
  | { key: string; kind: 'header'; choice: Choice; switching: boolean }
  | { key: string; kind: 'empty'; nothing: string }
  | { key: string; kind: 'shelf'; cards: readonly ShelfCard[] }
  | { key: string; kind: 'week'; heading: string; detail: string }
  | { key: string; kind: 'release'; release: ApiFeedItem }
  | { key: string; kind: 'all'; week: string; expanded: boolean; total: number }
  | { key: string; kind: 'gap'; text: string };

/** The chart files only what is out; "Bought by many" goes by purchase week, so it places both halves. */
function answerOf(held: BoughtHalves, choice: Choice): Answer {
  if (choice.mode === 'released') return { mode: 'released', upcoming: held.upcoming, data: boughtView(held.out, { mode: 'released' }) };
  return { mode: 'crossed', threshold: choice.threshold, data: boughtView([...held.out, ...held.upcoming], { mode: 'crossed', threshold: choice.threshold }) };
}

/** Bought's cards count the Tracks that play as New releases' do, and draw no Drop rows (task 0041, decisions 9 and 10). */
function shelfOf(upcoming: BoughtHalves['upcoming'], at: Date): readonly ShelfCard[] {
  return upcoming.flatMap((r) => {
    if (r.releaseDate === null) return [];
    const on = localDayOf(r.releaseDate.toISOString());
    const count = tracksOutPhrase(r.item.numStreamableTracks, r.item.numTracks);
    return [{ key: `${r.item.itemType}:${r.item.itemId}`, release: r.item, day: dayLabel(on, at), out: outOnPhrase(on, at), count, buyers: r.item.buyers }];
  });
}

function rowsOf(answer: Answer, at: Date, open: ReadonlySet<string>): Item[] {
  const list: Item[] = [];
  if (answer.mode === 'released') {
    if (answer.upcoming.length > 0) list.push({ key: 'shelf', kind: 'shelf', cards: shelfOf(answer.upcoming, at) });
    const sections = buildSectionsFromWeeks(
      answer.data.weeks.map((w) => ({ start: startOfWeek(parseIsoDate(w.weekStart)), entries: w.entries })),
      at,
      { gapTail: NO_GAP_TAIL },
    );
    for (const section of sections) {
      if (section.kind === 'gap') {
        list.push({ key: section.key, kind: 'gap', text: section.label });
        continue;
      }
      const expanded = open.has(section.key);
      list.push({ key: section.key, kind: 'week', heading: section.heading, detail: section.detail });
      const shown = expanded ? section.entries : section.entries.slice(0, BOUGHT_TOP_ENTRIES);
      for (const r of shown) list.push({ key: `${section.key}:${r.itemType}:${r.itemId}`, kind: 'release', release: r });
      if (section.entries.length > BOUGHT_TOP_ENTRIES) {
        list.push({ key: `all:${section.key}`, kind: 'all', week: section.key, expanded, total: section.entries.length });
      }
    }
  } else {
    const sections = buildWeekSections(answer.data.entries, (e) => e.crossedAt, at, { gapTail: NO_GAP_TAIL, sortWithinWeek: false });
    for (const section of sections) {
      if (section.kind === 'gap') {
        list.push({ key: section.key, kind: 'gap', text: section.label });
        continue;
      }
      list.push({ key: section.key, kind: 'week', heading: section.heading, detail: section.detail });
      for (const e of section.entries) list.push({ key: `${section.key}:${e.item.itemType}:${e.item.itemId}`, kind: 'release', release: e.item });
    }
  }
  if (list.length === 0) {
    list.push({ key: 'empty', kind: 'empty', nothing: answer.mode === 'released' ? copy.empty.nothing : copy.empty.crossed(answer.threshold) });
  }
  return list;
}

/**
 * Both modes' lines laid over each other in one row, only the mode's own visible and read, so the taller sets the height
 * and a switch never moves what is under it. The spinner's slot is always held.
 */
function ModeLine({ mode, switching }: { mode: BoughtMode; switching: boolean }) {
  const { c, type } = useTokens();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: type.gutter, paddingBottom: 8 }}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {MODES.map((m, n) => {
          const on = m === mode;
          return (
            <Text
              key={m}
              accessibilityElementsHidden={!on}
              importantForAccessibility={on ? 'auto' : 'no-hide-descendants'}
              style={{ width: '100%', marginLeft: n === 0 ? 0 : '-100%', opacity: on ? 1 : 0, fontSize: type.sub, color: c.sub }}
            >
              {copy.bought.line[m]}
            </Text>
          );
        })}
      </View>
      <View style={{ width: SPINNER, height: SPINNER, justifyContent: 'center' }}>{switching ? <ActivityIndicator size="small" color={c.sub} /> : null}</View>
    </View>
  );
}

function Header({ choice, switching, setMode, setThreshold }: { choice: Choice; switching: boolean; setMode: (m: BoughtMode) => void; setThreshold: (n: number) => void }) {
  const { type } = useTokens();
  // Both platforms keep the group full width and show the menu only in the mode it serves (the canvas's Bought boards).
  return (
    <View>
      <ScreenHeader />
      <View style={{ paddingHorizontal: type.gutter, paddingBottom: 8 }}>
        <Segmented segments={SEGMENTS} value={choice.mode} onChange={setMode} />
      </View>
      <ModeLine mode={choice.mode} switching={switching} />
      {choice.mode === 'crossed' ? (
        <View style={{ flexDirection: 'row', paddingHorizontal: type.gutter, paddingBottom: 8 }}>
          <MenuSelect options={THRESHOLD_OPTIONS} value={choice.threshold} onChange={setThreshold} enabled label={copy.bought.thresholdLabel} />
        </View>
      ) : null}
    </View>
  );
}

/** A cell re-rendered for its index or a rebuilt item ("Show all" shifts every cell after it) keeps its row while the Release is the same. */
const BoughtRow = memo(function BoughtRow({ release }: { release: ApiFeedItem }) {
  return <ReleaseRow release={release} facts={buyersFacts(release)} boughtBy={release.buyers} detail={<Buyers release={release} />} />;
});

function ShowAll({ label, onPress }: { label: string; onPress: () => void }) {
  const { c, type } = useTokens();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      android_ripple={{ color: c.track }}
      style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: type.gutter, backgroundColor: pressed ? PRESS_FLASH : undefined })}
    >
      <Text style={{ fontSize: 15, color: c.accentText }}>{label}</Text>
    </Pressable>
  );
}

export default function Bought() {
  const { c } = useTokens();
  const clearance = useDockClearance();
  const now = useNow();
  const day = dayKey(now);
  const releaseDay = releaseDayKey(now);
  const [mode, setMode] = useState<BoughtMode>('released');
  const [threshold, setThreshold] = useState(DEFAULT_BOUGHT_THRESHOLD);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const { refreshing, onRefresh } = useRefresh('bought');
  const appBar = useAppBar();

  // One read per store version holds both modes and every number, so a switch places what is held and reads nothing (task 0036).
  const held = useLiveQuery(readBoughtReleases);
  const choice = useMemo<Choice>(() => ({ mode, threshold }), [mode, threshold]);
  // The header renders `choice` at once; the rows render `shown`, which React moves to `choice` in a render it can interrupt.
  const shown = useDeferredValue(choice);
  const switching = shown !== choice;
  // The choice whose rows past the first screen are out: it trails `shown` by one frame, so a switch commits a first
  // screen and FlatList's window then grows from it in batches, where it would otherwise keep the old window's length.
  const [grown, setGrown] = useState(shown);
  useEffect(() => {
    if (grown === shown) return;
    const frame = requestAnimationFrame(() => setGrown(shown));
    return () => cancelAnimationFrame(frame);
  }, [grown, shown]);

  const halves = useMemo(() => (held === null ? null : boughtHalves(held, new Date(releaseDay))), [held, releaseDay]);
  const answer = useMemo(() => (halves === null ? null : answerOf(halves, shown)), [halves, shown]);
  const rows = useMemo(() => (answer === null ? [] : rowsOf(answer, new Date(day), open)), [answer, day, open]);
  const header = useMemo<Item>(() => ({ key: 'header', kind: 'header', choice, switching }), [choice, switching]);
  const data = useMemo(() => [header, ...(grown === shown ? rows : rows.slice(0, FIRST_SCREEN - 1))], [header, rows, grown, shown]);

  const toggle = useCallback(
    (week: string) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(week)) next.delete(week);
        else next.add(week);
        return next;
      }),
    [],
  );

  // Stable for the screen's life under ROW_LIST: everything a cell shows rides on its item, so a switch or a
  // spinner re-renders the header cell alone and leaves the mounted rows to their keys.
  const render = useCallback(
    ({ item }: { item: Item }) => {
      switch (item.kind) {
        case 'header':
          return <Header choice={item.choice} switching={item.switching} setMode={setMode} setThreshold={setThreshold} />;
        case 'empty':
          return <EmptyState filling={copy.empty.fillingBought} nothing={item.nothing} />;
        case 'shelf':
          return <UpcomingShelf cards={item.cards} more="/bought/upcoming" />;
        case 'week':
          return <WeekHead week={item.heading} range={item.detail} />;
        case 'gap':
          return <GapRow text={item.text} />;
        case 'all':
          return <ShowAll label={expanderLabel(item.expanded, item.total)} onPress={() => toggle(item.week)} />;
        case 'release':
          return <BoughtRow release={item.release} />;
      }
    },
    [toggle],
  );

  return (
    <FlatList
      data={data}
      keyExtractor={(i) => i.key}
      renderItem={render}
      {...ROW_LIST}
      initialNumToRender={FIRST_SCREEN}
      windowSize={WINDOW_SIZE}
      {...appBar.scroll}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 32 + clearance }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[c.accent]} progressBackgroundColor={c.surface} progressViewOffset={appBar.refreshOffset} />}
    />
  );
}
