import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  installBusinessPackage,
  resolveActiveBusinessPackage,
  rollbackBusinessPackage,
  verifyInstallableBusinessPackage
} from '../src/main/business-package-manager'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function fixture(buildId: string, packageVersion: string, content: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-business-package-'))
  roots.push(root)
  await mkdir(join(root, 'source'), { recursive: true })
  await writeFile(join(root, 'source', 'package.json'), content)
  await writeFile(join(root, 'manifest.json'), JSON.stringify({
    type: 'dsh-business-plugin',
    schemaVersion: 2,
    pluginId: 'com.dataelement.demo-test',
    projectId: 'demo-test',
    displayName: '微业贷业务体验',
    capabilities: ['business-preview', 'mock-runtime', 'code-intell', 'scenario-editor'],
    buildId,
    packageVersion,
    compatibility: { desktop: { min: '0.1.0', maxExclusive: '0.2.0' } },
    integrity: {
      files: {
        'source/package.json': createHash('sha256').update(content).digest('hex')
      }
    }
  }))
  return root
}

describe('business package manager', () => {
  it('installs a verified package and resolves it as active', async () => {
    const source = await fixture('build-1', '0.1.0', '{"name":"one"}')
    const data = await mkdtemp(join(tmpdir(), 'dsh-business-data-'))
    roots.push(data)
    const installed = await installBusinessPackage(source, data, '0.1.1')

    expect(installed.buildId).toBe('build-1')
    expect(await resolveActiveBusinessPackage('/bundled', data, '0.1.1')).toBe(installed.packageRoot)
    const registry = JSON.parse(await readFile(join(data, 'plugins', 'registry.json'), 'utf8'))
    expect(registry.plugins[0]).toMatchObject({
      pluginId: 'com.dataelement.demo-test',
      projectId: 'demo-test',
      capabilities: ['business-preview', 'mock-runtime', 'code-intell', 'scenario-editor']
    })
  })

  it('rejects incompatible and tampered packages', async () => {
    const source = await fixture('build-1', '0.1.0', '{"name":"one"}')
    await expect(verifyInstallableBusinessPackage(source, '0.2.0')).rejects.toThrow('incompatible')
    await writeFile(join(source, 'source', 'package.json'), '{"name":"tampered"}')
    await expect(verifyInstallableBusinessPackage(source, '0.1.1')).rejects.toThrow('integrity check failed')
  })

  it('rejects unknown plugin capabilities before installation', async () => {
    const source = await fixture('build-1', '0.1.0', '{"name":"one"}')
    const manifestPath = join(source, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.capabilities.push('desktop-filesystem-unrestricted')
    await writeFile(manifestPath, JSON.stringify(manifest))

    await expect(verifyInstallableBusinessPackage(source, '0.1.1')).rejects.toThrow('unsupported capability')
  })

  it('keeps the previous package and rolls back atomically', async () => {
    const first = await fixture('build-1', '0.1.0', '{"name":"one"}')
    const second = await fixture('build-2', '0.1.1', '{"name":"two"}')
    const data = await mkdtemp(join(tmpdir(), 'dsh-business-data-'))
    roots.push(data)
    const installedFirst = await installBusinessPackage(first, data, '0.1.1')
    await installBusinessPackage(second, data, '0.1.1')

    expect(await rollbackBusinessPackage(data, '0.1.1')).toBe(installedFirst.packageRoot)
    const pointer = JSON.parse(await readFile(join(data, 'plugins', 'active.json'), 'utf8'))
    expect(pointer.activeBuildId).toBe('build-1')
    expect(pointer.previousBuildId).toBe('build-2')
  })

  it('falls back to the bundled package when the active pointer is corrupt', async () => {
    const data = await mkdtemp(join(tmpdir(), 'dsh-business-data-'))
    roots.push(data)
    await mkdir(join(data, 'plugins'), { recursive: true })
    await writeFile(join(data, 'plugins', 'active.json'), '{broken')
    expect(await resolveActiveBusinessPackage('/bundled', data, '0.1.1')).toBe('/bundled')
  })
})
