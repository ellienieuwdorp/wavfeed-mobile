/**
 * Every user-visible string in the phone app that is not sample data. DESIGN-UI
 * section 8 governs them: middots between facts, no em dashes, "pages you
 * follow", and no system vocabulary beyond "updated N min ago".
 */
import { Platform } from 'react-native';

const ios = Platform.OS === 'ios';
const thisDevice = ios ? 'this iPhone' : 'this phone';

export const sep = ' · ';

export const copy = {
  views: {
    feed: 'Feed',
    releases: 'New releases',
    bought: 'Bought',
    settings: 'Settings',
  },
  updated: 'Updated 12 min ago',
  releases: {
    upcoming: 'Upcoming',
  },
  feed: {
    fromPages: 'New from pages you follow',
    boughtByFollowed: 'Bought by people you follow',
    ownWords: 'In their own words',
    viewMore: 'View more',
    quoteOn: ' on ',
    quoted: (q: string) => `\u201c${q}\u201d`,
  },
  bought: {
    byReleaseDate: 'By release date',
    byPurchased: 'By recently purchased',
    showAll: (n: number) => `Show all ${n}`,
  },
  more: (n: number) => `+${n}`,
  heart: {
    add: (title: string) => `Add ${title} to your Bandcamp wishlist`,
    remove: (title: string) => `Remove ${title} from your Bandcamp wishlist`,
  },
  settings: {
    bandcampLabel: 'Bandcamp: ',
    thisDeviceHead: ios ? 'Bandcamp on this iPhone' : 'Bandcamp on this phone',
    signedInAs: (name: string) => `Signed in as ${name}`,
    gatherNow: 'Gather now',
    signOut: ios ? 'Sign out of Bandcamp on this iPhone' : 'Sign out of Bandcamp on this phone',
    custody: `${ios ? 'This iPhone' : 'This phone'} gathers your feed with its own Bandcamp sign-in, kept on ${thisDevice}. wavfeed never receives it.`,
    devicesHead: 'Connected devices',
    thisDevice,
    disconnect: 'Disconnect',
    notificationsHead: 'Notifications',
    announces: 'When a page I follow announces a release',
    appearanceHead: 'Appearance',
    appearance: { light: 'Light', dark: 'Dark', system: 'System' },
    changePassword: 'Change password',
    logOut: 'Log out',
    deleteAccount: 'Delete my account',
    deleteAccountNote: 'Removes your account and everything gathered for it.',
  },
  connect: {
    title: 'Connect Bandcamp',
    lead: `Your feed is already here. To keep it fresh from ${thisDevice}, sign in to Bandcamp once.`,
    custody:
      "The sign-in stays on this phone and is used only to read your own feed and to add or remove wishlist items you press. wavfeed's server never receives it. Signing out of Bandcamp on this phone removes it.",
    signIn: 'Sign in to Bandcamp',
    notNow: 'Not now',
  },
  notice: {
    signedOut: `Bandcamp signed ${thisDevice} out, so nothing new is arriving from it.`,
    signInAgain: 'Sign in again',
    dismiss: 'Dismiss',
  },
  player: {
    open: (title: string) => `Open the player for ${title}`,
    play: 'Play',
    pause: 'Pause',
    previous: 'Previous track',
    next: 'Next track',
    buy: 'Buy on Bandcamp \u2197',
    buyLabel: 'Buy on Bandcamp',
    trackTitle: (n: number, title: string) => `${n}. ${title}`,
    openOnBandcamp: (title: string) => `Open ${title} on Bandcamp`,
  },
} as const;
