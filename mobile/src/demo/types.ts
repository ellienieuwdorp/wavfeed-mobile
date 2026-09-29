/** The shape `dev/curate-demo.ts` writes into `releases.ts` (task 0043, decision 4). */
export type DemoReleases = {
  readonly readAt: string;
  readonly sources: readonly string[];
  /** Each a release page Raw Document's payload as the session stored it, with the moment it was read. */
  readonly pages: readonly { readonly fetchedAt: string; readonly payload: unknown }[];
};
