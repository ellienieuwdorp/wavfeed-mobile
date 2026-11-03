/**
 * The website APK installs the next one: it downloads the APK into the cache with
 * expo-file-system, checks its MD5 against store-builds.json, and hands a content URI to Android's package installer
 * through expo-intent-launcher, which asks the tester to confirm and, the first time, to allow wavfeed to install apps.
 * The permission comes from `modules/apk-install-permission` in APK builds only. Its native bridge reads the installed
 * manifest; a binary without that declaration, the bridge or the intent launcher opens the browser.
 */
import { requireOptionalNativeModule } from 'expo';
import { cacheDirectory, createDownloadResumable, deleteAsync, getContentUriAsync, getInfoAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';

/** Android's FLAG_GRANT_READ_URI_PERMISSION, so the installer may read the file the content URI names. */
const GRANT_READ = 1;
const APK_TYPE = 'application/vnd.android.package-archive';

/** Whether this binary can install an APK itself. */
export const canInstall = () =>
  Platform.OS === 'android' &&
  requireOptionalNativeModule('ExpoIntentLauncher') !== null &&
  requireOptionalNativeModule<{ declaresInstallPackages: boolean }>('ExpoApkInstallPermission')?.declaresInstallPackages === true;

export type InstallResult = 'installing' | 'damaged' | 'failed';

/** Downloads `url`, reporting progress from 0 to 1, and starts the install once its MD5 is `md5`. */
export async function downloadAndInstall(url: string, md5: string, build: number, onProgress: (share: number) => void): Promise<InstallResult> {
  const target = `${cacheDirectory}wavfeed-${build}.apk`;
  try {
    const download = createDownloadResumable(url, target, {}, (p) => {
      if (p.totalBytesExpectedToWrite > 0) onProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
    });
    const done = await download.downloadAsync();
    if (!done || done.status !== 200) return 'failed';
    const info = await getInfoAsync(target, { md5: true });
    if (!info.exists || info.md5 !== md5) {
      await deleteAsync(target, { idempotent: true });
      return 'damaged';
    }
    const { startActivityAsync } = await import('expo-intent-launcher');
    await startActivityAsync('android.intent.action.VIEW', { data: await getContentUriAsync(target), flags: GRANT_READ, type: APK_TYPE });
    return 'installing';
  } catch {
    return 'failed';
  }
}
