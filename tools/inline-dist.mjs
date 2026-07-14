import { readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const distDir = join(root, 'dist')
const indexPath = join(distDir, 'index.html')

const readDistAsset = (assetPath) => readFile(join(distDir, assetPath), 'utf8')

async function replaceAsync(input, pattern, replacer) {
  let output = ''
  let cursor = 0
  for (const match of input.matchAll(pattern)) {
    output += input.slice(cursor, match.index)
    output += await replacer(match)
    cursor = match.index + match[0].length
  }
  return output + input.slice(cursor)
}

let html = await readFile(indexPath, 'utf8')

html = await replaceAsync(
  html,
  /<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/g,
  async (match) => {
    const js = await readDistAsset(match[1])
    return `<script type="module">\n${js}\n</script>`
  },
)

html = await replaceAsync(
  html,
  /<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/g,
  async (match) => {
    const css = await readDistAsset(match[1])
    return `<style>\n${css}\n</style>`
  },
)

if (html.includes('src="./assets/') || html.includes('href="./assets/')) {
  throw new Error('dist/index.html still references external assets')
}

await writeFile(indexPath, html)
await rm(join(distDir, 'assets'), { recursive: true, force: true })
