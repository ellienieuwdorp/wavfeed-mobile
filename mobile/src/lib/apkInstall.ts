/**
 * The patched old builds' stand-in for the APK installer (task 0065, decision 6): their binaries carry neither
 * expo-intent-launcher nor the install permission, so the banner opens the APK's download in the browser instead.
 */
export const canInstall = () => false;

export type InstallResult = 'installing' | 'damaged' | 'failed';

export async function downloadAndInstall(_url: string, _md5: string, _build: number, _onProgress: (share: number) => void): Promise<InstallResult> {
  return 'failed';
}
