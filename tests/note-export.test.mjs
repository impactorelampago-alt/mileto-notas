import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { safeTxtBaseName, ensureTxtExtension } from '../src/lib/note-export.ts'

const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')
const preload = readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8')
const editor = readFileSync(new URL('../src/components/editor/Editor.tsx', import.meta.url), 'utf8')
const detailBar = readFileSync(new URL('../src/components/editor/NoteDetailBar.tsx', import.meta.url), 'utf8')

test('TXT export produces a safe Windows filename and always keeps the extension', () => {
  assert.equal(safeTxtBaseName('  Relatório: agosto?  '), 'Relatório agosto')
  assert.equal(safeTxtBaseName('CON'), 'Nota')
  assert.equal(safeTxtBaseName('...'), 'Nota')
  assert.equal(ensureTxtExtension('C:\\Temp\\Nota'), 'C:\\Temp\\Nota.txt')
  assert.equal(ensureTxtExtension('C:\\Temp\\Nota.TXT'), 'C:\\Temp\\Nota.TXT')
})

test('TXT export is mediated by the native save dialog and uses the live editor text', () => {
  assert.match(main, /ipcMain\.handle\('note:export-txt'/)
  assert.match(main, /dialog\.showSaveDialog/)
  assert.match(main, /writeFile\(ensureTxtExtension\(result\.filePath\), input\.content/)
  assert.match(preload, /ipcRenderer\.invoke\('note:export-txt', input\)/)
  assert.match(editor, /liveSession\.ytext\.toString\(\)/)
  assert.match(editor, /localContentRef\.current/)
  assert.match(detailBar, /Baixar \.txt/)
})
