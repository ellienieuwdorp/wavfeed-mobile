/**
 * The Demo's Fan id (task 0043, decision 7), on its own so the Tally outbox and the pure ask rule can read it without
 * the Demo's Releases (task 0044, decisions 1 and 2). `demo.ts` re-exports it.
 */
export const DEMO_FAN_ID = 9_000_002;

export function isDemoFan(fanId: number | null | undefined): boolean {
  return fanId === DEMO_FAN_ID;
}
