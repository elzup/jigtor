import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { mountLegacyApp } from '../main'
import { Header } from './Header'
import { Tabs } from './Tabs'

// Strangler root: React owns the mount and renders carved-out JSX above (Header)
// and inside (Tabs, via a portal into #tabs-slot) the still-imperative shell,
// which is mounted once into a container React renders.
export function App() {
  const ref = useRef<HTMLDivElement>(null)
  const mounted = useRef(false)
  const [tabsSlot, setTabsSlot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (mounted.current || ref.current === null) return
    mounted.current = true
    mountLegacyApp(ref.current)
    setTabsSlot(ref.current.querySelector<HTMLElement>('#tabs-slot'))
  }, [])
  return (
    <>
      <Header />
      <div ref={ref} />
      {tabsSlot !== null && createPortal(<Tabs />, tabsSlot)}
    </>
  )
}
