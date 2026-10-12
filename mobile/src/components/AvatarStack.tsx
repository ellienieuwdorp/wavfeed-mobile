/**
 * The faces of the Fans who bought it: 20pt discs in a 2pt ring, the Fan's Bandcamp image or one initial, overlapping by
 * 6pt, capped at five (two on an Upcoming card) with a faint "+N" after (DESIGN-UI section 3, task 0071 decisions 12
 * and 14). With `opens` set the stack is a button
 * whose press area stays inside its own line, opening the Bought by sheet with these Fans (the canvas, sections 6 and 7). A
 * disc does not grow with the text size, so its initial does not either (review VIS-1).
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { PixelRatio, Pressable, Text, View } from 'react-native';

import { copy } from '@/copy';
import type { ApiFanRef } from '@/domain/apiTypes';
import { fanAvatarInitials, fanAvatarUrl, sizedImageUrl } from '@/lib/format';
import { pressedOpacity, ripple, useTokens } from '@/theme/tokens';

import { Type } from './Type';

export const AVATAR_CAP = 5;
const DISC = 20;
/**
 * 2pt above the faces and 8pt below: on a row the stack ends the credit line, 1pt under the title, above the body's
 * 9pt padding, so its press area never reaches into the title (finding VIS-13, DESIGN-UI section 11). Android's ripple
 * is bounded to the stack for the same reason; a borderless one would spread past the slop into the title.
 * ceiling: that makes the target 30pt tall, short of 44pt or 48dp; a stack the full height of the row's right edge,
 * under the pill, is the upgrade.
 */
const SLOP = { top: 2, bottom: 8, left: 8, right: 8 };

/** A Fan's image at the size that covers `size` in this screen's pixels (finding VIS-M3). */
function faceUrl(fan: ApiFanRef, size: number): string | null {
  const url = fanAvatarUrl(fan.imageId);
  return url === null ? null : sizedImageUrl(url, PixelRatio.getPixelSizeForLayoutSize(size));
}

/** One Fan's face at `size`, the image or the initials on the avatar tone. */
export function FanFace({ fan, size }: { fan: ApiFanRef; size: number }) {
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

// ceiling: the Fans ride in the route param as JSON, growing with the count and fixed at the press, because the store
// has no Fans-by-Release read; a readBoughtBy(db, itemType, itemId) query in store/queries.ts is the upgrade.
export function openBoughtBy(fans: readonly ApiFanRef[]) {
  router.push({ pathname: '/bought-by', params: { fans: JSON.stringify(fans) } });
}

export function AvatarStack({ fans, ring, opens = false, cap = AVATAR_CAP }: { fans: readonly ApiFanRef[]; ring?: string; opens?: boolean; cap?: number }) {
  const { c } = useTokens();
  const shown = fans.slice(0, cap);
  const more = fans.length - shown.length;
  const names = fans.map((fan) => fan.username).join(', ');
  const stack = (
    <View style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={opens ? undefined : names}>
      {shown.map((fan, n) => {
        const url = faceUrl(fan, 16);
        return (
          <View
            key={fan.fanId}
            style={{
              width: DISC,
              height: DISC,
              borderRadius: DISC / 2,
              marginLeft: n === 0 ? 0 : -6,
              borderWidth: 2,
              borderColor: ring ?? c.bg,
              backgroundColor: c.avatarBg,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {url === null ? (
              <Text allowFontScaling={false} style={{ fontSize: 10, fontWeight: '600', color: c.avatarInk }}>{fanAvatarInitials(fan).slice(0, 1)}</Text>
            ) : (
              <Image source={{ uri: url }} style={{ width: 16, height: 16, borderRadius: 8 }} />
            )}
          </View>
        );
      })}
      {more > 0 ? <Type style={{ marginLeft: 4, fontSize: 11, color: c.faint }}>{copy.more(more)}</Type> : null}
    </View>
  );
  if (!opens || fans.length === 0) return stack;
  return (
    <Pressable
      onPress={() => openBoughtBy(fans)}
      accessibilityRole="button"
      accessibilityLabel={copy.boughtBy.stack(names)}
      accessibilityHint={copy.boughtBy.hint}
      hitSlop={SLOP}
      android_ripple={ripple(c.track)}
      style={({ pressed }) => ({ opacity: pressedOpacity(pressed) })}
    >
      {stack}
    </Pressable>
  );
}
