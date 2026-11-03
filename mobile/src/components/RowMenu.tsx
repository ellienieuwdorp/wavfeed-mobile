/**
 * The long press on anything that draws a Release (Later, and the v2 client canvas, sections 6 and 7): Play, Add to or
 * Remove from your Bandcamp wishlist, Open on Bandcamp and Share. On iOS it is the action sheet; on Android a Material
 * dropdown menu anchored to the row, mounted only while open. The wishlist item runs the heart's own press (ADR-0016),
 * is named for the press the heart's drawn state would take, a travelling press included, and is greyed while
 * membership is not asked yet. Only an https address from the wire is opened or shared, and an open is counted as a
 * hand-off. The same items, with Bought by where the row draws who bought it, are the screen reader's actions on the
 * row and on its art (rowActions.ts, VIS-9 and FLOW-13): the render prop's second argument, and `useSpokenActions`
 * under it.
 */
import { Box, DropdownMenu, DropdownMenuItem, Host as ComposeHost, Text as ComposeText } from '@expo/ui/jetpack-compose';
import { fillMaxSize } from '@expo/ui/jetpack-compose/modifiers';
import { openURL } from 'expo-linking';
import { createContext, useContext, useState, type ReactElement, type ReactNode } from 'react';
import { ActionSheetIOS, Platform, Pressable, Share, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { copy } from '@/copy';
import type { FanRef } from '@/domain/views';
import { webUrl } from '@/lib/format';
import { useSharing } from '@/tally/Sharing';
import { useTokens } from '@/theme/tokens';
import type { WishlistTarget } from '@/wishlist/exchange';
import { useMembership, useWishlistPress } from '@/wishlist/state';

import { openBoughtBy } from './AvatarStack';
import { usePlay, type RowRelease } from './playable';
import { usePlayerActions } from './player/playerState';
import { PLAY_ACTION, spokenActions, type RowAction, type SpokenActions } from './rowActions';

const ios = Platform.OS === 'ios';
/** The row takes this for its `onLongPress`: it opens the menu. */
export type OpenMenu = () => void;

function useRowActions(release: RowRelease): readonly RowAction[] {
  const play = usePlay();
  const { isPlaying } = usePlayerActions();
  const { track } = useSharing();
  const membership = useMembership(release.itemType, release.itemId);
  const press = useWishlistPress('row_menu');
  const on = membership.known && membership.on;
  const url = webUrl(release.itemUrl);
  const key = { itemType: release.itemType, itemId: release.itemId };
  const target: WishlistTarget = { ...key, release: key };
  return [
    { key: PLAY_ACTION, label: copy.rowMenu.play, enabled: true, run: () => play(release) },
    {
      key: 'wishlist',
      label: on ? copy.rowMenu.remove : copy.rowMenu.add,
      enabled: membership.known,
      run: () => void press(target, on ? 'remove' : 'add'),
    },
    {
      key: 'open',
      label: copy.rowMenu.open,
     
      enabled: url !== null,
      run: () => {
        if (url === null) return;
        track({ name: 'release_opened_on_bandcamp', props: { surface: 'row_menu', was_playing: isPlaying() } });
        openURL(url).catch(() => undefined);
      },
    },
    {
      key: 'share',
      label: copy.rowMenu.share,
     
      enabled: url !== null,
      run: () => {
        if (url !== null) Share.share(ios ? { url } : { message: url, title: release.title }).catch(() => undefined);
      },
    },
  ];
}

function showSheet(title: string, actions: readonly RowAction[]) {
  const live = actions.filter((a) => a.enabled);
  ActionSheetIOS.showActionSheetWithOptions(
    { title, options: [...live.map((a) => a.label), copy.rowMenu.cancel], cancelButtonIndex: live.length },
    (index) => live[index]?.run(),
  );
}

function AnchoredMenu({ actions, children }: { actions: readonly RowAction[]; children: (open: OpenMenu) => ReactElement }) {
  const { c, dark } = useTokens();
  const [open, setOpen] = useState(false);
  return (
    <View>
      {children(() => setOpen(true))}
      {open ? (
        <ComposeHost pointerEvents="none" style={StyleSheet.absoluteFill} colorScheme={dark ? 'dark' : 'light'} seedColor={c.accent}>
          <DropdownMenu expanded onDismissRequest={() => setOpen(false)} color={c.surface}>
            <DropdownMenu.Trigger>
              <Box modifiers={[fillMaxSize()]} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Items>
              {actions.map((a) => (
                <DropdownMenuItem
                  key={a.key}
                  enabled={a.enabled}
                  elementColors={{ textColor: c.ink, disabledTextColor: c.faint }}
                  onClick={() => {
                    setOpen(false);
                    a.run();
                  }}
                >
                  <DropdownMenuItem.Text>
                    <ComposeText color={a.enabled ? c.ink : c.faint} style={{ fontSize: 16 }}>{a.label}</ComposeText>
                  </DropdownMenuItem.Text>
                </DropdownMenuItem>
              ))}
            </DropdownMenu.Items>
          </DropdownMenu>
        </ComposeHost>
      ) : null}
    </View>
  );
}

/**
 * The surface of a row that holds buttons of its own (a card, a quote), taking the long press between them and leaving
 * the screen reader its buttons. Its buttons pass `open` to their own `onLongPress`.
 */
export function RowSurface({ open, style, children }: { open: OpenMenu; style: StyleProp<ViewStyle>; children: ReactNode }) {
  return (
    <Pressable onLongPress={open} accessible={false} style={style}>
      {children}
    </Pressable>
  );
}

const SpokenContext = createContext<SpokenActions | undefined>(undefined);

/** The screen reader's actions of the RowMenu around it, for a control it does not draw itself (PlayArt). */
export function useSpokenActions(): SpokenActions | undefined {
  return useContext(SpokenContext);
}

type RowMenuProps = {
  release: RowRelease;
  /** The Fans the row's faces name, which a screen reader reaches as the Bought by action. */
  boughtBy?: readonly FanRef[];
  /** Draws the row, handing `open` to its own Pressable's `onLongPress` and `spoken` to its screen reader element. */
  children: (open: OpenMenu, spoken: SpokenActions) => ReactElement;
};

export function RowMenu({ release, boughtBy, children }: RowMenuProps) {
  const actions = useRowActions(release);
  const spoken = spokenActions(actions, boughtBy ?? [], openBoughtBy);
  const menu = ios
    ? children(() => showSheet(release.title, actions), spoken)
    : <AnchoredMenu actions={actions}>{(open) => children(open, spoken)}</AnchoredMenu>;
  return <SpokenContext.Provider value={spoken}>{menu}</SpokenContext.Provider>;
}
