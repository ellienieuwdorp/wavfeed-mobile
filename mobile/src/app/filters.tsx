/**
 * The Filters sheet (task 0071, decision 7, R5 count option C, the round-four flow and Number and icon boards): the
 * bar, the people group, then the tags. On iOS the bar holds Clear, "Filters" over the live count, and Done, on the
 * grouped sheet's own greys; on Android "Filters" and the count, then Clear as a Material text button at the row's end
 * (Open 11, answered by the author 2026-10-14), a tap outside, a drag down or back closing it. The people group is the people glyph, "Bought by people you follow" and its switch, and under it
 * "At least [−] 2 [+] people" with the Releases that minimum alone keeps in the tag counts' column (Open 4, option C).
 * The tags follow, highest count first, counted after the people filter (Open 3), places left out; the first few
 * show, any chosen one among them, then "Show all 34"; the search narrows them by name. Every change is written at
 * once, so the list behind changes with each tap (see state/releaseFilter.ts); no change is counted (Open 5). It opens
 * with nothing chosen the first time, and Clear goes back there on both platforms (decisions 5 and 7 as amended
 * 2026-10-14). Each tag leads with its checkbox (TagMark).
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, PlatformColor, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glyph } from '@/components/Glyph';
import { NativeSwitch } from '@/components/NativeSwitch';
import { SearchField, Stepper, TAG_MARK, TagMark } from '@/components/filter/Controls';
import { copy } from '@/copy';
import { PEOPLE_MAX, PEOPLE_MIN, shownTags } from '@/domain/releaseFilter';
import { NOTHING_CHOSEN } from '@/state/filterSettings';
import { useReleaseFilter } from '@/state/releaseFilter';
import { PRESS_FLASH, pressedOpacity, ripple, useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';
/** Tags shown before "Show all": what the full-height boards draw. */
const FIRST_TAGS = ios ? 9 : 8;
/** The counts' column, so the minimum's count and the tags' share one right edge (Open 4, option C). */
const COUNT_WIDTH = 34;

export default function Filters() {
  const { c } = useTokens();
  const insets = useSafeAreaInsets();
  const { settings: saved, filtered, update: change } = useReleaseFilter();
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const settings = saved ?? NOTHING_CHOSEN;
  const min = settings.people.min;
  const tags = filtered?.tags ?? [];
  const byMinimum = filtered?.byMinimum.find((m) => m.min === min)?.count ?? 0;
  const shown = shownTags(tags, settings.tags, query, all ? Infinity : FIRST_TAGS);
  const count = copy.filter.count(filtered?.matching ?? 0);

  const cell = ios ? PlatformColor('secondarySystemGroupedBackground') : undefined;
  const group = ios ? { backgroundColor: cell, borderRadius: 12, borderCurve: 'continuous' as const, overflow: 'hidden' as const } : {};
  const rule = (inset: number) => (ios ? <View style={{ height: 0.5, marginLeft: inset, backgroundColor: c.border }} /> : null);

  const toggleTag = (name: string, on: boolean) => change({ people: settings.people, tags: on ? [...settings.tags, name] : settings.tags.filter((t) => t !== name) });

  // react-native-screens sizes an iOS sheet's ScrollView to the sheet less the one view above it, so the bar is that
  // view, kept unflattened, and the sheet's ground is the screen's own (contentStyle in app/_layout.tsx).
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
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: ios ? 6 : 12, paddingBottom: 24 + insets.bottom }}
      >
        <View style={group}>
          <Row onPress={() => change({ people: { ...settings.people, on: !settings.people.on }, tags: settings.tags })} role="switch" checked={settings.people.on} ownsFocus={ios}>
            <Glyph name="people" size={24} colour={c.accent} weight="regular" />
            <Text style={{ flex: 1, fontSize: ios ? 15 : 16, color: c.ink }}>{copy.filter.people}</Text>
            <NativeSwitch value={settings.people.on} onChange={(on) => change({ people: { ...settings.people, on }, tags: settings.tags })} label={copy.filter.people} />
          </Row>
          {rule(16)}
          <View
            accessible={false}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: ios ? 16 : 8, opacity: settings.people.on ? 1 : 0.45 }}
          >
            <Text style={{ fontSize: ios ? 15 : 16, lineHeight: 22, color: c.ink }} importantForAccessibility="no" accessibilityElementsHidden>
              {copy.filter.atLeast}
            </Text>
            <Stepper value={min} min={PEOPLE_MIN} max={PEOPLE_MAX} spoken={copy.filter.minimum} onChange={(n) => change({ people: { on: true, min: n }, tags: settings.tags })} />
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
        <View style={group}>
          {shown.length === 0 && tags.length > 0 ? (
            <Text style={{ fontSize: ios ? 15 : 16, color: c.sub, paddingHorizontal: ios ? 16 : 8, paddingVertical: 12 }}>{copy.filter.noTags}</Text>
          ) : null}
          {shown.map((tag, n) => {
            const on = settings.tags.includes(tag.normName);
            return (
              <View key={tag.normName}>
                {n > 0 ? rule(16 + TAG_MARK + 10) : null}
                <Row onPress={() => toggleTag(tag.normName, !on)} role="checkbox" checked={on} minHeight={ios ? 44 : 48} label={`${tag.name}, ${copy.filter.count(tag.count)}`}>
                  <TagMark on={on} onChange={(next) => toggleTag(tag.normName, next)} />
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: ios ? 15 : 16, color: c.ink }}>{tag.name}</Text>
                  <Text style={{ minWidth: COUNT_WIDTH, textAlign: 'right', fontSize: ios ? 15 : 14, color: c.sub, fontVariant: ['tabular-nums'] }}>{tag.count}</Text>
                </Row>
              </View>
            );
          })}
          {!all && query.trim() === '' && tags.some((tag) => !shown.includes(tag)) ? (
            <>
              {ios ? rule(16) : null}
              <Pressable
                onPress={() => setAll(true)}
                accessibilityRole="button"
                android_ripple={ripple(c.track)}
                style={({ pressed }) => ({ minHeight: ios ? 44 : 40, justifyContent: 'center', paddingHorizontal: ios ? 16 : 8, backgroundColor: ios && pressed ? PRESS_FLASH : undefined })}
              >
                <Text style={ios ? { fontSize: 15, color: c.accent } : { fontSize: 14, fontWeight: '500', color: c.accentText }}>{copy.filter.showAll(tags.length)}</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      </ScrollView>
    </>
  );
}

function BarButton({ label, bold = false, onPress }: { label: string; bold?: boolean; onPress: () => void }) {
  const { c } = useTokens();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8} style={({ pressed }) => ({ opacity: pressedOpacity(pressed), paddingVertical: 6 })}>
      <Text style={{ fontSize: 17, fontWeight: bold ? '600' : '400', color: c.accent }}>{label}</Text>
    </Pressable>
  );
}

/** Material 3's text button, the label in the accent, its ripple a pill the 48 height of its target. */
function TextButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { c } = useTokens();
  return (
    <View style={{ borderRadius: 24, overflow: 'hidden' }}>
      <Pressable onPress={onPress} accessibilityRole="button" android_ripple={ripple(c.track)} style={{ minHeight: 48, paddingHorizontal: 12, justifyContent: 'center' }}>
        <Text style={{ fontSize: 14, lineHeight: 20, fontWeight: '500', letterSpacing: 0.1, color: c.accentText }}>{label}</Text>
      </Pressable>
    </View>
  );
}

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
  const { c } = useTokens();
  return (
    <Pressable
      onPress={onPress}
      accessible={!ownsFocus}
      accessibilityRole={ownsFocus ? undefined : role}
      accessibilityState={ownsFocus ? undefined : { checked }}
      accessibilityLabel={ownsFocus ? undefined : label}
      android_ripple={ripple(c.track)}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: ios ? 10 : 16, minHeight, paddingHorizontal: ios ? 16 : 8, backgroundColor: ios && pressed ? PRESS_FLASH : undefined })}
    >
      {children}
    </Pressable>
  );
}
