// First carved-out panel: the static header. Proves the strangler pipeline —
// React renders this as a sibling above the still-imperative shell.
export function Header() {
  return (
    <header>
      <h1>jigtor</h1>
      <p>Open config.json, edit safely, review the diff, save back to the same file.</p>
    </header>
  )
}
