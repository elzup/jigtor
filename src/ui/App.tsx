import { useEffect, useRef } from 'react'
import { mountLegacyApp } from '../main'
import { Header } from './Header'

// Strangler root: React owns the mount and renders carved-out JSX panels (Header
// so far) above the still-imperative shell, which is mounted once into a
// container React renders.
export function App() {
  const ref = useRef<HTMLDivElement>(null)
  const mounted = useRef(false)
  useEffect(() => {
    if (mounted.current || ref.current === null) return
    mounted.current = true
    mountLegacyApp(ref.current)
  }, [])
  return (
    <>
      <Header />
      <div ref={ref} />
    </>
  )
}
