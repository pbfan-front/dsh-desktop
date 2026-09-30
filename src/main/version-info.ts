import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface PackageMetadata {
  version?: unknown
  dshDesktopChannel?: unknown
  dependencies?: Record<string, unknown>
}

function readPackageMetadata(path: string): PackageMetadata | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PackageMetadata
  } catch {
    return undefined
  }
}

function validVersion(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

export function bundledHarnessVersion(appPath: string): string | undefined {
  const installedMetadata = readPackageMetadata(
    join(appPath, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  )
  const installedVersion = validVersion(installedMetadata?.version)
  if (installedVersion) return installedVersion

  const appMetadata = readPackageMetadata(join(appPath, 'package.json'))
  return validVersion(appMetadata?.dependencies?.['@deepseek-ai/dsh'])
}

export function desktopReleaseChannel(appPath: string, packaged: boolean): 'development' | 'production' {
  if (!packaged) return 'development'
  const metadata = readPackageMetadata(join(appPath, 'package.json'))
  return metadata?.dshDesktopChannel === 'development' ? 'development' : 'production'
}

export function bundledBusinessBuildId(resourcesPath: string): string | undefined {
  const metadata = readPackageMetadata(join(resourcesPath, 'business-package', 'manifest.json')) as
    | (PackageMetadata & { buildId?: unknown })
    | undefined
  return validVersion(metadata?.buildId)
}

export function aboutDetail(
  desktopVersion: string,
  harnessVersion: string | undefined,
  locale: 'en' | 'zh',
  release?: { channel: string; platform: string; businessBuildId?: string; businessPackageVersion?: string }
): string {
  const harness = harnessVersion ?? (locale === 'zh' ? '未知' : 'Unknown')
  const build = release?.businessBuildId ?? (locale === 'zh' ? '未知' : 'Unknown')
  if (locale === 'zh') {
    return `DSH Desktop 版本：${desktopVersion}\n发布通道：${release?.channel ?? 'production'}\n运行平台：${release?.platform ?? process.platform}\n业务包版本：${release?.businessPackageVersion ?? '未知'}\n业务 Build ID：${build}\n内置 Harness 版本：${harness}\n\nHarness 随 DSH Desktop 更新。`
  }
  return `DSH Desktop version: ${desktopVersion}\nRelease channel: ${release?.channel ?? 'production'}\nPlatform: ${release?.platform ?? process.platform}\nBusiness package version: ${release?.businessPackageVersion ?? 'Unknown'}\nBusiness Build ID: ${build}\nBundled Harness version: ${harness}\n\nHarness is updated with DSH Desktop.`
}
