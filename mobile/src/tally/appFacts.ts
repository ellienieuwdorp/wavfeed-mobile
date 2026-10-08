/**
 * What this copy of the app is (task 0038): its version, native build, the EAS Update it runs, the platform and the EAS
 * channel it was built for (task 0065 decision 7), read once at launch. The sharing provider builds each batch's `ctx` from it, and a feedback or failure mail names it.
 */
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

import type { FeedbackFacts } from '@/copy';

import type { AppFacts } from './tally';

export const APP: AppFacts = {
  version: Application.nativeApplicationVersion,
  build: Application.nativeBuildVersion,
  embedded: Updates.isEmbeddedLaunch,
  updateId: Updates.updateId,
  platform: Platform.OS === 'ios' ? 'ios' : 'android',
  osVersion: Platform.Version,
  channel: Updates.channel,
};

/** The version, build and OS a mail names; Android's OS is its release, not the API level the ctx carries. */
export function feedbackFacts(code: string | null): FeedbackFacts {
  const release = Platform.OS === 'android' ? String(Platform.constants.Release) : String(Platform.Version);
  const os = `${Platform.OS === 'ios' ? 'iOS' : 'Android'} ${Number.parseInt(release, 10) || release}`;
  return { version: APP.version ?? '?', build: APP.build ?? '?', os, code };
}
