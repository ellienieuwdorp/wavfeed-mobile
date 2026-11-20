/**
 * The faces of the Fans who bought it: discs in a ring, the Fan's Bandcamp image or one initial, overlapping, capped
 * with a faint "+N" after (DESIGN-UI section 3). The Feed's card and an Upcoming card
 * draw 20pt discs in a 2pt ring overlapping by 6; a list row draws 24pt ones, three at most, its ring and overlap in
 * the same proportion (the author's request of 2026-10-15). `onArt` draws an Upcoming card's stack over its cover, on
 * the art's mark backing with "+N" in a last disc of its own, white figures on black. With `opens` set the stack is a button opening the Bought by sheet with these Fans (the canvas, sections
 * 6 and 7), unless a row's swipe took the touch (useTakenBySwipe). A disc does not grow with the text size, so its initial does not either, nor does the "+N" on art (review
 * VIS-1).
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { PixelRatio, Pressable, Text, View, type Insets } from 'react-native';

import { copy } from '@/copy';
import type { FanRef } from '@/domain/views';
import { fanAvatarInitials, fanAvatarUrl, sizedImageUrl } from '@/lib/format';
import { ON_ART, pressedOpacity, ripple, useTokens } from '@/theme/tokens';

import { Type } from './Type';
import { useTakenBySwipe } from './WishlistSwipe';

export const AVATAR_CAP = 5;
const DISC = 20;
/**
 * 2pt above the faces and 8pt below, on the Feed's card where the stack has its own line under the credit line, so its
 * press area never reaches into the line above (finding VIS-13, DESIGN-UI section 11); a row and an Upcoming card pass
 * their own (ReleaseRow.tsx, UpcomingShelf.tsx). Android's ripple is bounded to the stack for the same reason; a borderless one
 * would spread past the slop.
 */
const SLOP = { top: 2, bottom: 8, left: 8, right: 8 };
/**
 * The ring between discs on the art's backing, solid since a disc's ring hides the one it overlaps, and the fill of the
 * "+N" disc that ends the stack there. A disc where the rows write "+N" holds the stack at three discs' width whatever
 * N is, so it clears a "12/14" on a card.
 */
const ART_RING = '#1c1c1c';
/** The backing's edge around the discs, which with them sets the art marks' height (ON_ART.mark). */
const ART_PAD = ON_ART.edge;

/** A Fan's image at the size that covers `size` in this screen's pixels (finding VIS-M3). */
function faceUrl(fan: FanRef, size: number): string | null {
  const url = fanAvatarUrl(fan.imageId);
  return url === null ? null : sizedImageUrl(url, PixelRatio.getPixelSizeForLayoutSize(size));
}

/** One Fan's face at `size`, the image or the initials on the avatar tone. */
export function FanFace({ fan, size }: { fan: FanRef; size: number }) {
  const { c } = useTokens();
  const url = faceUrl(fan, size);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.avatarBg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {url === null ? (
        <Text allowFontScaling={false} style={{ fontSize: Math.round(size * 0.36), fontWeight: '600', color: c.avatarInk }}>{fanAvatarInitials(fan)}</Text>
      ) : (
        <Image source={{ uri: url }} style={{ width: size, height: size }} />
      )}
    </View>
  );
}

// The Fans ride in the route param as JSON, fixed at the press, since the store has no Fans-by-Release read.
export function openBoughtBy(fans: readonly FanRef[]) {
  router.push({ pathname: '/bought-by', params: { fans: JSON.stringify(fans) } });
}

export function AvatarStack({ fans, ring, opens = false, onArt = false, cap = AVATAR_CAP, size = DISC, hitSlop = SLOP }: { fans: readonly FanRef[]; ring?: string; opens?: boolean; onArt?: boolean; cap?: number; size?: number; hitSlop?: Insets }) {
  const { c } = useTokens();
  const taken = useTakenBySwipe();
  const shown = fans.slice(0, cap);
  const more = fans.length - shown.length;
  const names = fans.map((fan) => fan.username).join(', ');
  // The ring is a tenth of the disc and the overlap three tenths, 2 and 6 on a 20pt disc.
  const edge = PixelRatio.roundToNearestPixel(size / 10);
  const overlap = PixelRatio.roundToNearestPixel(size * 0.3);
  const face = size - 2 * edge;
  const stack = (
    <View style={[{ flexDirection: 'row', alignItems: 'center' }, onArt ? { padding: ART_PAD, borderRadius: size / 2 + ART_PAD, backgroundColor: ON_ART.ground } : null]} accessibilityLabel={opens ? undefined : names}>
      {shown.map((fan, n) => {
        const url = faceUrl(fan, face);
        return (
          <View
            key={fan.fanId}
            style={{
              width: size,
              height: size,
              borderRadius: size / 2,
              marginLeft: n === 0 ? 0 : -overlap,
              borderWidth: edge,
              borderColor: onArt ? ART_RING : (ring ?? c.bg),
              backgroundColor: c.avatarBg,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {url === null ? (
              <Text allowFontScaling={false} style={{ fontSize: Math.round(size / 2), fontWeight: '600', color: c.avatarInk }}>{fanAvatarInitials(fan).slice(0, 1)}</Text>
            ) : (
              <Image source={{ uri: url }} style={{ width: face, height: face, borderRadius: face / 2 }} />
            )}
          </View>
        );
      })}
      {more === 0 ? null : onArt ? (
        <View style={{ width: size, height: size, borderRadius: size / 2, marginLeft: -overlap, backgroundColor: ART_RING, alignItems: 'center', justifyContent: 'center' }}>
          <Text allowFontScaling={false} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[ON_ART.small, { paddingHorizontal: 1, color: ON_ART.ink }]}>
            {copy.more(more)}
          </Text>
        </View>
      ) : (
        <Type style={{ marginLeft: 4, fontSize: size > DISC ? 12 : 11, color: c.faint }}>{copy.more(more)}</Type>
      )}
    </View>
  );
  if (!opens || fans.length === 0) return stack;
  return (
    <Pressable
      onPress={() => {
        if (!taken()) openBoughtBy(fans);
      }}
      accessibilityRole="button"
      accessibilityLabel={copy.boughtBy.stack(names)}
      accessibilityHint={copy.boughtBy.hint}
      hitSlop={hitSlop}
      android_ripple={ripple(c.track)}
      style={({ pressed }) => ({ opacity: pressedOpacity(pressed), borderRadius: onArt ? size / 2 + ART_PAD : undefined })}
    >
      {stack}
    </Pressable>
  );
}
