/**
 * Adopts the UIScene life cycle: an app built with the iOS 27 SDK that does not is stopped by
 * UIKit at launch (`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`, iOS build 6). Expo 57 ships the
 * scene delegate, `EXExpoAppSceneDelegate`, but its template still starts React Native from the app delegate, so this
 * names the delegate in Info.plist and moves the start to it: the app delegate keeps creating the factory and offers
 * it through `ExpoReactNativeFactoryProvider`, and the scene delegate makes the window and starts React Native in it.
 */
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const CLASS = 'class AppDelegate: ExpoAppDelegate {';
const START = /\n#if os\(iOS\) \|\| os\(tvOS\)\n {4}window = UIWindow\(frame: UIScreen\.main\.bounds\)\n {4}factory\.startReactNative\(\n[^#]*\)\n#endif\n/;

function adoptScenes(contents) {
  if (contents.includes('ExpoReactNativeFactoryProvider')) return contents;
  if (!contents.includes(CLASS) || !START.test(contents)) {
    throw new Error('withSceneLifecycle: AppDelegate.swift is not the template this plugin edits');
  }
  return contents.replace(CLASS, 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {').replace(START, '');
}

module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'EXExpoAppSceneDelegate' },
        ],
      },
    };
    return mod;
  });
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== 'swift') throw new Error('withSceneLifecycle: AppDelegate is not Swift');
    mod.modResults.contents = adoptScenes(mod.modResults.contents);
    return mod;
  });
};
