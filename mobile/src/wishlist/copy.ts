/** The heart's words (DESIGN-UI sections 8 and 12, ADR-0016), from the web's wishlistCopy.ts, until `src/copy.ts` takes them. */
import { Platform } from 'react-native';

const thisDevice = Platform.OS === 'ios' ? 'this iPhone' : 'this phone';

export const wishlistCopy = {
  action: (title: string, wishlisted: boolean) =>
    wishlisted ? `Remove ${title} from your Bandcamp wishlist` : `Add ${title} to your Bandcamp wishlist`,
  pending: (title: string, action: 'add' | 'remove') =>
    action === 'remove' ? `Removing ${title} from your wishlist` : `Adding ${title} to your wishlist`,
  unknown: (title: string) => `Checking your wishlist for ${title}`,
  notice: {
    loggedOut: `Bandcamp no longer accepts the sign-in on ${thisDevice}, so that didn't reach your wishlist.`,
    notSignedIn: `Bandcamp isn't signed in on ${thisDevice}, so that didn't reach your wishlist.`,
    unreachable: "Bandcamp didn't answer. That didn't reach your wishlist, try again in a bit.",
    rejected: 'Bandcamp turned that one down. Open the release on Bandcamp to wishlist it there.',
    /** Bandcamp's own reason, the words its site would show in its error note. */
    rejectedSaying: (reason: string) => `Bandcamp turned that one down: ${reason}`,
    other: "That didn't reach your wishlist. Try again in a bit.",
    signIn: 'Sign in',
  },
} as const;
