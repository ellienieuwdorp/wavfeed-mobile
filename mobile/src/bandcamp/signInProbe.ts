/**
 * When the sign-in sheet asks who is signed in (task 0036 decision 1, finding FLOW-5): once for each top-level page of
 * Bandcamp's that settles anywhere but /login and then holds still for `PROBE_SETTLE_MS`, so a redirect chain asks once
 * at its end. A page between the form and the signed-in landing, such as a password reset or a check by email, asks
 * and so does the landing after it; a second settle of the same page with no load between, as a title change sends, does not.
 */
const LOGIN_PAGE = /^https:\/\/([a-z0-9-]+\.)*bandcamp\.com\/login\/?([?#]|$)/i;

export const PROBE_SETTLE_MS = 600;

export function isLoginPage(url: string): boolean {
  return LOGIN_PAGE.test(url);
}

/** The WebView's top-level navigation state, the fields the gate reads. */
export type PageState = { readonly url: string; readonly loading: boolean };

export type ProbeGate = { readonly navigated: (state: PageState) => void; readonly cancel: () => void };

export function probeGate(probe: () => void, settleMs: number = PROBE_SETTLE_MS): ProbeGate {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let settled: string | null = null;
  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    navigated(state) {
      if (state.loading || isLoginPage(state.url)) {
        cancel();
        settled = null;
        return;
      }
      if (state.url === settled) return;
      cancel();
      settled = state.url;
      timer = setTimeout(() => {
        timer = null;
        probe();
      }, settleMs);
    },
    cancel,
  };
}
