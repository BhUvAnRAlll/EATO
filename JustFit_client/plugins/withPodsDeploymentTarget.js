// Xcode 27 refuses a native library (a CocoaPods target) whose minimum iOS version is below 15:
// some of ours still say 9.0 to 13.4 (the date picker, webview, safe area, Reanimated, Worklets,
// masked view), so the build stopped (2026-11-09). This plugin adds a step to the Podfile's
// post_install that lifts any lower minimum to the app's own, so `ios/` is never edited by hand.
const { withPodfile } = require("expo/config-plugins");

const MARK = "# justFit: pods' minimum iOS version";

module.exports = function withPodsDeploymentTarget(config) {
  return withPodfile(config, (podfile) => {
    if (podfile.modResults.contents.includes(MARK)) return podfile;
    const anchor = "  post_install do |installer|\n";
    if (!podfile.modResults.contents.includes(anchor)) throw new Error("withPodsDeploymentTarget: the Podfile has no post_install block");
    podfile.modResults.contents = podfile.modResults.contents.replace(
      anchor,
      `${anchor}    ${MARK}
    app_minimum = podfile_properties['ios.deploymentTarget'] || '16.4'
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build|
        current = build.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        build.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = app_minimum if current && current.to_f < app_minimum.to_f
      end
    end
`,
    );
    return podfile;
  });
};
