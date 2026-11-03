/** The shape `dev/curate-demo.ts` writes into `releases.ts`. */
export type DemoReleases = {
  readonly readAt: string;
  readonly sources: readonly string[];
  /** Each a release page Raw Document's payload as the session stored it, with the moment it was read. */
  readonly pages: readonly { readonly fetchedAt: string; readonly payload: unknown }[];
};
