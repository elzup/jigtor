// spec:tree-overlay — order an object's Tree-view children by overlaying the
// governing schema on the config instance.
//
// The config file's own key order is the source of truth (the user arranges it
// via ↑↓ move, mirroring arrays), so 'present' keys keep config insertion order.
// Schema properties absent from the config are appended as 'missing' rows in
// schema order, so the user can see (and add) what the schema expects. Without a
// governing schema every config key passes through in insertion order.

export type ChildPresence = 'present' | 'missing'

export type ChildSlot = { key: string; presence: ChildPresence }

export function orderedChildSlots(
  configKeys: string[],
  schemaKeys: string[] | null,
): ChildSlot[] {
  const present: ChildSlot[] = configKeys.map((key) => ({ key, presence: 'present' }))
  if (schemaKeys === null) return present
  const inConfig = new Set(configKeys)
  const missing: ChildSlot[] = schemaKeys
    .filter((key) => !inConfig.has(key))
    .map((key) => ({ key, presence: 'missing' }))
  return [...present, ...missing]
}

// True when the config's schema-known keys appear in the same relative order the
// schema declares them (keys absent from the schema are ignored). Used to surface
// a soft "order differs from schema" hint — file order is still valid, just not
// the schema's recommended order.
export function keyOrderMatchesSchema(configKeys: string[], schemaKeys: string[]): boolean {
  const schemaSet = new Set(schemaKeys)
  const known = configKeys.filter((key) => schemaSet.has(key))
  const knownSet = new Set(known)
  const expected = schemaKeys.filter((key) => knownSet.has(key))
  return known.length === expected.length && known.every((key, i) => key === expected[i])
}
