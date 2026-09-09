import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = (path) => readFileSync(new URL(path, import.meta.url))
const readText = (path) => read(path).toString('utf8')
const sha256 = (content) => createHash('sha256').update(content).digest('hex').toUpperCase()

const logo = read('../public/logo.png')
const publicIcon = read('../public/icon.ico')
const buildIcon = read('../build/icon.ico')

test('the renderer uses the current Apolo Ops mark instead of the legacy lion', () => {
  assert.equal(
    sha256(logo),
    '48614A89CEEEAD3D4A55063807CB042B0383476102EFDB6BE136CEF5ABF11284',
  )
  assert.notEqual(
    sha256(logo),
    '57B5F65AE3B2558816A6E3C5E9D173B12AA24DEFD88D8143F07B449015E7C0D8',
  )

  for (const source of [
    readText('../src/App.tsx'),
    readText('../src/pages/Login.tsx'),
    readText('../src/components/layout/Titlebar.tsx'),
  ]) {
    assert.match(source, /\.\/logo\.png/)
  }
})

test('the executable, installer and public fallback share the renewed multi-size icon', () => {
  assert.deepEqual(publicIcon, buildIcon)
  assert.notEqual(
    sha256(buildIcon),
    'D6650C2380C3A4671B2E747C4D81CBBAC5EBEFE4EDF70628A094C9135E045802',
  )
  assert.equal(buildIcon.readUInt16LE(0), 0)
  assert.equal(buildIcon.readUInt16LE(2), 1)
  assert.equal(buildIcon.readUInt16LE(4), 7)

  const sizes = Array.from({ length: 7 }, (_, index) => {
    const encodedSize = buildIcon.readUInt8(6 + (index * 16))
    return encodedSize === 0 ? 256 : encodedSize
  })
  assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256])

  const builder = readText('../electron-builder.json5')
  const main = readText('../electron/main.ts')
  assert.match(builder, /icon:\s*["']build\/icon\.ico["']/)
  assert.match(main, /\.\.\/build\/icon\.ico/)
})
