// Tauri backend for jigtor's File System Access seam.
//
// The web build (GitHub Pages) drives file IO through the browser's
// showOpenFilePicker / showDirectoryPicker + FileSystemHandle API — Chromium only.
// Tauri's native webview (WKWebView on macOS, WebKitGTK on Linux) lacks that API,
// so here we shim the SAME window.showOpenFilePicker / showDirectoryPicker and
// return handle objects with the SAME shape main.ts already programs against,
// backed by Rust fs commands (see src-tauri/src/lib.rs). This keeps main.ts and
// all of src/core/ identical across web and desktop — the only fork is this file.
//
// In a normal browser installTauriFileSystem() is a no-op, so the same bundle
// ships to both GitHub Pages and the Tauri app.
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

// Forward slashes are accepted as separators by std::fs on every platform,
// so a single join rule works for macOS, Linux, and Windows paths alike.
const joinPath = (base: string, name: string): string =>
  base.endsWith('/') || base.endsWith('\\') ? base + name : `${base}/${name}`

const basename = (path: string): string => path.split(/[/\\]/).pop() ?? path

const fsRead = (path: string) => invoke<number[]>('fs_read', { path })
const fsWrite = (path: string, contents: number[]) =>
  invoke<void>('fs_write', { path, contents })
const fsExists = (path: string) => invoke<boolean>('fs_exists', { path })
const fsMkdir = (path: string) => invoke<void>('fs_mkdir', { path })

async function toBytes(data: string | BufferSource | Blob): Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data)
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer())
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  const view = data as ArrayBufferView
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
}

// The frontend only ever writes once per handle (createWritable → write → close),
// so buffering chunks and flushing on close matches its usage exactly.
function makeFileHandle(path: string) {
  const name = basename(path)
  return {
    name,
    async getFile(): Promise<File> {
      const bytes = await fsRead(path)
      return new File([new Uint8Array(bytes)], name)
    },
    async createWritable() {
      const chunks: Uint8Array[] = []
      return {
        async write(data: string | BufferSource | Blob): Promise<void> {
          chunks.push(await toBytes(data))
        },
        async close(): Promise<void> {
          const total = chunks.reduce((n, c) => n + c.length, 0)
          const merged = new Uint8Array(total)
          let offset = 0
          for (const c of chunks) {
            merged.set(c, offset)
            offset += c.length
          }
          await fsWrite(path, Array.from(merged))
        },
      }
    },
    // No OS-level permission gate once the user has picked the path.
    async queryPermission(): Promise<PermissionState> {
      return 'granted'
    },
    async requestPermission(): Promise<PermissionState> {
      return 'granted'
    },
  }
}

// File handles are created lazily (write-on-close), matching FS Access semantics
// for `{ create: true }`; a missing file surfaces only when getFile() reads it.
// Directories, however, must exist: `{ create: true }` really mkdirs, and a
// missing directory without create throws so callers' try/catch can fall back.
function makeDirHandle(path: string) {
  return {
    name: basename(path),
    async getFileHandle(name: string) {
      return makeFileHandle(joinPath(path, name))
    },
    async getDirectoryHandle(name: string, options?: { create?: boolean }) {
      const full = joinPath(path, name)
      if (options?.create) await fsMkdir(full)
      else if (!(await fsExists(full)))
        throw new Error(`NotFoundError: ${full}`)
      return makeDirHandle(full)
    },
    async queryPermission(): Promise<PermissionState> {
      return 'granted'
    },
    async requestPermission(): Promise<PermissionState> {
      return 'granted'
    },
  }
}

// Installs the picker shims when running inside Tauri; inert in a browser.
// Must run before main.ts checks canUseFileSystemAccess() / wires the buttons.
export function installTauriFileSystem(): void {
  if (!isTauri()) return
  const w = window as Window & {
    showOpenFilePicker?: unknown
    showDirectoryPicker?: unknown
  }
  w.showOpenFilePicker = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    return typeof selected === 'string' ? [makeFileHandle(selected)] : []
  }
  w.showDirectoryPicker = async () => {
    const selected = await open({ directory: true })
    if (typeof selected !== 'string')
      throw new Error('directory selection cancelled')
    return makeDirHandle(selected)
  }
}
