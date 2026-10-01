/**
 * The long press on anything that draws a Release (task 0036, Later, and the v2 client canvas, sections 6 and 7): Play,
 * Add to or Remove from your Bandcamp wishlist, Open on Bandcamp and Share. On iOS it is the action sheet while
 * IOS_CONTEXT_MENU is off, else SwiftUI's context menu through @expo/ui, lifting the row it wraps, so the row is laid
 * out at the `width` it is given; on Android a Material dropdown menu anchored to the row, mounted only while open. The
 * wishlist item runs the heart's own press (ADR-0016) and is greyed whenever the heart would take no press. Only an
 * https address from the wire is opened or shared, and an open is counted as a hand-off (task 0038). The same items,
 * with Bought by where the row draws who bought it, are the screen reader's actions on the row and on its art
 * (rowActions.ts, VIS-9 and FLOW-13): the render prop's second argument, and `useSpokenActions` under it.
 */
import { Box, DropdownMenu, DropdownMenuItem, Host as ComposeHost, Text as ComposeText } from '@expo/ui/jetpack-compose';
import { fillMaxSize } from '@expo/ui/jetpack-compose/modifiers';
import { Button, ContextMenu, Host, RNHostView } from '@expo/ui/swift-ui';
import { disabled } from '@expo/ui/swift-ui/modifiers';
import { openURL } from 'expo-linking';
import { createContext, useContext, useState, type ReactElement, type ReactNode } from 'react';
import { ActionSheetIOS, Platform, Pressable, Share, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { copy } from '@/copy';
import type { ApiFanRef } from '@/domain/apiTypes';
import { webUrl } from '@/lib/format';
import { useSharing } from '@/tally/Sharing';
import { useTokens } from '@/theme/tokens';
import { useMembership, usePendingAction, useWishlistPress, type WishlistTarget } from '@/wishlist/state';

import { openBoughtBy } from './AvatarStack';
import { usePlay, type RowRelease } from './playable';
import { usePlayerActions } from './player/playerState';
import { PLAY_ACTION, spokenActions, type RowAction, type SpokenActions } from './rowActions';

const ios = Platform.OS === 'ios';
// ceiling: the device check of SwiftUI's menu around a hosted row failed in Expo Go 57.0.9 (task 0036). Its native
// RNHostView predates @expo/ui 57.0.14 (expo/expo#48969), so every touch on a hosted row reaches JS twice, in host and in
// page coordinates, and a hosted Pressable drops its press on any finger movement. False falls back to ActionSheetIOS;
// true again once the app runs on a native side carrying that fix, a dev build or a later Expo Go.
const IOS_CONTEXT_MENU = false;

type Action = RowAction & { icon: SFSymbol };

/** The row takes this for its `onLongPress`: it opens the menu, except under SwiftUI's, where it only keeps a held press from playing. */
export type OpenMenu = () => void;

const keepHeld: OpenMenu = () => undefined;

function useRowActions(release: RowRelease): readonly Action[] {
  const play = usePlay();
  const { isPlaying } = usePlayerActions();
  const { track } = useSharing();
  const membership = useMembership(release.itemType, release.itemId);
  const pending = usePendingAction(release.itemType, release.itemId);
  const press = useWishlistPress('row_menu');
  const wishlisted = membership.known && membership.wishlisted;
  const url = webUrl(release.itemUrl);
  const key = { itemType: release.itemType, itemId: release.itemId };
  const target: WishlistTarget = { ...key, release: key };
  return [
    { key: PLAY_ACTION, label: copy.rowMenu.play, icon: 'play', enabled: true, run: () => play(release) },
    {
      key: 'wishlist',
      label: wishlisted ? copy.rowMenu.remove : copy.rowMenu.add,
      icon: wishlisted ? 'heart.slash' : 'heart',
      enabled: membership.known && pending === null,
      run: () => press(target, wishlisted ? 'remove' : 'add'),
    },
    {
      key: 'open',
      label: copy.rowMenu.open,
      icon: 'safari',
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
      icon: 'square.and.arrow.up',
      enabled: url !== null,
      run: () => {
        if (url !== null) Share.share(ios ? { url } : { message: url, title: release.title }).catch(() => undefined);
      },
    },
  ];
}

function showSheet(title: string, actions: readonly Action[]) {
  const live = actions.filter((a) => a.enabled);
  ActionSheetIOS.showActionSheetWithOptions(
    { title, options: [...live.map((a) => a.label), copy.rowMenu.cancel], cancelButtonIndex: live.length },
    (index) => live[index]?.run(),
  );
}

function SystemMenu({ actions, width, child }: { actions: readonly Action[]; width: number; child: ReactElement }) {
  const { dark } = useTokens();
  return (
    <Host matchContents colorScheme={dark ? 'dark' : 'light'}>
      <ContextMenu>
        <ContextMenu.Items>
          {actions.map((a) => (
            <Button key={a.key} label={a.label} systemImage={a.icon} onPress={a.run} modifiers={a.enabled ? [] : [disabled(true)]} />
          ))}
        </ContextMenu.Items>
        <ContextMenu.Trigger>
          <RNHostView matchContents>
            <View style={{ width }}>{child}</View>
          </RNHostView>
        </ContextMenu.Trigger>
      </ContextMenu>
    </Host>
  );
}

function AnchoredMenu({ actions, children }: { actions: readonly Action[]; children: (open: OpenMenu) => ReactElement }) {
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
 * the screen reader its buttons. Where SwiftUI's menu owns the long press it is a plain View, since a Pressable above the
 * pressed one would take the responder on the second touch start of the doubled stream IOS_CONTEXT_MENU names and end
 * that press without its onPress (task 0036). Its buttons pass `open` to their own `onLongPress`.
 */
export function RowSurface({ open, style, children }: { open: OpenMenu; style: StyleProp<ViewStyle>; children: ReactNode }) {
  if (open === keepHeld) return <View style={style}>{children}</View>;
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
  width: number;
  /** The Fans the row's faces name, which a screen reader reaches as the Bought by action. */
  boughtBy?: readonly ApiFanRef[];
  /** Draws the row, handing `open` to its own Pressable's `onLongPress` and `spoken` to its screen reader element. */
  children: (open: OpenMenu, spoken: SpokenActions) => ReactElement;
};

export function RowMenu({ release, width, boughtBy, children }: RowMenuProps) {
  const actions = useRowActions(release);
  const fans = boughtBy ?? [];
  const spoken = spokenActions(fans.length === 0 ? actions : [...actions, { key: 'bought_by', label: copy.boughtBy.title, enabled: true, run: () => openBoughtBy(fans) }]);
  let menu: ReactElement;
  if (!ios) menu = <AnchoredMenu actions={actions}>{(open) => children(open, spoken)}</AnchoredMenu>;
  else if (!IOS_CONTEXT_MENU) menu = children(() => showSheet(release.title, actions), spoken);
  else menu = <SystemMenu actions={actions} width={width} child={children(keepHeld, spoken)} />;
  return <SpokenContext.Provider value={spoken}>{menu}</SpokenContext.Provider>;
}
