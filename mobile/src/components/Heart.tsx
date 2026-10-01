/**
 * The wishlist heart, one control everywhere (DESIGN-UI section 12, ADR-0016, task 0036): a 44pt target drawing each
 * state the section names, as wishlist/look.ts sets it. Not asked yet is the off outline taking no press; off is the
 * faint outline; on is filled in Bandcamp's orange under a rim in the edge colour, which clears 3:1 on a light page
 * where the orange does not (review VIS-3, VIS-M5); pending keeps the last confirmed shape with the rim at full
 * opacity, and only its fill, faint for a remove and empty for an add, pulses, unless reduce motion is on.
 * A failure puts the heart back on the truth and raises one notice line. With `trackId` it acts on that Track of the
 * Release, which is how the player's heart works; its title then names the Track. On Android it is a 48dp icon
 * button whose ripple is the 40dp state layer.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';

import { useReduceMotion } from '@/player/motion';
import type { PressSurface } from '@/tally/actions';
import { storeItemType, type PlayableRelease } from '@/player/transport';
import { pressedOpacity, ripple, useTokens } from '@/theme/tokens';
import { wishlistCopy } from '@/wishlist/copy';
import { heartLook } from '@/wishlist/look';
import { useMembership, usePendingAction, useWishlistPress, type WishlistTarget } from '@/wishlist/state';

const ios = Platform.OS === 'ios';
const PULSE_MS = 900;

type HeartProps = {
  itemType: PlayableRelease['itemType'];
  itemId: string;
  title: string;
  trackId?: string;
  box?: number;
  icon?: number;
  /** Where the heart sits, for `wishlist_action_finished` (task 0038). */
  surface: PressSurface;
};

/** 0 at rest to 1 at the top of the pulse; it holds 0 while nothing is pending or reduce motion is on. */
function usePulse(active: boolean): Animated.Value {
  const reduce = useReduceMotion();
  const [breath] = useState(() => new Animated.Value(0));
  useEffect(() => {
    breath.setValue(0);
    if (!active || reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: PULSE_MS, useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: PULSE_MS, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, breath, reduce]);
  return breath;
}

export function Heart({ itemType, itemId, title, trackId, box: boxSize, icon, surface }: HeartProps) {
  const { c } = useTokens();
  const release = { itemType: storeItemType(itemType), itemId };
  const target: WishlistTarget = trackId === undefined ? { ...release, release } : { itemType: 't', itemId: trackId, release };
  const membership = useMembership(target.itemType, target.itemId);
  const pending = usePendingAction(target.itemType, target.itemId);
  const press = useWishlistPress(surface);
  const breath = usePulse(pending !== null);
  const box = boxSize ?? (ios ? 44 : 48);
  const size = icon ?? (ios ? 20 : 22);

  const wishlisted = membership.known && membership.wishlisted;
  const look = heartLook({ known: membership.known, wishlisted, pending: pending !== null });
  const takesPress = membership.known && pending === null;
  const label = !membership.known
    ? wishlistCopy.unknown(title)
    : pending !== null
      ? wishlistCopy.pending(title, pending)
      : wishlistCopy.action(title, wishlisted);

  return (
    <Pressable
      onPress={() => {
        if (takesPress) press(target, wishlisted ? 'remove' : 'add');
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={takesPress ? ripple(c.track, 20) : undefined}
      accessibilityState={{
        ...(membership.known ? { selected: wishlisted } : {}),
        busy: pending !== null,
        disabled: !takesPress,
      }}
      style={({ pressed }) => ({ width: Math.max(box, 44), height: Math.max(box, 44), alignItems: 'center', justifyContent: 'center', opacity: pressedOpacity(pressed && takesPress) })}
    >
      <View>
        {look.fill === null ? null : (
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [look.fill.rest, look.fill.peak] }) }]}>
            <Ionicons name="heart" size={size} color={c.wishlist} />
          </Animated.View>
        )}
        <Ionicons name="heart-outline" size={size} color={look.outline === 'edge' ? c.wishlistEdge : c.faint} />
      </View>
    </Pressable>
  );
}
