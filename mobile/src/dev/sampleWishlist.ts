/**
 * The simulator rig's wishlist writes (ADR-0016 amendment 2026-10-02): under `SAMPLE_MODE` the session answers a
 * heart's add or remove as Bandcamp taking it, after `SAMPLE_WRITE_MS` and with no request at all (ADR-0001), so a
 * press can be filmed settling. `EXPO_PUBLIC_SAMPLE_WISHLIST=refuse` waits as long and then hands the writes back to
 * the session, which answers every request under `SAMPLE_MODE` as unreachable, so the flipped heart going back and its
 * notice can be filmed too.
 * `session.ts` requires this behind a literal `__DEV__`, so it stays out of every release bundle (review ARCH-5).
 */
import type { WishlistWriteOutcome } from '../bandcamp/wishlist';

const SAMPLE_WRITE_MS = 1200;
const REFUSE = process.env.EXPO_PUBLIC_SAMPLE_WISHLIST === 'refuse';

/** Bandcamp's yes after the wait, or null after it when the rig was started to refuse. */
export async function sampleWishlistWrite(): Promise<WishlistWriteOutcome | null> {
  await new Promise((resolve) => setTimeout(resolve, SAMPLE_WRITE_MS));
  if (REFUSE) return null;
  return {
    ok: true,
    alreadyThere: false,
    wire: { status: 200, requests: 1, answer: 'json', end: 'ok', said: null, redirected: false, crumb: 'cached', pages: 0, pageStatus: null },
    documents: [],
  };
}
