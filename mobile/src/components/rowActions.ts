/**
 * The row menu's items as a screen reader's actions (the phone app review, VIS-9 and FLOW-13): VoiceOver's actions rotor
 * and TalkBack's actions menu list every item that would take a press, under its menu label, except play, which is the
 * control's own activation. RowMenu.tsx builds the items and hands these to the row and its art.
 */
export type RowAction = { readonly key: string; readonly label: string; readonly enabled: boolean; readonly run: () => void };

export type SpokenActions = {
  readonly accessibilityActions: { name: string; label: string }[];
  readonly onAccessibilityAction: (event: { readonly nativeEvent: { readonly actionName: string } }) => void;
};

export const PLAY_ACTION = 'play';

export function spokenActions(actions: readonly RowAction[]): SpokenActions {
  const offered = actions.filter((a) => a.enabled && a.key !== PLAY_ACTION);
  return {
    accessibilityActions: offered.map((a) => ({ name: a.key, label: a.label })),
    onAccessibilityAction: (event) => offered.find((a) => a.key === event.nativeEvent.actionName)?.run(),
  };
}
