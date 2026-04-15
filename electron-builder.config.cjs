// Single pack config for Oneship. Produces an unsigned (ad-hoc signed)
// Oneship.app that installs into /Applications/Oneship.app, replacing
// whatever is already there. No Apple Developer ID needed.
//
// There is no separate "dev" and "prod" pack — there is only one pack.
// If you ever want to publish Oneship through Gatekeeper with a real
// Developer ID signature + notarization, add a second config alongside
// this one, don't modify this file.

module.exports = {
  appId: 'com.oneship.app',
  productName: 'Oneship',
  directories: {
    output: 'release',
  },
  files: ['dist/**/*', 'node_modules/**/*'],
  mac: {
    category: 'public.app-category.developer-tools',
    target: 'dmg',
    icon: 'build/icon.icns',
    type: 'development',
    identity: null,
    hardenedRuntime: false,
    gatekeeperAssess: false,
    notarize: false,
  },
  forceCodeSigning: false,
  npmRebuild: true,
  nodeGypRebuild: false,
}
