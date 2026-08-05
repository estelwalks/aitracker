const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

/**
 * Re-sign the whole .app ad-hoc after electron-builder unpacks it.
 *
 * The re-sign MUST preserve the hardened-runtime flag and re-apply the same
 * minimal entitlements as electron-builder:
 *   - `--options runtime` keeps `com.apple.security.cs.allow-jit` etc. active
 *     (a plain `--sign -` would drop the hardened-runtime flag and leave the
 *     signature inconsistent with the Info.plist declaration);
 *   - `--entitlements` re-applies build/entitlements.mac.plist — the minimal
 *     set (Chromium JIT only, no App Sandbox, no files.* directory grants).
 *
 * The app never requests TCC-protected directories; macOS only asks the user
 * at the moment they pick/drop a file inside 文稿/桌面/下载, which is the
 * OS-mandated behavior for any non-sandboxed app.
 */
// Electron 默认模板 Info.plist 自带、但本应用完全不使用的 TCC usage
// descriptions —— 删除,确保"仅声明必要权限"(应用不使用摄像头/麦克风/
// 蓝牙,也不请求任何目录权限)。
const UNUSED_USAGE_DESCRIPTIONS = [
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
  "NSCameraUsageDescription",
  "NSMicrophoneUsageDescription",
];

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  const entitlementsPath = join(
    context.packager.projectDir,
    "build",
    "entitlements.mac.plist",
  );

  const infoPlistPath = join(appPath, "Contents", "Info.plist");
  for (const key of UNUSED_USAGE_DESCRIPTIONS) {
    try {
      execFileSync("plutil", ["-remove", key, infoPlistPath], {
        stdio: "pipe",
      });
    } catch {
      // key already absent — fine
    }
  }
  execFileSync(
    "codesign",
    [
      "--force",
      "--options",
      "runtime",
      "--entitlements",
      entitlementsPath,
      "--deep",
      "--sign",
      "-",
      appPath,
    ],
    { stdio: "inherit" },
  );
};
