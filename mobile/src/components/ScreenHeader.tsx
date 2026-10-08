/**
 * The in-scroll half of a view's header (DESIGN-UI section 9, the v2 client canvas): under the native large title on
 * iOS, "Updated 12 min ago" as one quiet line; on Android the medium app bar's title with that line as its subtitle (see
 * AppBar). While the first walk runs the line is the catch-up, the count and the month, then the note to keep the app
 * open, then the hairline at the text column's width, heard as the bar's value (task 0040, decisions 3 and 8), a paused
 * walk's catch-up too, without the note. No line before the first gather. Settings passes `quiet`: its status
 * row says when it gathered, so its title takes the catch-up alone and no line otherwise.
 * The store build banner follows the lines on every tab (task 0064), hideable everywhere but Settings.
 */
import { Platform, Text, View } from 'react-native';

import { catchUpHeader } from '@/copy';
import { useGatherStatus } from '@/state/status';
import { useTokens } from '@/theme/tokens';

import { AppBarTitle } from './AppBar';
import { CatchUpHairline, progressValue } from './CatchUp';
import { UpdateBanner } from './UpdateBanner';

export function ScreenHeader({ quiet = false }: { quiet?: boolean }) {
  return (
    <>
      <HeaderLines quiet={quiet} />
      <UpdateBanner hideable={!quiet} />
    </>
  );
}

function HeaderLines({ quiet }: { quiet: boolean }) {
  const { c, type } = useTokens();
  const status = useGatherStatus();
  const line = status.catchUp;
  const note = quiet ? null : status.header;
  const android = Platform.OS === 'android';
  if (line === null) {
    if (android) return <AppBarTitle subtitle={note} />;
    if (note === null) return quiet ? null : <View style={{ height: 8 }} />;
    return <Text style={{ fontSize: type.sub, color: c.sub, paddingHorizontal: type.gutter, paddingBottom: 12 }}>{note}</Text>;
  }
  const text = catchUpHeader(line.primary, line.secondary);
  const a11y = { accessible: true, accessibilityValue: progressValue(line.fraction), accessibilityLiveRegion: 'polite' as const };
  const below = (
    <>
      {note === null ? null : <Text style={{ fontSize: type.sub, lineHeight: 20, color: c.sub }}>{note}</Text>}
      <CatchUpHairline line={line} />
    </>
  );
  if (android) return <AppBarTitle subtitle={text} below={below} a11y={a11y} />;
  return (
    <View {...a11y} style={{ gap: 6, paddingHorizontal: type.gutter, paddingBottom: 12 }}>
      <Text style={{ fontSize: type.sub, color: c.sub, fontVariant: ['tabular-nums'] }}>{text}</Text>
      {below}
    </View>
  );
}
