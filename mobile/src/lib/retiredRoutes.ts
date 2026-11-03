/**
 * Links to a route that has gone, rewritten to where its content lives now before expo-router reads them. Bought's tab
 * and its Upcoming list left the app when New releases took Bought in, so `/bought` and `/bought/upcoming` open New
 * releases. The path may arrive whole (`exp://host:8082/--/bought`, `wavfeed://bought`) or as a bare path.
 */
const PREFIX = /^(.*?\/--\/|[a-z][a-z0-9+.-]*:\/\/)?(.*)$/is;
const RETIRED = /^(\/?)bought(?:\/upcoming)?\/?(?=[?#]|$)/;

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  const [, prefix = '', rest = ''] = PREFIX.exec(path) ?? [];
  return prefix + rest.replace(RETIRED, '$1releases');
}
