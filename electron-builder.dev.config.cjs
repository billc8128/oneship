module.exports = {
  appId: 'com.oneship.app.dev',
  productName: 'Oneship Dev',
  directories: {
    output: 'release-dev',
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
