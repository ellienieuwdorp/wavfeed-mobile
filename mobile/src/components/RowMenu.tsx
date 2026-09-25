/**
 * The long press on anything that draws a Release (task 0036, Later, and the v2 client canvas, sections 6 and 7): Play,
 * Add to or Remove from your Bandcamp wishlist, Open on Bandcamp and Share. On iOS it is SwiftUI's context menu through @expo/ui, lifting the
 * row it wraps, so the row is laid out at the `width` it is given; on Android a Material dropdown menu anchored to the
 * row, mounted only while open. The wishlist item runs the heart's own press (ADR-0016) and is greyed whenever the
 * heart would take no press. Only an https address from the wire is opened or shared.
 */
import { Box, DropdownMenu, DropdownMenuItem, Host as ComposeHost, Text as ComposeText } from '@expo/ui/jetpack-compose';
import { fillMaxSize } from '@expo/ui/jetpack-compose/modifiers';
import { Button, ContextMenu, Host, RNHostView } from '@expo/ui/swift-ui';
import { disabled } from '@expo/ui/swift-ui/modifiers';
import { openURL } from 'expo-linking';
import { useState, type ReactElement } from 'react';
import { ActionSheetIOS, Platform, Share, StyleSheet, View } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { copy } from '@/copy';
import { webUrl } from '@/lib/format';
import { useTokens } from '@/theme/tokens';
import { useMembership, usePendingAction, useWishlistPress, type WishlistTarget } from '@/wishlist/state';

import { usePlay, type RowRelease } from './playable';

const ios = Platform.OS === 'ios';
/** True until the device check of SwiftUI's menu around a hosted row; false falls back to ActionSheetIOS (task 0036). */
const IOS_CONTEXT_MENU = true;

type Action = { key: string; label: string; icon: SFSymbol; enabled: boolean; run: () => void };

/** The row takes this for its `onLongPress`: Android opens the menu, iOS only keeps a held press from playing. */
export type OpenMenu = () => void;

const keepHeld: OpenMenu = () => undefined;

function useRowActions(release: RowRelease): readonly Action[] {
  const play = usePlay();
  const membership = useMembership(release.itemType, release.itemId);
  const pending = usePendingAction(release.itemType, release.itemId);
  const press = useWishlistPress();
  const wishlisted = membership.known && membership.wishlisted;
  const url = webUrl(release.itemUrl);
  const key = { itemType: release.itemType, itemId: release.itemId };
  const target: WishlistTarget = { ...key, release: key };
  return [
    { key: 'play', label: copy.rowMenu.play, icon: 'play', enabled: true, run: () => play(release) },
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
        if (url !== null) openURL(url).catch(() => undefined);
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

/** `children` draws the row, handing `onLongPress` to its own Pressable. */
export function RowMenu({ release, width, children }: { release: RowRelease; width: number; children: (open: OpenMenu) => ReactElement }) {
  const actions = useRowActions(release);
  if (!ios) return <AnchoredMenu actions={actions}>{children}</AnchoredMenu>;
  if (!IOS_CONTEXT_MENU) return children(() => showSheet(release.title, actions));
  return <SystemMenu actions={actions} width={width} child={children(keepHeld)} />;
}
