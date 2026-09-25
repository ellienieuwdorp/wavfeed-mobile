/**
 * Bought on the store (DESIGN-UI section 3): "By release date" is the weekly chart, top three a week with "Show all N";
 * "By recently purchased" lists every Release in the week it reached the chosen number of buyers you follow, picked in
 * the menu under the mode picker in that mode only. Rows carry the faces of who bought it, which open the Bought by
 * sheet, and the label; quiet runs say their dates and stop.
 */
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { AvatarStack } from '@/components/AvatarStack';
import { useAppBar } from '@/components/AppBar';
import { EmptyState } from '@/components/EmptyState';
import { GapRow } from '@/components/GapRow';
import { MenuSelect } from '@/components/MenuSelect';
import { useDockClearance } from '@/components/player/Dock';
import { ReleaseRow } from '@/components/ReleaseRow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Segmented } from '@/components/Segmented';
import { WeekHead } from '@/components/WeekHead';
import {
  BOUGHT_THRESHOLDS,
  BOUGHT_TOP_ENTRIES,
  copy,
  DEFAULT_BOUGHT_THRESHOLD,
  expanderLabel,
  SELF_RELEASED,
  thresholdOptionLabel,
  type BoughtMode,
} from '@/copy';
import type { ApiBoughtCrossedResponse, ApiBoughtResponse, ApiFeedItem } from '@/domain/apiTypes';
import { parseIsoDate, startOfWeek } from '@/lib/dates';
import { dayKey, useNow } from '@/lib/useNow';
import { buildSectionsFromWeeks, buildWeekSections } from '@/lib/weekSections';
import { useLiveQuery } from '@/state/appState';
import { useRefresh } from '@/state/refresh';
import { readBought } from '@/store';
import { PRESS_FLASH, useTokens } from '@/theme/tokens';

const NO_GAP_TAIL = '';

type Answer = { mode: 'released'; data: ApiBoughtResponse } | { mode: 'crossed'; data: ApiBoughtCrossedResponse };

type Item =
  | { key: string; kind: 'header' }
  | { key: string; kind: 'empty' }
  | { key: string; kind: 'week'; heading: string; detail: string }
  | { key: string; kind: 'release'; release: ApiFeedItem }
  | { key: string; kind: 'all'; week: string; expanded: boolean; total: number }
  | { key: string; kind: 'gap'; text: string };

const THRESHOLD_OPTIONS = BOUGHT_THRESHOLDS.map((n) => ({ value: n, label: thresholdOptionLabel(n) }));

function Header({ mode, setMode, threshold, setThreshold }: { mode: BoughtMode; setMode: (m: BoughtMode) => void; threshold: number; setThreshold: (n: number) => void }) {
  const { type } = useTokens();
  const menu = <MenuSelect options={THRESHOLD_OPTIONS} value={threshold} onChange={setThreshold} enabled label={copy.bought.thresholdLabel} />;
  const segmented = (
    <Segmented
      segments={[
        { key: 'released', label: copy.bought.released, a11y: copy.bought.byReleaseDate },
        { key: 'crossed', label: copy.bought.purchased, a11y: copy.bought.byPurchased },
      ]}
      value={mode}
      onChange={setMode}
    />
  );
  // Both platforms keep the group full width and show the menu only in the mode it serves (the canvas's Bought boards).
  return (
    <View>
      <ScreenHeader />
      <View style={{ paddingHorizontal: type.gutter, paddingBottom: 8 }}>{segmented}</View>
      {mode === 'crossed' ? <View style={{ flexDirection: 'row', paddingHorizontal: type.gutter, paddingBottom: 8 }}>{menu}</View> : null}
    </View>
  );
}

function Buyers({ release }: { release: ApiFeedItem }) {
  const { c, type } = useTokens();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <AvatarStack fans={release.buyers} opens />
      <Text numberOfLines={1} style={{ flex: 1, fontSize: type.fact, color: c.sub }}>{release.label ?? SELF_RELEASED}</Text>
    </View>
  );
}

function ShowAll({ label, onPress }: { label: string; onPress: () => void }) {
  const { c, type } = useTokens();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      android_ripple={{ color: c.track }}
      style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: type.gutter, backgroundColor: pressed ? PRESS_FLASH : undefined })}
    >
      <Text style={{ fontSize: 15, color: c.accent }}>{label}</Text>
    </Pressable>
  );
}

export default function Bought() {
  const { c } = useTokens();
  const clearance = useDockClearance();
  const now = useNow();
  const day = dayKey(now);
  const [mode, setMode] = useState<BoughtMode>('released');
  const [threshold, setThreshold] = useState(DEFAULT_BOUGHT_THRESHOLD);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const { refreshing, onRefresh } = useRefresh();
  const appBar = useAppBar();

  const answer = useLiveQuery<Answer>(
    async (db) =>
      mode === 'released'
        ? { mode, data: await readBought(db, { mode: 'released' }) }
        : { mode, data: await readBought(db, { mode: 'crossed', threshold }) },
    [mode, threshold],
  );

  const items = useMemo(() => {
    const list: Item[] = [{ key: 'header', kind: 'header' }];
    if (answer === null || answer.mode !== mode) return list;
    const at = new Date(day);
    if (answer.mode === 'released') {
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
    if (list.length === 1) list.push({ key: 'empty', kind: 'empty' });
    return list;
  }, [answer, mode, day, open]);

  const toggle = (week: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(week)) next.delete(week);
      else next.add(week);
      return next;
    });

  const render = ({ item }: { item: Item }) => {
    switch (item.kind) {
      case 'header':
        return <Header mode={mode} setMode={setMode} threshold={threshold} setThreshold={setThreshold} />;
      case 'empty':
        return <EmptyState filling={copy.empty.fillingBought} nothing={mode === 'released' ? copy.empty.nothing : copy.empty.crossed(threshold)} />;
      case 'week':
        return <WeekHead week={item.heading} range={item.detail} />;
      case 'gap':
        return <GapRow text={item.text} />;
      case 'all':
        return <ShowAll label={expanderLabel(item.expanded, item.total)} onPress={() => toggle(item.week)} />;
      case 'release':
        return <ReleaseRow release={item.release} detail={<Buyers release={item.release} />} />;
    }
  };

  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.key}
      renderItem={render}
      extraData={[mode, threshold]}
      {...appBar.scroll}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 32 + clearance }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[c.accent]} progressBackgroundColor={c.surface} progressViewOffset={appBar.refreshOffset} />}
    />
  );
}
