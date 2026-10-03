/**
 * Adopts the UIScene life cycle (task 0052, decision 1): an app built with the iOS 27 SDK that does not is stopped by
 * UIKit at launch (`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`, iOS build 6). Expo 57 ships the
 * scene delegate, `EXExpoAppSceneDelegate`, but its template still starts React Native from the app delegate, so this
 * names the delegate in Info.plist and moves the start to it: the app delegate keeps creating the factory and offers
 * it through `ExpoReactNativeFactoryProvider`, and the scene delegate makes the window and starts React Native in it.
 * ponytail: a string edit of the template's AppDelegate.swift that fails the prebuild when the template changes; when
 * Expo's template adopts scenes itself, this plugin is deleted.
 */
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const CLASS = 'class AppDelegate: ExpoAppDelegate {';
const START = /\n#if os\(iOS\) \|\| os\(tvOS\)\n {4}window = UIWindow\(frame: UIScreen\.main\.bounds\)\n {4}factory\.startReactNative\(\n[^#]*\)\n#endif\n/;

function adoptScenes(contents) {
  if (contents.includes('ExpoReactNativeFactoryProvider')) return contents;
  if (!contents.includes(CLASS) || !START.test(contents)) {
    throw new Error('withSceneLifecycle: AppDelegate.swift is not the template this plugin edits (task 0052)');
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
    if (mod.modResults.language !== 'swift') throw new Error('withSceneLifecycle: AppDelegate is not Swift (task 0052)');
    mod.modResults.contents = adoptScenes(mod.modResults.contents);
    return mod;
  });
};
