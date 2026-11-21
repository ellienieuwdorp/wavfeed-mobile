/**
 * The in-scroll half of a view's header (DESIGN-UI section 9): "Updated 12 min ago" under the native large title on
 * iOS, the medium app bar's subtitle on Android (AppBar). During a first walk the line is the catch-up, heard as the
 * bar's value and no live region (NoticeProvider, VIS-2). Settings passes `quiet`, since its status row says when it
 * gathered. Its lines are capped below the large title (VIS-1). New releases passes its count to lead the line and,
 * filtered, the "Filtered by" pill in its place; as `filterable` it holds the pill's height so the pill coming or
 * going moves nothing below (`FilterLineSlot`). The store build banner follows on every tab.
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
        <View style={{ marginTop: PILL_TOP, paddingHorizontal: type.gutter, paddingBottom: UNDER_SLOT }}>
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
        <View style={{ paddingHorizontal: type.gutter, paddingBottom: UNDER_SLOT }}>
          <FilterLineSlot strut={null}>{pill}</FilterLineSlot>
        </View>
      ) : null}
    </>
  );
}

/** The list starts 16 under the native large title's glyphs; this pulls the pill up to 14 below them. */
const PILL_TOP = -2;
/**
 * Under the pill's place, the first thing in the list, a week's band or the Upcoming shelf, starts 14 below the pill and
 * so about 23 below the count line centred in that place (DESIGN-UI section 3).
 */
const UNDER_SLOT = 14;
