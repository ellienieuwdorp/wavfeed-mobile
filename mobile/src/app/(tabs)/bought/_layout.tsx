/** The bought tab's stack, for the native header (see TabStack). */
import { TabStack } from '@/components/TabStack';
import { copy } from '@/copy';

export default function Layout() {
  return <TabStack title={copy.views.bought} />;
}
