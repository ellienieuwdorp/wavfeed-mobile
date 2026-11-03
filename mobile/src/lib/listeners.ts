/** A module's listeners for `useSyncExternalStore`: `subscribe` adds one and answers its removal, `notify` calls each. */
export type Listeners = { readonly subscribe: (listener: () => void) => () => void; readonly notify: () => void };

export function listeners(): Listeners {
  const held = new Set<() => void>();
  return {
    subscribe(listener) {
      held.add(listener);
      return () => {
        held.delete(listener);
      };
    },
    notify() {
      for (const listener of held) listener();
    },
  };
}
