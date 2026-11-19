import { LoaderCircle } from 'lucide-react'

const LOGO_URL = 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/TruthLens%20Aperture%20Logo-Zh8uJ1dIwq1yd1IEsjzn4BDgWzmMQA.png'

export default function WorkspaceLoading() {
  return (
    <main className="workspace-shell">
      <header className="app-nav">
        <a className="brand" href="/" aria-label="TruthLens home">
          <span className="brand-symbol"><img src={LOGO_URL} alt="" /></span>
          <span className="brand-name">TruthLens</span>
        </a>
      </header>
      <div className="workspace-main">
        <div style={{ display: 'flex', minHeight: '50vh', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', color: '#666' }}>
            <LoaderCircle className="spinning" style={{ width: '28px', height: '28px' }} />
            <p style={{ fontSize: '13px', margin: 0, fontWeight: 500 }}>Loading workspace…</p>
          </div>
        </div>
      </div>
    </main>
  )
}
