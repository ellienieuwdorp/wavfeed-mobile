/**
 * The iOS tab bar's filter item needs a route of its own (task 0071, decision 5 and the Open 1 answer); its trigger is
 * disabled and hidden on Android, so nothing shows this. A link that reaches it anyway lands on New releases.
 */
import { Redirect } from 'expo-router';

export default function FilterToggle() {
  return <Redirect href="/releases" />;
}
