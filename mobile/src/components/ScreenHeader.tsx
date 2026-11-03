/**
 * The in-scroll half of a view's header (DESIGN-UI section 9, the v2 client canvas): under the native large title on
 * iOS, "Updated 12 min ago" as one quiet line; on Android the medium app bar's title with that line as its subtitle (see
 * AppBar). While the first walk runs the line is the catch-up, the count and the month, then the note to keep the app
 * open, then the hairline at the text column's width, heard as the bar's value, a paused
 * walk's catch-up too, without the note. No line before the first gather. Settings passes `quiet`: its status
 * row says when it gathered, so its title takes the catch-up alone and no line otherwise. Its lines grow as row facts,
 * capped below the large title, so the title stays the header's largest text (review VIS-1). The catch-up is no live
 * region: a screen reader hears it on focus, and only the walk's end and pause unprompted (NoticeProvider, VIS-2).
 * The store build banner follows the lines on every tab, hideable everywhere but Settings. New releases
 * passes its count, which leads the line ("310 releases · updated 12 min ago"), and while its filter is active the
 * "Filtered by" pill in place of that line, 14 under the title on iOS and 16 on Android; during the first walk the
 * catch-up keeps its place and the pill follows it. New releases (`filterable`) holds the pill's
 * height for that line, under the catch-up too, so the pill coming or going moves nothing below (`FilterLineSlot`).
 */
import { Platform, View } from 'react-native';

import { FilterEaseLine } from '@/components/filter/FilterEase';
import { FilteredBy } from '@/components/filter/FilteredBy';
import { FilterLineSlot } from '@/components/filter/FilterLineSlot';
import { catchUpHeader, countedHeader } from '@/copy';
import { useGatherStatus } from '@/state/status';
import { useTokens } from '@/theme/tokens';

import { AppBarTitle } from './AppBar';
import { CatchUpHairline, progressValue } from './CatchUp';
import { Type } from './Type';
import { UpdateBanner } from './UpdateBanner';

/**
 * `count` leads the quiet line; `filteredBy` is the pill's words, drawn instead of that line; `filterable` holds the
 * pill's place on the view its filter narrows, New releases.
 */
type Lines = { quiet?: boolean; count?: number | null; filteredBy?: string | null; filterable?: boolean };

export function ScreenHeader({ quiet = false, count = null, filteredBy = null, filterable = false }: Lines) {
  return (
    <>
      <HeaderLines quiet={quiet} count={count} filteredBy={filteredBy} filterable={filterable} />
      <UpdateBanner hideable={!quiet} />
    </>
  );
}

function HeaderLines({ quiet, count, filteredBy, filterable }: Required<Lines>) {
  const { c, type } = useTokens();
  const status = useGatherStatus();
  const line = status.catchUp;
  const header = quiet ? null : status.header;
  const android = Platform.OS === 'android';
  // A filter change swaps the line for the pill, or the pill's words, crossfaded with the rows (components/filter/FilterEase.tsx).
  const pill = filteredBy === null ? null : (
    <FilterEaseLine key={filteredBy}>
      <FilteredBy text={filteredBy} />
    </FilterEaseLine>
  );
  if (line === null) {
    const note = count === null || header === null ? header : countedHeader(count, header);
    if (android) return <AppBarTitle subtitle={note} pill={pill} filterable={filterable} barSubtitle={pill === null ? note : filteredBy} />;
    const quietLine = note === null ? null : <Type style={{ fontSize: type.sub, color: c.sub }}>{note}</Type>;
    if (filterable) {
      return (
        <View style={{ marginTop: PILL_TOP, paddingHorizontal: type.gutter, paddingBottom: 12 }}>
          <FilterLineSlot strut={quietLine}>{pill ?? (quietLine === null ? null : <FilterEaseLine key="note">{quietLine}</FilterEaseLine>)}</FilterLineSlot>
        </View>
      );
    }
    if (quietLine === null) return quiet ? null : <View style={{ height: 8 }} />;
    return <View style={{ paddingHorizontal: type.gutter, paddingBottom: 12 }}>{quietLine}</View>;
  }
  const note = header;
  const text = catchUpHeader(line.primary, line.secondary);
  const a11y = { accessible: true, accessibilityValue: progressValue(line.fraction) };
  const below = (
    <>
      {note === null ? null : <Type style={{ fontSize: type.sub, lineHeight: 20, color: c.sub }}>{note}</Type>}
      <CatchUpHairline line={line} />
    </>
  );
  if (android) return <AppBarTitle subtitle={text} below={below} a11y={a11y} pill={pill} filterable={filterable} />;
  return (
    <>
      <View {...a11y} style={{ gap: 6, paddingHorizontal: type.gutter, paddingBottom: 12 }}>
        <Type style={{ fontSize: type.sub, color: c.sub, fontVariant: ['tabular-nums'] }}>{text}</Type>
        {below}
      </View>
      {filterable ? (
        <View style={{ paddingHorizontal: type.gutter, paddingBottom: 12 }}>
          <FilterLineSlot strut={null}>{pill}</FilterLineSlot>
        </View>
      ) : null}
    </>
  );
}

/** The list starts 16 under the native large title's glyphs; this pulls the pill up to 14 below them. */
const PILL_TOP = -2;
