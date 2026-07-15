import { createRoot } from 'react-dom/client'
import { App } from './ui/App'

// StrictMode is intentionally omitted during the strangler phase (the legacy
// mount is not idempotent); it is reintroduced as panels become pure JSX.
const container = document.querySelector<HTMLDivElement>('#app')
if (container === null) throw new Error('#app mount point missing')
createRoot(container).render(<App />)
