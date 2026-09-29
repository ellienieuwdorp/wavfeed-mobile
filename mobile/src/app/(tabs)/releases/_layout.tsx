/** The releases tab's stack, for the native header (see TabStack). */
import { TabStack } from '@/components/TabStack';
import { copy } from '@/copy';

const PUSHED = [{ name: 'upcoming', title: copy.upcoming.title }];

export default function Layout() {
  return <TabStack title={copy.views.releases} pushed={PUSHED} />;
}
