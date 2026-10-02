/**
 * The player sheet's art side (DESIGN-UI section 10): the content width while the first Track row still shows above the
 * sheet's visible foot when it opens, else what does fit, never under ART_FLOOR, below which a small phone's tracklist
 * starts further down instead. The lines over that row grow with the text size as the sheet draws them: Type's lines at
 * the row cap (review VIS-1), a plain Text's uncapped.
 */
import { scaledSize } from '@/theme/textSize';

export const ART_FLOOR = 220;

/** The sheet from its top edge to the first Track row's foot, less the art: what holds its height, and the lines at the default text size. */
export type AboveFirstRow = { fixed: number; rowLines: number; plainLines: number };

export function artSide(content: number, visible: number, fontScale: number, above: AboveFirstRow): number {
  const room = visible - above.fixed - scaledSize(above.rowLines, fontScale, 'row') - above.plainLines * fontScale;
  return Math.floor(Math.max(ART_FLOOR, Math.min(content, room)));
}
