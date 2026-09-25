/**
 * Bought: the mode picker under the header, then week sections of Releases
 * people you follow bought, each with its buyer faces and label, and "Show all"
 * after the weeks that hold more (the v2 client canvas).
 */
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { AvatarStack } from '@/components/AvatarStack';
import { GapRow } from '@/components/GapRow';
import { ReleaseRow } from '@/components/ReleaseRow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Segmented } from '@/components/Segmented';
import { WeekHead } from '@/components/WeekHead';
import { copy } from '@/copy';
import { BOUGHT, type BoughtRelease } from '@/mock/data';
import { useTokens } from '@/theme/tokens';

type Mode = 'release' | 'purchased';

type Item =
  | { key: string; kind: 'header' }
  | { key: string; kind: 'week'; week: string; range?: string }
  | { key: string; kind: 'release'; release: BoughtRelease }
  | { key: string; kind: 'all'; n: number }
  | { key: string; kind: 'gap'; text: string };

const items: Item[] = [{ key: 'header', kind: 'header' }];
for (const block of BOUGHT) {
  if (block.kind === 'gap') items.push({ key: `gap-${block.text}`, kind: 'gap', text: block.text });
  else {
    items.push({ key: `week-${block.week}`, kind: 'week', week: block.week, range: block.range });
    for (const r of block.rows) items.push({ key: `${block.week}-${r.t}-${r.a}`, kind: 'release', release: r });
    if (block.all) items.push({ key: `all-${block.week}`, kind: 'all', n: block.all });
  }
}

function Header() {
  const { type } = useTokens();
  const [mode, setMode] = useState<Mode>('release');
  return (
    <View>
      <ScreenHeader />
      <View style={{ paddingHorizontal: type.gutter, paddingBottom: 4 }}>
        <Segmented
          segments={[
            { key: 'release', label: copy.bought.byReleaseDate },
            { key: 'purchased', label: copy.bought.byPurchased },
          ]}
          value={mode}
          onChange={setMode}
        />
      </View>
    </View>
  );
}

function Buyers({ release }: { release: BoughtRelease }) {
  const { c, type } = useTokens();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <AvatarStack initials={release.buyers} more={release.more} />
      <Text numberOfLines={1} style={{ flex: 1, fontSize: type.fact, color: c.sub }}>{release.l}</Text>
    </View>
  );
}

function ShowAll({ n }: { n: number }) {
  const { c, type } = useTokens();
  return (
    <Pressable accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: type.gutter }}>
      <Text style={{ fontSize: 15, color: c.accent }}>{copy.bought.showAll(n)}</Text>
    </Pressable>
  );
}

function render({ item }: { item: Item }) {
  switch (item.kind) {
    case 'header':
      return <Header />;
    case 'week':
      return <WeekHead week={item.week} range={item.range} />;
    case 'gap':
      return <GapRow text={item.text} />;
    case 'all':
      return <ShowAll n={item.n} />;
    case 'release':
      return <ReleaseRow release={item.release} detail={<Buyers release={item.release} />} />;
  }
}

export default function Bought() {
  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.key}
      renderItem={render}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 32 }}
    />
  );
}
