import { Icon, type IconName } from './icons'
import { type Tab, useUiStore } from './store'

// Carved from the imperative shell's <nav class="tabs">. Reads the active tab from
// the shared store and writes clicks back to it; the legacy shell subscribes and
// toggles panel visibility + re-renders. Markup mirrors the vanilla version so the
// existing CSS and e2e selectors (.tab[data-tab=...]) keep working.
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'edit', label: 'Edit', icon: 'edit' },
  { id: 'schema', label: 'Schema', icon: 'code' },
  { id: 'history', label: 'History', icon: 'clock' },
]

export function Tabs() {
  const activeTab = useUiStore((s) => s.activeTab)
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  return (
    <nav className="tabs">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={tab.id === activeTab ? 'tab active' : 'tab'}
          data-tab={tab.id}
          type="button"
          onClick={() => setActiveTab(tab.id)}
        >
          <Icon name={tab.icon} /> {tab.label}
        </button>
      ))}
    </nav>
  )
}
