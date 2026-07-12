#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const specsFlag = args.indexOf('--specs');
const SPECS_DIR = resolve(specsFlag >= 0 ? args.splice(specsFlag, 2)[1] : 'specs');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const root = {};
  const stack = [{ indent: 0, container: root }];
  let pending = null;

  for (const rawLine of lines) {
    if (rawLine.trim() === '' || rawLine.trim().startsWith('#')) continue;
    const indent = rawLine.match(/^ */)[0].length;
    const body = rawLine.slice(indent);

    if (pending && indent > pending.parentIndent) {
      const obj = body.startsWith('- ') ? [] : {};
      pending.parent[pending.key] = obj;
      stack.push({ indent, container: obj });
    }
    pending = null;

    while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop();
    const frame = stack[stack.length - 1];

    if (body.startsWith('- ')) {
      const value = body.slice(2).trim();
      if (Array.isArray(frame.container)) frame.container.push(value);
      continue;
    }

    const kv = body.match(/^([^:]+):\s*(.*)$/);
    if (!kv) continue;
    if (Array.isArray(frame.container)) continue;
    const key = kv[1].trim();
    const value = kv[2].trim();

    if (value === '') {
      pending = { parent: frame.container, key, parentIndent: indent };
    } else if (value === '[]') {
      frame.container[key] = [];
    } else {
      const inline = value.match(/^\[(.*)\]$/);
      if (inline) {
        frame.container[key] = inline[1].split(',').map((s) => s.trim()).filter(Boolean);
      } else {
        frame.container[key] = value;
      }
    }
  }
  return root;
}

function loadGraph(dir) {
  const nodes = new Map();
  for (const file of walk(dir)) {
    const raw = readFileSync(file, 'utf8');
    const fm = parseFrontmatter(raw);
    if (!fm?.id) continue;
    const depsRaw = fm.coherence?.depends_on;
    const deps = Array.isArray(depsRaw) ? depsRaw : depsRaw ? [depsRaw] : [];
    nodes.set(fm.id, { id: fm.id, file, deps, meta: fm });
  }
  return nodes;
}

function validate(nodes) {
  const errors = [];
  for (const node of nodes.values()) {
    for (const dep of node.deps) {
      if (!nodes.has(dep)) errors.push(`missing dep: ${node.id} -> ${dep} (in ${node.file})`);
    }
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map([...nodes.keys()].map((k) => [k, WHITE]));
  const cycles = [];

  function dfs(id, path) {
    color.set(id, GRAY);
    const node = nodes.get(id);
    if (!node) return;
    for (const dep of node.deps) {
      const c = color.get(dep);
      if (c === GRAY) {
        const cut = path.indexOf(dep);
        cycles.push([...path.slice(cut), dep]);
      } else if (c === WHITE) {
        dfs(dep, [...path, dep]);
      }
    }
    color.set(id, BLACK);
  }

  for (const id of nodes.keys()) {
    if (color.get(id) === WHITE) dfs(id, [id]);
  }

  return { errors, cycles };
}

function topoSort(nodes) {
  const indeg = new Map();
  const reverse = new Map();
  for (const id of nodes.keys()) {
    indeg.set(id, 0);
    reverse.set(id, []);
  }
  for (const node of nodes.values()) {
    for (const dep of node.deps) {
      if (!nodes.has(dep)) continue;
      indeg.set(node.id, indeg.get(node.id) + 1);
      reverse.get(dep).push(node.id);
    }
  }
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([k]) => k).sort();
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const next of reverse.get(id).sort()) {
      indeg.set(next, indeg.get(next) - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  return order.length === nodes.size ? order : null;
}

function impactedBy(nodes, startId) {
  if (!nodes.has(startId)) return null;
  const reverse = new Map([...nodes.keys()].map((k) => [k, []]));
  for (const node of nodes.values()) {
    for (const dep of node.deps) {
      if (reverse.has(dep)) reverse.get(dep).push(node.id);
    }
  }
  const seen = new Set([startId]);
  const order = [];
  const queue = [{ id: startId, depth: 0 }];
  while (queue.length) {
    const { id, depth } = queue.shift();
    if (id !== startId) order.push({ id, depth });
    for (const next of reverse.get(id).sort()) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push({ id: next, depth: depth + 1 });
    }
  }
  return order;
}

function stats(nodes) {
  let edges = 0;
  for (const node of nodes.values()) edges += node.deps.length;
  return { nodes: nodes.size, edges };
}

function fmtGraph(nodes) {
  const lines = [];
  for (const id of [...nodes.keys()].sort()) {
    const node = nodes.get(id);
    if (node.deps.length === 0) lines.push(`  ${id}`);
    else for (const dep of node.deps) lines.push(`  ${id} -> ${dep}`);
  }
  return lines.join('\n');
}

const cmd = args[0] ?? 'graph';
const nodes = loadGraph(SPECS_DIR);

if (nodes.size === 0) {
  console.error(`no spec files found in ${SPECS_DIR}`);
  process.exit(1);
}

if (cmd === 'graph') {
  const { nodes: n, edges } = stats(nodes);
  console.log(`# CEG (${n} nodes / ${edges} edges)`);
  console.log(fmtGraph(nodes));
} else if (cmd === 'validate') {
  const { errors, cycles } = validate(nodes);
  if (errors.length === 0 && cycles.length === 0) {
    console.log('OK: graph is consistent');
    process.exit(0);
  }
  for (const e of errors) console.error(`ERROR ${e}`);
  for (const c of cycles) console.error(`CYCLE ${c.join(' -> ')}`);
  process.exit(1);
} else if (cmd === 'topo') {
  const order = topoSort(nodes);
  if (!order) {
    console.error('ERROR: graph has a cycle, cannot sort');
    process.exit(1);
  }
  for (const id of order) console.log(id);
} else if (cmd === 'impact') {
  const target = args[1];
  if (!target) {
    console.error('usage: ceg.mjs impact <node-id>');
    process.exit(2);
  }
  const result = impactedBy(nodes, target);
  if (result === null) {
    console.error(`unknown node: ${target}`);
    process.exit(1);
  }
  console.log(`# impact of changing "${target}" (${result.length} downstream)`);
  for (const { id, depth } of result) console.log(`${'  '.repeat(depth)}- ${id}`);
} else {
  console.error(`usage: ceg.mjs <graph|validate|topo|impact <id>> [--specs <dir>]`);
  process.exit(2);
}
