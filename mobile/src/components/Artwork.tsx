/**
 * A Release's artwork, drawn as a flat colour block from the sample hue until
 * real artwork arrives (the v2 client canvas).
 */
import { View } from 'react-native';

import { artColour } from '@/theme/tokens';

export function Artwork({ hue, size, radius = 6 }: { hue: number; size: number; radius?: number }) {
  return <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: artColour(hue) }} />;
}
