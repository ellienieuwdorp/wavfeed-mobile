/**
 * Where the phone stands with Bandcamp, read off what the app already holds: the Fan, and the gather state's paused
 * reason. Signing out from Settings keeps the Fan and pauses as `not_connected` (gather.ts), and a probe Bandcamp
 * answered logged out pauses as `logged_out`, so a held Fan alone does not mean signed in. Settings draws its status
 * from this, and a heart press refuses up front on anything but `connected` (ADR-0016 amendment 2026-10-02).
 */
import { isDemoFan } from '@/demo/fan';
import type { PausedReason } from '@/fetcher/sink';

export type Standing = 'connected' | 'signedOut' | 'notConnected' | 'demo';

export function standingOf(identity: { readonly fanId: number } | null, pausedReason: PausedReason | null): Standing {
  if (isDemoFan(identity?.fanId)) return 'demo';
  if (identity === null || pausedReason === 'not_connected') return 'notConnected';
  return pausedReason === 'logged_out' ? 'signedOut' : 'connected';
}
