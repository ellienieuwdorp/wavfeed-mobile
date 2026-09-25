/**
 * A Release's artwork: Bandcamp's image where the row carries an art id, over the flat colour block it falls back to
 * while loading or when there is none (the v2 client canvas).
 */
import { Image } from 'expo-image';
import { View } from 'react-native';

import { artColour } from '@/theme/tokens';

export function Artwork({ hue, size, radius = 6, url = null }: { hue: number; size: number; radius?: number; url?: string | null }) {
  const box = { width: size, height: size, borderRadius: radius, backgroundColor: artColour(hue) };
  if (url === null) return <View style={box} />;
  return <Image source={{ uri: url }} style={box} contentFit="cover" transition={120} recyclingKey={url} accessibilityIgnoresInvertColors />;
}
