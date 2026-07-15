import { create } from 'zustand'

// Shared UI store for the strangler migration. Only view-state lives here for now
// (the heavy config/schema state stays in the imperative shell and is carved in
// later). Legacy code drives DOM from these values via subscribe(); React panels
// read them directly. This makes the store the single source of truth for the
// pieces already carved into JSX (Tabs first).
export type Tab = 'edit' | 'schema' | 'history'

type UiState = {
  activeTab: Tab
  setActiveTab: (tab: Tab) => void
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: 'edit',
  setActiveTab: (activeTab) => set({ activeTab }),
}))
