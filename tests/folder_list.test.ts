import { expect, test } from 'claude-code/testing'

import {
  RECENT_FOLDER_LIMIT,
  displayWidth,
  findFolder,
  folderOptionLabel,
  isPickableFolder,
  normalizeFolder,
  placeFolderFirst,
  rankSessionFolders,
  readFolderList,
  readSessionRecordFolder,
} from '../hooks/folder_list'

test('folders are written with backslashes, no trailing separator and an upper-case drive', async () => {
  expect(normalizeFolder('e:/Projects/Alpha/')).toBe('E:\\Projects\\Alpha')
  expect(normalizeFolder('  E:\\Projects\\Alpha\\\\ ')).toBe('E:\\Projects\\Alpha')
  expect(normalizeFolder('d:\\')).toBe('D:\\')
})

test('a used folder moves to the front once, whatever its case', async () => {
  const folders = ['E:\\Alpha', 'E:\\Beta', 'E:\\Gamma']
  expect(placeFolderFirst(folders, 'e:\\beta\\')).toEqual(['E:\\beta', 'E:\\Alpha', 'E:\\Gamma'])
})

test('the list keeps the 100 most recent folders', async () => {
  const folders = Array.from({ length: RECENT_FOLDER_LIMIT }, (_unused, index) => `E:\\Folder${index}`)
  const updated = placeFolderFirst(folders, 'E:\\Newest')
  expect(updated.length).toBe(RECENT_FOLDER_LIMIT)
  expect(updated[0]).toBe('E:\\Newest')
  expect(updated).not.toContain(`E:\\Folder${RECENT_FOLDER_LIMIT - 1}`)
})

test('scratch workspaces and session worktrees are not recorded', async () => {
  const scratchRoot = 'C:\\Users\\Someone\\AppData\\Roaming\\Claude\\scratch-workspaces'
  expect(isPickableFolder(`${scratchRoot}\\abc\\def`, scratchRoot)).toBe(false)
  expect(isPickableFolder('E:\\Project\\.claude\\worktrees\\fix-bug', scratchRoot)).toBe(false)
  expect(isPickableFolder('E:\\Project', scratchRoot)).toBe(true)
  expect(isPickableFolder('', scratchRoot)).toBe(false)
})

test('a stored value that is not a list of paths reads as empty or filtered', async () => {
  expect(readFolderList(undefined)).toEqual([])
  expect(readFolderList({ folders: [] })).toEqual([])
  expect(readFolderList(['E:\\Alpha', 3, null, 'E:\\alpha'])).toEqual(['E:\\Alpha'])
})

test('desktop session records rank their folders by the newest activity', async () => {
  const records = [
    readSessionRecordFolder(JSON.stringify({ originCwd: 'E:\\Alpha', lastActivityAt: 10 }), 0),
    readSessionRecordFolder(JSON.stringify({ cwd: 'E:\\Beta', createdAt: 30 }), 0),
    readSessionRecordFolder(JSON.stringify({ originCwd: 'e:\\alpha', lastActivityAt: 50 }), 0),
    readSessionRecordFolder(JSON.stringify({ cwd: 'E:\\Scratch', isScratchWorkspace: true }), 0),
    readSessionRecordFolder('not json', 0),
  ]
  expect(records[3]).toBe(null)
  expect(records[4]).toBe(null)
  const ranked = rankSessionFolders(records.filter(record => record !== null))
  expect(ranked).toEqual(['E:\\alpha', 'E:\\Beta'])
})

test('an option reads the folder name alone', async () => {
  expect(folderOptionLabel('E:\\Projects\\Shared_Library', 60)).toBe('Shared_Library')
  expect(folderOptionLabel('E:\\Archive\\Clients\\Excel Plugin\\Installer_Files', 60)).toBe('Installer_Files')
  expect(folderOptionLabel('E:\\Alpha', 60)).toBe('Alpha')
  expect(folderOptionLabel('E:\\', 60)).toBe('E:')
})

test('a long name keeps its end behind an ellipsis, wide characters counting two columns', async () => {
  const label = folderOptionLabel('E:\\Notes\\A_Very_Long_Project_Folder_Name', 20)
  expect(label.startsWith('\u2026')).toBe(true)
  expect(label.endsWith('Folder_Name')).toBe(true)
  expect(displayWidth(label)).toBeLessThanOrEqual(20)
  const wide = folderOptionLabel('E:\\笔记\\讲座\\实验记录\\二零二六年九月的实验记录', 12)
  expect(wide.startsWith('\u2026')).toBe(true)
  expect(displayWidth(wide)).toBeLessThanOrEqual(12)
})

test('a typed name finds the closest recent folder', async () => {
  const folders = ['E:\\Projects\\Shared_Library_Old', 'E:\\Projects\\Shared_Library', 'E:\\Notes\\Writing-Notes']
  expect(findFolder(folders, 'shared_library')).toBe('E:\\Projects\\Shared_Library')
  expect(findFolder(folders, 'writ')).toBe('E:\\Notes\\Writing-Notes')
  expect(findFolder(folders, 'notes')).toBe('E:\\Notes\\Writing-Notes')
  expect(findFolder(folders, 'missing')).toBe(undefined)
  expect(findFolder(folders, '  ')).toBe(undefined)
})
