/**
 * Reading a stored release page for the tracklist and the heart's `band_id`, which outlive a Projection rebuild (ADR-0004).
 */
import { asRecord } from './wire';

export function storedTralbum(payload: unknown): unknown {
  return asRecord(payload)?.tralbum;
}

/** `current.band_id`, not `selling_band_id`: the one a wishlist write names (ADR-0016). */
export function storedBandId(payload: unknown): number | null {
  const bandId = asRecord(asRecord(storedTralbum(payload))?.current)?.band_id;
  return typeof bandId === 'number' && Number.isSafeInteger(bandId) ? bandId : null;
}
