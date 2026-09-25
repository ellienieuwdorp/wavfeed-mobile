/**
 * The wishlist heart (DESIGN-UI section 12): outline in faint when off, filled
 * in the wishlist colour when on. This slice flips local state only.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Platform, Pressable } from 'react-native';

import { copy } from '@/copy';
import { useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';

export function Heart({ title, initial = false, box: boxSize, icon }: { title: string; initial?: boolean; box?: number; icon?: number }) {
  const { c } = useTokens();
  const [on, setOn] = useState(initial);
  const box = boxSize ?? (ios ? 44 : 48);
  return (
    <Pressable
      onPress={() => setOn(!on)}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={on ? copy.heart.remove(title) : copy.heart.add(title)}
      style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}
    >
      <Ionicons name={on ? 'heart' : 'heart-outline'} size={icon ?? (ios ? 20 : 22)} color={on ? c.wishlist : c.faint} />
    </Pressable>
  );
}
