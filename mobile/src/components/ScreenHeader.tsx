/**
 * The in-scroll half of a view's header (DESIGN-UI section 9, the v2 client canvas): under the native large title on
 * iOS, "Updated 12 min ago" as one quiet line, or while the first walk runs the note to keep the app open (task 0040);
 * on Android the medium app bar's title with that line as its subtitle (see AppBar). While nothing plays the catch-up
 * itself rides the tab bar's accessory or the strip (see CatchUp); once something plays it moves here, as the count and
 * the month over the hairline at the text column's width, heard as the bar's value (task 0040, decision 6), a paused
 * walk's too, as the strip carries it. No line before the first gather. Settings passes `quiet`: its status row says
 * when it gathered, so its title takes the catch-up while something plays and no line otherwise.
 */
import { Platform, Text, View } from 'react-native';

import { catchUpHeader } from '@/copy';
import { useGatherStatus } from '@/state/status';
import { useTokens } from '@/theme/tokens';

import { AppBarTitle } from './AppBar';
import { CatchUpHairline, progressValue } from './CatchUp';
import { usePlayerRelease } from './player/playerState';

export function ScreenHeader({ quiet = false }: { quiet?: boolean }) {
  const { c, type } = useTokens();
  const status = useGatherStatus();
  const playing = usePlayerRelease() !== null;
  const line = playing ? status.catchUp : null;
  const text = line !== null ? catchUpHeader(line.primary, line.secondary) : quiet ? null : status.header;
  const hairline = line === null ? null : <CatchUpHairline line={line} />;
  const a11y = line === null ? {} : { accessible: true, accessibilityValue: progressValue(line.fraction), accessibilityLiveRegion: 'polite' as const };
  if (Platform.OS === 'android') return <AppBarTitle subtitle={text} below={hairline} a11y={a11y} />;
  if (text === null) return quiet ? null : <View style={{ height: 8 }} />;
  return (
    <View {...a11y} style={{ gap: 6, paddingHorizontal: type.gutter, paddingBottom: 12 }}>
      <Text style={{ fontSize: type.sub, color: c.sub, fontVariant: line === null ? undefined : ['tabular-nums'] }}>{text}</Text>
      {hairline}
    </View>
  );
}
