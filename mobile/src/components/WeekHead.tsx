/**
 * List heads for the week spine (DESIGN-UI section 3, the v2 client canvas): the Upcoming band head, 20pt bold on iOS
 * and a 16sp ink list subheader on Android, and week subheads with the date range after a middot in sub colour ("This
 * week · Mon 21 – Sun 27 Sep"), 15pt/600 ink on iOS and Material's 14sp list subheader in sub on Android.
 */
import { Platform, Text } from 'react-native';

import { sep } from '@/copy';

import { useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';

export function BandHead({ label }: { label: string }) {
  const { c, type } = useTokens();
  return (
    <Text
      accessibilityRole="header"
      style={{ fontSize: type.upcomingHead, fontWeight: ios ? '700' : '600', color: c.ink, paddingHorizontal: type.gutter, paddingTop: ios ? 6 : 8, paddingBottom: ios ? 2 : 0 }}
    >
      {label}
    </Text>
  );
}

export function WeekHead({ week, range }: { week: string; range?: string }) {
  const { c, type } = useTokens();
  return (
    <Text
      accessibilityRole="header"
      style={{ fontSize: type.sectionHead, lineHeight: ios ? undefined : 20, fontWeight: '600', color: ios ? c.ink : c.sub, paddingHorizontal: type.gutter, paddingTop: ios ? 16 : 20, paddingBottom: ios ? 6 : 8 }}
    >
      {week}
      {range ? <Text style={{ fontSize: ios ? 13 : type.sectionHead, fontWeight: '400', color: c.sub }}>{sep + range}</Text> : null}
    </Text>
  );
}
