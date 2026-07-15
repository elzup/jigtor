import { useEffect, useRef } from 'react'
import { mountLegacyApp } from '../main'

// Strangler root: React owns the mount; the imperative shell is mounted once into
// a container React renders. Panels are carved out into JSX from here.
export function App() {
  const ref = useRef<HTMLDivElement>(null)
  const mounted = useRef(false)
  useEffect(() => {
    if (mounted.current || ref.current === null) return
    mounted.current = true
    mountLegacyApp(ref.current)
  }, [])
  return <div ref={ref} />
}
