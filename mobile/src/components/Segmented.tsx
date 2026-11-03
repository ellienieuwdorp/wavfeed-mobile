/**
 * A two- or three-way mode picker: on iOS the system segmented control, SwiftUI's segmented
 * Picker through @expo/ui; on Android a Material 3 Expressive connected button group drawn with our tokens as the
 * canvas's `.and-btngroup` draws it (raised segments in a border outline, 6dp inner corners, the chosen one round on
 * the accent), because @expo/ui's Compose layer has only the older segmented button. It fills its parent's width;
 * `a11y` names a shortened segment.
 */
import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { accessibilityLabel, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { Platform, Pressable, Text, View } from 'react-native';

import { useTokens } from '@/theme/tokens';

export type Segment<K extends string> = { key: K; label: string; a11y?: string };

type Props<K extends string> = { segments: Segment<K>[]; value: K; onChange: (key: K) => void };

const GROUP_HEIGHT = 40;
const INNER_RADIUS = 6;

function SystemSegmented<K extends string>({ segments, value, onChange }: Props<K>) {
  const { dark } = useTokens();
  return (
    <Host matchContents={{ vertical: true }} colorScheme={dark ? 'dark' : 'light'}>
      <Picker<K> selection={value} onSelectionChange={onChange} modifiers={[pickerStyle('segmented')]}>
        {segments.map((s) => (
          <SwiftText key={s.key} modifiers={s.a11y ? [tag(s.key), accessibilityLabel(s.a11y)] : [tag(s.key)]}>
            {s.label}
          </SwiftText>
        ))}
      </Picker>
    </Host>
  );
}

function ConnectedGroup<K extends string>({ segments, value, onChange }: Props<K>) {
  const { c } = useTokens();
  const last = segments.length - 1;
  const round = GROUP_HEIGHT / 2;
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 2 }}>
      {segments.map((s, n) => {
        const on = s.key === value;
        const start = on || n === 0 ? round : INNER_RADIUS;
        const end = on || n === last ? round : INNER_RADIUS;
        return (
          <Pressable
            key={s.key}
            onPress={() => onChange(s.key)}
            accessibilityRole="radio"
            accessibilityLabel={s.a11y}
            accessibilityState={{ checked: on }}
            android_ripple={{ color: c.track }}
            hitSlop={{ top: 4, bottom: 4 }}
            style={{
              flex: 1,
              height: GROUP_HEIGHT,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              backgroundColor: on ? c.accentText : c.raised,
              borderWidth: on ? 0 : 1,
              borderColor: c.border,
              borderTopLeftRadius: start,
              borderBottomLeftRadius: start,
              borderTopRightRadius: end,
              borderBottomRightRadius: end,
            }}
          >
            <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '500', color: on ? c.onAccent : c.ink }}>{s.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Segmented<K extends string>(props: Props<K>) {
  return Platform.OS === 'ios' ? <SystemSegmented {...props} /> : <ConnectedGroup {...props} />;
}
