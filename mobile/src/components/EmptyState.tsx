/**
 * What a view with no rows says (DESIGN-UI section 9): the filling-in line while the first walk runs, the view's own
 * empty line otherwise, and one "Sign in to Bandcamp" button when this phone has never held a signed-in Fan.
 */
import { router } from 'expo-router';
import { Platform, Pressable, Text, View } from 'react-native';

import { copy } from '@/copy';
import { useGatherStatus } from '@/state/status';
import { useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';

export function EmptyState({ filling, nothing }: { filling: string; nothing: string }) {
  const { c, type } = useTokens();
  const { loaded, hasIdentity, catchingUp } = useGatherStatus();
  if (!loaded) return null;
  if (!hasIdentity) {
    return (
      <View style={{ paddingHorizontal: type.gutter, paddingTop: 24 }}>
        <Pressable
          onPress={() => router.push('/connect')}
          accessibilityRole="button"
          style={{ minHeight: ios ? 52 : 48, alignItems: 'center', justifyContent: 'center', borderRadius: ios ? 16 : 24, backgroundColor: c.accent }}
        >
          <Text style={{ fontSize: ios ? 17 : 15, fontWeight: ios ? '600' : '500', color: c.onAccent }}>{copy.empty.signIn}</Text>
        </Pressable>
      </View>
    );
  }
  return <Text style={{ fontSize: type.body, color: c.sub, paddingHorizontal: type.gutter, paddingTop: 16 }}>{catchingUp ? filling : nothing}</Text>;
}
