// spec:tree-overlay — order an object's Tree-view children by overlaying the
// governing schema on the config instance, so the display order is stable and
// schema-declared-but-absent keys are visible.
//
// Order: schema properties first, in their declared order (each marked 'present'
// when the config has it, 'missing' when it does not), then config-only ("extra")
// keys in insertion order. Without a governing schema every config key passes
// through in insertion order, all 'present' — i.e. the pre-overlay behaviour.

export type ChildPresence = 'present' | 'missing' | 'extra'

export type ChildSlot = { key: string; presence: ChildPresence }

export function orderedChildSlots(
  configKeys: string[],
  schemaKeys: string[] | null,
): ChildSlot[] {
  if (schemaKeys === null) {
    return configKeys.map((key) => ({ key, presence: 'present' }))
  }
  const present = new Set(configKeys)
  const inSchema = new Set(schemaKeys)
  const slots: ChildSlot[] = schemaKeys.map((key) => ({
    key,
    presence: present.has(key) ? 'present' : 'missing',
  }))
  for (const key of configKeys) {
    if (!inSchema.has(key)) slots.push({ key, presence: 'extra' })
  }
  return slots
}
