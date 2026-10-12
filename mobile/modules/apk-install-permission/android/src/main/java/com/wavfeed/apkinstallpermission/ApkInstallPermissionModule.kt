package com.wavfeed.apkinstallpermission

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The installed manifest declares the capability (task 0069), before Android asks the tester to allow this source.
class ApkInstallPermissionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoApkInstallPermission")

    Constant("declaresInstallPackages") {
      val context = appContext.reactContext ?: return@Constant false
      try {
        val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          context.packageManager.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong()))
        } else {
          @Suppress("DEPRECATION")
          context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
        }
        info.requestedPermissions?.contains(Manifest.permission.REQUEST_INSTALL_PACKAGES) == true
      } catch (_: PackageManager.NameNotFoundException) {
        false
      }
    }
  }
}
