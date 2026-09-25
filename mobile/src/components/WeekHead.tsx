/**
 * List heads for the week spine (DESIGN-UI section 3, the v2 client canvas):
 * the Upcoming band head at 20pt bold, and week subheads at 15pt/600 with the
 * date range after a middot in sub colour ("This week · Mon 21 – Sun 27 Sep").
 */
import { Text } from 'react-native';

import { sep } from '@/copy';

import { useTokens } from '@/theme/tokens';

export function BandHead({ label }: { label: string }) {
  const { c, type } = useTokens();
  return (
    <Text style={{ fontSize: type.upcomingHead, fontWeight: '700', color: c.ink, paddingHorizontal: type.gutter, paddingTop: 6, paddingBottom: 2 }}>
      {label}
    </Text>
  );
}

export function WeekHead({ week, range }: { week: string; range?: string }) {
  const { c, type } = useTokens();
  return (
    <Text style={{ fontSize: type.sectionHead, fontWeight: '600', color: c.ink, paddingHorizontal: type.gutter, paddingTop: 16, paddingBottom: 6 }}>
      {week}
      {range ? <Text style={{ fontSize: 13, fontWeight: '400', color: c.sub }}>{sep + range}</Text> : null}
    </Text>
  );
}
