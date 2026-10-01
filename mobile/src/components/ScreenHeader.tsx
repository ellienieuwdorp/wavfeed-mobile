/**
 * The in-scroll half of a view's header (DESIGN-UI section 9, the v2 client canvas): under the native large title on
 * iOS, "Updated 12 min ago" as one quiet line; on Android the medium app bar's title with that line as its subtitle (see
 * AppBar). While the first walk runs the line is the catch-up, the count and the month, then the note to keep the app
 * open, then the hairline at the text column's width, heard as the bar's value (task 0040, decisions 3 and 8), a paused
 * walk's catch-up too, without the note. No line before the first gather. Settings passes `quiet`: its status
 * row says when it gathered, so its title takes the catch-up alone and no line otherwise. Its lines grow as row facts,
 * capped below the large title, so the title stays the header's largest text (review VIS-1). The catch-up is no live
 * region: a screen reader hears it on focus, and only the walk's end and pause unprompted (NoticeProvider, VIS-2).
 */
import { Platform, View } from 'react-native';

import { catchUpHeader } from '@/copy';
import { useGatherStatus } from '@/state/status';
import { useTokens } from '@/theme/tokens';

import { AppBarTitle } from './AppBar';
import { CatchUpHairline, progressValue } from './CatchUp';
import { Type } from './Type';

export function ScreenHeader({ quiet = false }: { quiet?: boolean }) {
  const { c, type } = useTokens();
  const status = useGatherStatus();
  const line = status.catchUp;
  const note = quiet ? null : status.header;
  const android = Platform.OS === 'android';
  if (line === null) {
    if (android) return <AppBarTitle subtitle={note} />;
    if (note === null) return quiet ? null : <View style={{ height: 8 }} />;
    return <Type style={{ fontSize: type.sub, color: c.sub, paddingHorizontal: type.gutter, paddingBottom: 12 }}>{note}</Type>;
  }
  const text = catchUpHeader(line.primary, line.secondary);
  const a11y = { accessible: true, accessibilityValue: progressValue(line.fraction) };
  const below = (
    <>
      {note === null ? null : <Type style={{ fontSize: type.sub, lineHeight: 20, color: c.sub }}>{note}</Type>}
      <CatchUpHairline line={line} />
    </>
  );
  if (android) return <AppBarTitle subtitle={text} below={below} a11y={a11y} />;
  return (
    <View {...a11y} style={{ gap: 6, paddingHorizontal: type.gutter, paddingBottom: 12 }}>
      <Type style={{ fontSize: type.sub, color: c.sub, fontVariant: ['tabular-nums'] }}>{text}</Type>
      {below}
    </View>
  );
}
