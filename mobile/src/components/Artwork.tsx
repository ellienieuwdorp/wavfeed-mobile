/**
 * A Release's artwork: Bandcamp's image where the row carries an art id, over the flat colour block it falls back to
 * while loading or when there is none (the v2 client canvas). The image is asked for at the size that covers `size` in
 * this screen's pixels (`sizedImageUrl`, finding VIS-7), so callers pass any address for the art and never a size id.
 */
import { Image } from 'expo-image';
import { PixelRatio, View } from 'react-native';

import { sizedImageUrl } from '@/lib/format';
import { artColour } from '@/theme/tokens';

export function Artwork({ hue, size, radius = 6, url = null }: { hue: number; size: number; radius?: number; url?: string | null }) {
  const box = { width: size, height: size, borderRadius: radius, backgroundColor: artColour(hue) };
  if (url === null) return <View style={box} />;
  const sized = sizedImageUrl(url, PixelRatio.getPixelSizeForLayoutSize(size));
  return <Image source={{ uri: sized }} style={box} contentFit="cover" transition={120} recyclingKey={sized} accessibilityIgnoresInvertColors />;
}
