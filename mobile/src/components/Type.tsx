/**
 * Text that grows with the system text size up to its role's cap (review VIS-1, theme/textSize.ts): `row` for row
 * facts, captions and links, `head` for module heads and view titles, `fixed` for words in a box that does not grow.
 */
import { Text, type TextProps } from 'react-native';

import { SCALE_CAP, type TextScale } from '@/theme/textSize';

export function Type({ scale = 'row', ...props }: TextProps & { scale?: TextScale }) {
  return <Text maxFontSizeMultiplier={SCALE_CAP[scale]} {...props} />;
}
