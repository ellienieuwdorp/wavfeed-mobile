/**
 * The wishlist heart, one control everywhere (DESIGN-UI section 12, ADR-0016, task 0036): a 44pt target drawing each
 * state the section names. Not asked yet is the off outline taking no press; off is the faint outline; pending keeps
 * the last confirmed shape in the wishlist colour at reduced opacity, pulsing unless reduce motion is on; on is filled.
 * A failure puts the heart back on the truth and raises one notice line. With `trackId` it acts on that Track of the
 * Release, which is how the player's heart works; its title then names the Track. On Android it is a 48dp icon
 * button whose ripple is the 40dp state layer.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, Pressable } from 'react-native';

import { storeItemType, type PlayableRelease } from '@/player/transport';
import { pressedOpacity, ripple, useTokens } from '@/theme/tokens';
import { wishlistCopy } from '@/wishlist/copy';
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
};

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (alive) setReduce(on);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return reduce;
}

function usePulse(active: boolean): Animated.Value {
  const reduce = useReduceMotion();
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!active) {
      opacity.setValue(1);
      return;
    }
    opacity.setValue(0.5);
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.25, duration: PULSE_MS, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: PULSE_MS, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, opacity, reduce]);
  return opacity;
}

export function Heart({ itemType, itemId, title, trackId, box: boxSize, icon }: HeartProps) {
  const { c } = useTokens();
  const release = { itemType: storeItemType(itemType), itemId };
  const target: WishlistTarget = trackId === undefined ? { ...release, release } : { itemType: 't', itemId: trackId, release };
  const membership = useMembership(target.itemType, target.itemId);
  const pending = usePendingAction(target.itemType, target.itemId);
  const press = useWishlistPress();
  const opacity = usePulse(pending !== null);
  const box = boxSize ?? (ios ? 44 : 48);

  const wishlisted = membership.known && membership.wishlisted;
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
      <Animated.View style={{ opacity }}>
        <Ionicons
          name={wishlisted ? 'heart' : 'heart-outline'}
          size={icon ?? (ios ? 20 : 22)}
          color={wishlisted || pending !== null ? c.wishlist : c.faint}
        />
      </Animated.View>
    </Pressable>
  );
}
