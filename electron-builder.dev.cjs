const packageJson = require('./package.json')
const now = new Date()
const buildStamp = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes()]
  .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, '0'))
  .join('')
const devVersion = process.env.DSH_DESKTOP_BUILD_VERSION || `${packageJson.version}-dev.${buildStamp}`

module.exports = {
  ...packageJson.build,
  appId: 'io.dsh.desktop.dev',
  productName: 'DSH Desktop Dev',
  directories: {
    ...packageJson.build.directories,
    output: 'dist-dev'
  },
  extraMetadata: {
    name: 'dsh-desktop-dev',
    productName: 'DSH Desktop Dev',
    version: devVersion,
    dshDesktopChannel: 'development'
  },
  artifactName: 'dsh-desktop-dev-${os}-${arch}.${ext}',
  nsis: {
    ...packageJson.build.nsis,
    artifactName: 'dsh-desktop-dev-windows-${arch}-setup.${ext}'
  },
  publish: null
}
