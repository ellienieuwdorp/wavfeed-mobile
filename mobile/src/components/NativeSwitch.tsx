/**
 * The platform's on and off switch (task 0036 decision 5): UISwitch on iOS through React Native's Switch, and the
 * Material 3 switch on Android through @expo/ui's Compose Switch, tinted with the accent, its off state in the canvas's
 * border track, faint outline and faint thumb. The seed keeps the palette ours, never the wallpaper's (the v2 client
 * canvas, section 10, decision 3). The Compose switch takes no accessible name, so on Android it is hidden from TalkBack
 * and the list row it sits in is the switch, toggled by a tap anywhere on it as a Material list item is.
 */
import { Host, Switch as ComposeSwitch } from '@expo/ui/jetpack-compose';
import { Platform, Switch, View } from 'react-native';

import { useTokens } from '@/theme/tokens';

type Props = { value: boolean; onChange: (value: boolean) => void; label: string };

export function NativeSwitch({ value, onChange, label }: Props) {
  const { c, dark } = useTokens();
  if (Platform.OS === 'ios') return <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />;
  return (
    // Claiming the responder keeps a tap on the switch from also pressing the row around it.
    <View importantForAccessibility="no-hide-descendants" onStartShouldSetResponder={() => true}>
      <Host matchContents colorScheme={dark ? 'dark' : 'light'} seedColor={c.accent}>
        <ComposeSwitch
          value={value}
          onCheckedChange={onChange}
          colors={{
            checkedTrackColor: c.accent,
            checkedBorderColor: c.accent,
            checkedThumbColor: c.onAccent,
            uncheckedTrackColor: c.border,
            uncheckedBorderColor: c.faint,
            uncheckedThumbColor: c.faint,
          }}
        />
      </Host>
    </View>
  );
}
