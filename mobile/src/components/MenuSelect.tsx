/**
 * One control that picks a number from a short list, reading the chosen option (DESIGN-UI section 3's select, Bought's
 * threshold today): on iOS SwiftUI's menu Picker, the tinted value with its chevron opening the system pull-down with a
 * checkmark; on Android a Material dropdown chip opening the Compose DropdownMenu on a palette seeded from the accent,
 * never the wallpaper's, with the chosen option in accent and checked (the v2 client canvas, section 7).
 * Greyed, not removed, while `enabled` is false.
 */
import { DropdownMenu, DropdownMenuItem, Host as ComposeHost, RNHostView, Text as ComposeText } from '@expo/ui/jetpack-compose';
import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { accessibilityLabel, disabled, pickerStyle, tag, tint } from '@expo/ui/swift-ui/modifiers';
import { useState } from 'react';
import { Platform, Pressable, Text } from 'react-native';

import { Glyph } from '@/components/Glyph';
import { copy } from '@/copy';
import { ripple, useTokens } from '@/theme/tokens';

export type MenuOption = { value: number; label: string };

type Props = { options: readonly MenuOption[]; value: number; onChange: (value: number) => void; enabled: boolean; label: string };

const DISABLED_OPACITY = 0.38;

function SystemMenu({ options, value, onChange, enabled, label }: Props) {
  const { c, dark } = useTokens();
  return (
    <Host matchContents colorScheme={dark ? 'dark' : 'light'}>
      <Picker<number>
        selection={value}
        onSelectionChange={onChange}
        modifiers={[pickerStyle('menu'), tint(c.accent), disabled(!enabled), accessibilityLabel(label)]}
      >
        {options.map((o) => (
          <SwiftText key={o.value} modifiers={[tag(o.value)]}>
            {o.label}
          </SwiftText>
        ))}
      </Picker>
    </Host>
  );
}

function DropdownChip({ options, value, onChange, enabled, label }: Props) {
  const { c, dark } = useTokens();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.label ?? '';
  const chip = (
    <Pressable
      onPress={enabled ? () => setOpen(true) : undefined}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={copy.menu.labelled(label, current)}
      accessibilityState={{ disabled: !enabled, expanded: open }}
      android_ripple={ripple(c.track)}
      hitSlop={{ top: 8, bottom: 8 }}
      style={{ height: 32, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 8, borderRadius: 8, borderWidth: 1, borderColor: c.border, overflow: 'hidden', opacity: enabled ? 1 : DISABLED_OPACITY }}
    >
      <Text numberOfLines={1} style={{ fontSize: 14, lineHeight: 20, fontWeight: '500', color: c.ink }}>{current}</Text>
      <Glyph name="dropDown" size={18} colour={c.sub} />
    </Pressable>
  );
  return (
    <ComposeHost matchContents colorScheme={dark ? 'dark' : 'light'} seedColor={c.accent}>
      <DropdownMenu expanded={open && enabled} onDismissRequest={() => setOpen(false)} color={c.surface}>
        <DropdownMenu.Trigger>
          <RNHostView matchContents>{chip}</RNHostView>
        </DropdownMenu.Trigger>
        <DropdownMenu.Items>
          {options.map((o) => {
            const on = o.value === value;
            return (
              <DropdownMenuItem
                key={o.value}
                elementColors={{ textColor: on ? c.accent : c.ink, trailingIconColor: c.accent }}
                onClick={() => {
                  setOpen(false);
                  if (!on) onChange(o.value);
                }}
              >
                <DropdownMenuItem.Text>
                  <ComposeText color={on ? c.accent : c.ink} style={{ fontSize: 16, fontWeight: on ? '500' : 'normal' }}>{o.label}</ComposeText>
                </DropdownMenuItem.Text>
                {on ? (
                  <DropdownMenuItem.TrailingIcon>
                    <ComposeText color={c.accent}>{copy.menu.checked}</ComposeText>
                  </DropdownMenuItem.TrailingIcon>
                ) : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenu.Items>
      </DropdownMenu>
    </ComposeHost>
  );
}

export function MenuSelect(props: Props) {
  return Platform.OS === 'ios' ? <SystemMenu {...props} /> : <DropdownChip {...props} />;
}
