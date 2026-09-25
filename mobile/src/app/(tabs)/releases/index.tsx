/**
 * New releases: the Upcoming band with its week subheads, then the released
 * weeks and the quiet gaps between them (DESIGN-UI section 3, the v2 client
 * canvas), over the canvas sample data.
 */
import { FlatList } from 'react-native';

import { GapRow } from '@/components/GapRow';
import { useDockClearance } from '@/components/player/Dock';
import { FactLine, ReleaseRow } from '@/components/ReleaseRow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { BandHead, WeekHead } from '@/components/WeekHead';
import { copy } from '@/copy';
import { REL, type NewRelease } from '@/mock/data';

type Item =
  | { key: string; kind: 'header' }
  | { key: string; kind: 'band'; label: string }
  | { key: string; kind: 'week'; week: string; range?: string }
  | { key: string; kind: 'release'; release: NewRelease }
  | { key: string; kind: 'gap'; text: string };

const items: Item[] = [{ key: 'header', kind: 'header' }];
for (const block of REL) {
  if (block.kind === 'upcoming') items.push({ key: 'band-upcoming', kind: 'band', label: copy.releases.upcoming });
  else if (block.kind === 'gap') items.push({ key: `gap-${block.text}`, kind: 'gap', text: block.text });
  else if (block.kind === 'week') {
    items.push({ key: `week-${block.week}`, kind: 'week', week: block.week, range: block.range });
    for (const r of block.rows) items.push({ key: `${block.week}-${r.t}-${r.a}`, kind: 'release', release: r });
  }
}

function render({ item }: { item: Item }) {
  switch (item.kind) {
    case 'header':
      return <ScreenHeader />;
    case 'band':
      return <BandHead label={item.label} />;
    case 'week':
      return <WeekHead week={item.week} range={item.range} />;
    case 'gap':
      return <GapRow text={item.text} />;
    case 'release':
      return <ReleaseRow release={item.release} detail={<FactLine parts={[item.release.l, item.release.fact, item.release.day]} />} />;
  }
}

export default function NewReleases() {
  const clearance = useDockClearance();
  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.key}
      renderItem={render}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 32 + clearance }}
    />
  );
}
