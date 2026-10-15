/**
 * The Filters sheet (task 0071, decision 7, R5 count option C, the round-four flow and Number and icon boards): the
 * bar, the people group, then the tags. On iOS the bar holds Clear, "Filters" over the live count, and Done, on the
 * grouped sheet's own greys; on Android "Filters" and the count, then Clear as a Material text button at the row's end
 * (Open 11, answered by the author 2026-10-14), a tap outside, a drag down or back closing it. The people group is the people glyph, "Bought by people you follow" and its switch, and under it
 * "At least [−] 2 [+] people" with the Releases that minimum alone keeps in the tag counts' column (Open 4, option C).
 * The tags follow, highest count first, counted after the people filter (Open 3), places left out; the first few
 * show, any chosen one among them, then "Show all 34"; the search narrows them by name. Every change is written at
 * once and counted here, and the list behind follows each tap (see state/releaseFilter.ts); no change is counted
 * (Open 5). It opens with nothing chosen the first time, and Clear goes back there on both platforms (decisions 5 and
 * 7 as amended 2026-10-14). Each tag leads with its checkbox (TagMark).
 */
import { router } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, Platform, PlatformColor, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glyph } from '@/components/Glyph';
import { NativeSwitch } from '@/components/NativeSwitch';
import { SearchField, SheetPress, Stepper, TAG_MARK, TagMark } from '@/components/filter/Controls';
import { copy } from '@/copy';
import { clampMinimum, filterNewReleases, PEOPLE_MAX, PEOPLE_MIN, shownTags, type TagCount } from '@/domain/releaseFilter';
import { NOTHING_CHOSEN, toReleaseFilter, withTag } from '@/state/filterSettings';
import { useReleaseFilter } from '@/state/releaseFilter';
import { useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';
/** Tags shown before "Show all": what the full-height boards draw. */
const FIRST_TAGS = ios ? 9 : 8;
/** The counts' column, so the minimum's count and the tags' share one right edge (Open 4, option C). */
const COUNT_WIDTH = 34;
const NO_TAGS: readonly TagCount[] = [];

export default function Filters() {
  const { c } = useTokens();
  const insets = useSafeAreaInsets();
  const { settings: saved, view, update: change } = useReleaseFilter();
  // Counted here from the settings just tapped, so the counts move in the same frame as the control (decision 21).
  const filtered = useMemo(() => (view === null ? null : filterNewReleases(view, toReleaseFilter(saved))), [view, saved]);
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const settings = saved ?? NOTHING_CHOSEN;
  // Each change applies to the settings held when it lands, so two taps inside one render both count: a tap on a tag
  // flips what is held, not what the last render drew.
  const toggleTag = useCallback((name: string) => change((held) => withTag(held, name, !held.tags.includes(name))), [change]);
  const min = settings.people.min;
  const tags = filtered?.tags ?? NO_TAGS;
  const byMinimum = filtered?.byMinimum.find((m) => m.min === min)?.count ?? 0;
  const shown = useMemo(() => shownTags(tags, settings.tags, query, all ? Infinity : FIRST_TAGS), [tags, settings.tags, query, all]);
  const more = useMemo(() => {
    if (all || query.trim() !== '') return false;
    const listed = new Set(shown);
    return tags.some((tag) => !listed.has(tag));
  }, [all, query, shown, tags]);
  // The rows the list draws, each knowing whether it is ticked and where it sits in the group; FlatList mounts the
  // ones on screen, so "Show all" costs the rows it shows and not the hundreds a large store holds.
  const rows = useMemo(
    () => shown.map((tag, n): TagItem => ({ ...tag, on: settings.tags.includes(tag.normName), first: n === 0, last: n === shown.length - 1 && !more, onToggle: toggleTag })),
    [shown, settings.tags, more, toggleTag],
  );
  const count = copy.filter.count(filtered?.matching ?? 0);

  const cell = ios ? PlatformColor('secondarySystemGroupedBackground') : undefined;
  const group = ios ? { backgroundColor: cell, borderRadius: 12, borderCurve: 'continuous' as const, overflow: 'hidden' as const } : {};
  const rule = (inset: number) => (ios ? <View style={{ height: 0.5, marginLeft: inset, backgroundColor: c.border }} /> : null);

  const setPeople = (on: boolean) => change((held) => ({ people: { ...held.people, on }, tags: held.tags }));

  // react-native-screens sizes an iOS sheet's ScrollView, here the FlatList's, to the sheet less the one view above it,
  // so the bar is that view, kept unflattened, and the sheet's ground is the screen's own (contentStyle in app/_layout.tsx).
  return (
    <>
      {ios ? (
        <View collapsable={false} style={{ height: 62, paddingTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 }}>
          <View accessible accessibilityRole="header" style={{ position: 'absolute', left: 0, right: 0, alignItems: 'center' }}>
            <Text style={{ fontSize: 17, fontWeight: '600', color: c.ink }}>{copy.filter.title}</Text>
            <Text style={{ fontSize: 12, lineHeight: 14, color: c.sub, fontVariant: ['tabular-nums'] }}>{count}</Text>
          </View>
          <BarButton label={copy.filter.clearAll} onPress={() => change(NOTHING_CHOSEN)} />
          <BarButton label={copy.filter.done} bold onPress={() => router.back()} />
        </View>
      ) : (
        <View collapsable={false}>
          <View style={{ alignSelf: 'center', width: 32, height: 4, borderRadius: 2, backgroundColor: c.sub, opacity: 0.5, marginTop: 22 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 10, paddingLeft: 24, paddingRight: 12 }}>
            <View accessible accessibilityRole="header" style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 12 }}>
              <Text style={{ fontSize: 24, lineHeight: 32, color: c.ink }}>{copy.filter.title}</Text>
              <Text style={{ fontSize: 14, color: c.sub, fontVariant: ['tabular-nums'] }}>{count}</Text>
            </View>
            <TextButton label={copy.filter.clearAll} onPress={() => change(NOTHING_CHOSEN)} />
          </View>
        </View>
      )}
      <FlatList
        data={rows}
        keyExtractor={keyOf}
        renderItem={renderTag}
        initialNumToRender={FIRST_TAGS + 4}
        maxToRenderPerBatch={12}
        windowSize={5}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: ios ? 6 : 12, paddingBottom: 24 + insets.bottom }}
        ListHeaderComponent={
          <>
            <View style={group}>
              <Row onPress={() => change((held) => ({ people: { ...held.people, on: !held.people.on }, tags: held.tags }))} role="switch" checked={settings.people.on} ownsFocus={ios}>
                <Glyph name="people" size={24} colour={c.accent} weight="regular" />
                <Text style={{ flex: 1, fontSize: ios ? 15 : 16, color: c.ink }}>{copy.filter.people}</Text>
                <NativeSwitch value={settings.people.on} onChange={setPeople} label={copy.filter.people} />
              </Row>
              {rule(16)}
              <View
                accessible={false}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: ios ? 16 : 8, opacity: settings.people.on ? 1 : 0.45 }}
              >
                <Text style={{ fontSize: ios ? 15 : 16, lineHeight: 22, color: c.ink }} importantForAccessibility="no" accessibilityElementsHidden>
                  {copy.filter.atLeast}
                </Text>
                <Stepper value={min} min={PEOPLE_MIN} max={PEOPLE_MAX} spoken={copy.filter.minimum} onStep={(by) => change((held) => ({ people: { on: true, min: clampMinimum(held.people.min + by) }, tags: held.tags }))} />
                <Text style={{ flex: 1, fontSize: ios ? 15 : 16, lineHeight: 22, color: c.ink }} importantForAccessibility="no" accessibilityElementsHidden>
                  {copy.filter.peopleWord(min)}
                </Text>
                <Text style={{ minWidth: COUNT_WIDTH, textAlign: 'right', fontSize: ios ? 15 : 14, color: c.sub, fontVariant: ['tabular-nums'] }} accessibilityLabel={copy.filter.count(byMinimum)}>
                  {byMinimum}
                </Text>
              </View>
            </View>
            {ios ? null : <View style={{ height: 1, backgroundColor: c.border, margin: 8 }} />}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: ios ? 16 : 8, paddingTop: ios ? 22 : 12, paddingBottom: ios ? 7 : 8 }}>
              <Text accessibilityRole="header" style={ios ? { fontSize: 13, color: c.sub, textTransform: 'uppercase' } : { fontSize: 14, fontWeight: '500', color: c.sub }}>
                {copy.filter.tags}
              </Text>
              <Text style={{ fontSize: ios ? 13 : 14, color: c.sub }}>{copy.filter.anyOf}</Text>
            </View>
            <View style={{ marginBottom: 16, marginHorizontal: ios ? 0 : 8 }}>
              <SearchField value={query} onChange={setQuery} placeholder={copy.filter.search(tags.length)} />
            </View>
            {shown.length === 0 && tags.length > 0 ? (
              <View style={group}>
                <Text style={{ fontSize: ios ? 15 : 16, color: c.sub, paddingHorizontal: ios ? 16 : 8, paddingVertical: 12 }}>{copy.filter.noTags}</Text>
              </View>
            ) : null}
          </>
        }
        ListFooterComponent={
          more ? (
            <View style={ios ? { ...group, borderTopLeftRadius: 0, borderTopRightRadius: 0 } : undefined}>
              {rule(16)}
              <SheetPress
                onPress={() => setAll(true)}
                accessibilityRole="button"
                style={{ minHeight: ios ? 44 : 40, justifyContent: 'center', paddingHorizontal: ios ? 16 : 8 }}
              >
                <Text style={ios ? { fontSize: 15, color: c.accent } : { fontSize: 14, fontWeight: '500', color: c.accentText }}>{copy.filter.showAll(tags.length)}</Text>
              </SheetPress>
            </View>
          ) : null
        }
      />
    </>
  );
}

function BarButton({ label, bold = false, onPress }: { label: string; bold?: boolean; onPress: () => void }) {
  const { c } = useTokens();
  return (
    <SheetPress feedback="dim" onPress={onPress} accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ paddingVertical: 6 }}>
      <Text style={{ fontSize: 17, fontWeight: bold ? '600' : '400', color: c.accent }}>{label}</Text>
    </SheetPress>
  );
}

/** Material 3's text button, the label in the accent, its ripple a pill the 48 height of its target. */
function TextButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { c } = useTokens();
  return (
    <View style={{ borderRadius: 24, overflow: 'hidden' }}>
      <SheetPress onPress={onPress} accessibilityRole="button" style={{ minHeight: 48, paddingHorizontal: 12, justifyContent: 'center' }}>
        <Text style={{ fontSize: 14, lineHeight: 20, fontWeight: '500', letterSpacing: 0.1, color: c.accentText }}>{label}</Text>
      </SheetPress>
    </View>
  );
}

type TagItem = TagCount & { readonly on: boolean; readonly first: boolean; readonly last: boolean; readonly onToggle: (normName: string) => void };

const keyOf = (tag: TagItem) => tag.normName;
const renderTag = ({ item }: { item: TagItem }) => (
  <TagRow name={item.name} normName={item.normName} count={item.count} on={item.on} first={item.first} last={item.last} onToggle={item.onToggle} />
);

/**
 * A tag's row, memoised on what it draws, so a tap renders the row it ticks. On iOS each row is its slice of the
 * grouped cell, rounded at the group's top and bottom.
 */
const TagRow = memo(function TagRow({
  name,
  normName,
  count,
  on,
  first,
  last,
  onToggle,
}: {
  name: string;
  normName: string;
  count: number;
  on: boolean;
  first: boolean;
  last: boolean;
  onToggle: (normName: string) => void;
}) {
  const { c } = useTokens();
  const toggle = () => onToggle(normName);
  const slice = ios
    ? {
        backgroundColor: PlatformColor('secondarySystemGroupedBackground'),
        borderCurve: 'continuous' as const,
        overflow: 'hidden' as const,
        borderTopLeftRadius: first ? 12 : 0,
        borderTopRightRadius: first ? 12 : 0,
        borderBottomLeftRadius: last ? 12 : 0,
        borderBottomRightRadius: last ? 12 : 0,
      }
    : undefined;
  return (
    <View style={slice}>
      {first || !ios ? null : <View style={{ height: 0.5, marginLeft: 16 + TAG_MARK + 10, backgroundColor: c.border }} />}
      <Row onPress={toggle} role="checkbox" checked={on} minHeight={ios ? 44 : 48} label={`${name}, ${copy.filter.count(count)}`}>
        <TagMark on={on} onChange={toggle} />
        <Text numberOfLines={1} style={{ flex: 1, fontSize: ios ? 15 : 16, color: c.ink }}>
          {name}
        </Text>
        <Text style={{ minWidth: COUNT_WIDTH, textAlign: 'right', fontSize: ios ? 15 : 14, color: c.sub, fontVariant: ['tabular-nums'] }}>{count}</Text>
      </Row>
    </View>
  );
});

/**
 * One row of the sheet: the whole row presses as its control does, so a tap on the words works too. On iOS a SwiftUI
 * Toggle keeps its own focus (`ownsFocus`); otherwise the row is the control a screen reader meets.
 */
function Row({
  children,
  onPress,
  role,
  checked,
  ownsFocus = false,
  minHeight = ios ? 44 : 56,
  label,
}: {
  children: React.ReactNode;
  onPress: () => void;
  role: 'switch' | 'checkbox';
  checked: boolean;
  ownsFocus?: boolean;
  minHeight?: number;
  label?: string;
}) {
  return (
    <SheetPress
      onPress={onPress}
      accessible={!ownsFocus}
      accessibilityRole={ownsFocus ? undefined : role}
      accessibilityState={ownsFocus ? undefined : { checked }}
      accessibilityLabel={ownsFocus ? undefined : label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: ios ? 10 : 16, minHeight, paddingHorizontal: ios ? 16 : 8 }}
    >
      {children}
    </SheetPress>
  );
}
