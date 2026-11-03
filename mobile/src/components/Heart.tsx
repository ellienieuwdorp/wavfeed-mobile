/**
 * The wishlist heart, one control everywhere (DESIGN-UI section 12, ADR-0016): a 44pt target drawing each
 * state the section names. Not asked yet is the off outline taking no press; off is the faint outline; on is filled in
 * Bandcamp's orange under a rim in the edge colour, which clears 3:1 on a light page where the orange does not (review
 * VIS-3, VIS-M5). A press flips it at once and the exchange travels behind it (ADR-0016 amendment 2026-10-02); the
 * pressed heart alone pops, started from its own press so the item's other hearts only change, springing up on an add
 * and dipping on a remove on the UI thread, and not at all under reduce motion. A failure the Fan is told about puts
 * the heart back on the truth and raises one notice line. `item` is what it acts on and the name its label says
 * (`releaseHeart`, `trackHeart`): the Release, or one Track of it as the player sheet's tracklist rows. `onArt` draws it over a cover,
 * the player sheet's: a dark disc under a white outline or the filled orange, legible on any art in either scheme, the
 * box and the press unchanged. On Android it is a 48dp icon button whose ripple is the 40dp state layer.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import type { WishlistWriteKind } from '@/bandcamp/wishlist';
import { useReduceMotion } from '@/player/motion';
import type { PressSurface } from '@/tally/actions';
import { pressedOpacity, ripple, useTokens } from '@/theme/tokens';
import { wishlistCopy } from '@/wishlist/copy';
import { useMembership, useWishlistPress } from '@/wishlist/state';
import type { HeartItem } from '@/wishlist/target';

const ios = Platform.OS === 'ios';

// An add swells to 1.3 and settles back past rest, about 300ms; a remove dips to 0.85 and returns, about 200ms.
const POP = {
  add: { peak: 1.3, out: 110, back: 190, settle: Easing.out(Easing.back(2)) },
  remove: { peak: 0.85, out: 80, back: 120, settle: Easing.out(Easing.quad) },
} as const;

type HeartProps = {
  item: HeartItem;
  box?: number;
  icon?: number;
  /** Where the heart sits, for `wishlist_action_finished`. */
  surface: PressSurface;
  /** Drawn over a cover (the player sheet's art) on a dark disc of this size. */
  onArt?: number;
};

/** The disc under a heart on art, the art badge's dark backing a little lighter (PlayArt), and its off outline. */
const ART_DISC = 'rgba(0,0,0,0.5)';
const ART_OFF = '#ffffff';

/** The pressed heart's scale and the call that pops it; under reduce motion the call does nothing. */
function usePop() {
  const reduce = useReduceMotion();
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const pop = (action: WishlistWriteKind) => {
    if (reduce) return;
    const { peak, out, back, settle } = POP[action];
    scale.set(withSequence(withTiming(peak, { duration: out, easing: Easing.out(Easing.quad) }), withTiming(1, { duration: back, easing: settle })));
  };
  return { style, pop };
}

export function Heart({ item, box: boxSize, icon, surface, onArt }: HeartProps) {
  const { c } = useTokens();
  const { target, name } = item;
  const membership = useMembership(target.itemType, target.itemId);
  const press = useWishlistPress(surface);
  const { style, pop } = usePop();
  const box = boxSize ?? (ios ? 44 : 48);
  const size = icon ?? (ios ? 20 : 22);

  const on = membership.known && membership.on;
  const label = membership.known ? wishlistCopy.action(name, on) : wishlistCopy.unknown(name);
  // On the page the filled heart takes the darker rim (VIS-3); on the art's dark disc the fill alone clears it.
  const outline = onArt === undefined ? (on ? c.wishlistEdge : c.faint) : on ? c.wishlist : ART_OFF;

  return (
    <Pressable
      onPress={() => {
        if (!membership.known) return;
        const action = on ? 'remove' : 'add';
        if (press(target, action)) pop(action);
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={membership.known ? ripple(c.track, 20) : undefined}
      accessibilityState={{ ...(membership.known ? { selected: on } : {}), disabled: !membership.known }}
      style={({ pressed }) => ({ width: Math.max(box, 44), height: Math.max(box, 44), alignItems: 'center', justifyContent: 'center', opacity: pressedOpacity(pressed && membership.known) })}
    >
      {onArt === undefined ? null : <View style={{ position: 'absolute', width: onArt, height: onArt, borderRadius: onArt / 2, backgroundColor: ART_DISC }} />}
      <Animated.View style={style}>
        {on ? (
          <View style={StyleSheet.absoluteFill}>
            <Ionicons name="heart" size={size} color={c.wishlist} />
          </View>
        ) : null}
        <Ionicons name="heart-outline" size={size} color={outline} />
      </Animated.View>
    </Pressable>
  );
}
