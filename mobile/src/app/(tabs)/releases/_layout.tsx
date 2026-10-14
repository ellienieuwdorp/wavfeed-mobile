/** The releases tab's stack, for the native header and the filter button over its lists (see TabStack and Dock). */
import { TabStack } from '@/components/TabStack';
import { copy } from '@/copy';

const PUSHED = [{ name: 'upcoming', title: copy.upcoming.title }];

export default function Layout() {
  return <TabStack title={copy.views.releases} pushed={PUSHED} filter />;
}
