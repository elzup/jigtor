import { create } from 'zustand'

// Shared UI store for the strangler migration. Only view-state lives here for now
// (the heavy config/schema state stays in the imperative shell and is carved in
// later). Legacy code drives DOM from these values via subscribe(); React panels
// read them directly. This makes the store the single source of truth for the
// pieces already carved into JSX (Tabs first).
export type Tab = 'edit' | 'schema' | 'history'

export type TabAvailability = {
  hasConfig: boolean
  hasSchema: boolean
  hasHistory: boolean
}

// A tab is shown only in the state where it is meaningful (spec:open-flow):
// Edit needs a config; Schema needs a config (to create/infer one) or a schema;
// History needs a connected config with saved versions.
export function tabVisible(tab: Tab, a: TabAvailability): boolean {
  if (tab === 'edit') return a.hasConfig
  if (tab === 'schema') return a.hasConfig || a.hasSchema
  return a.hasConfig && a.hasHistory
}

const TAB_ORDER: Tab[] = ['edit', 'schema', 'history']

type UiState = TabAvailability & {
  activeTab: Tab
  setActiveTab: (tab: Tab) => void
  setAvailability: (availability: TabAvailability) => void
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: 'edit',
  hasConfig: false,
  hasSchema: false,
  hasHistory: false,
  setActiveTab: (activeTab) => set({ activeTab }),
  setAvailability: (availability) =>
    set((s) => {
      // If the active tab just became hidden, fall back to the first visible one.
      if (tabVisible(s.activeTab, availability)) return availability
      const fallback = TAB_ORDER.find((t) => tabVisible(t, availability))
      return { ...availability, ...(fallback ? { activeTab: fallback } : {}) }
    }),
}))
