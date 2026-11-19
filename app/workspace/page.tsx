import { Suspense } from 'react'
import WorkspaceShell from '@/components/workspace-shell'
import { LoaderCircle } from 'lucide-react'

const LOGO_URL = 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/TruthLens%20Aperture%20Logo-Zh8uJ1dIwq1yd1IEsjzn4BDgWzmMQA.png'

function WorkspaceLoading() {
  return (
    <main className="workspace-shell">
      <header className="app-nav">
        <a className="brand" href="/" aria-label="TruthLens home">
          <span className="brand-symbol"><img src={LOGO_URL} alt="" /></span>
          <span className="brand-name">TruthLens</span>
        </a>
        <nav className="app-nav-links" aria-label="Workspace navigation">
          <span className="active">Dashboard</span>
          <span>History</span>
          <span>Image analysis</span>
          <span>Video analysis</span>
          <span>Audio analysis</span>
          <span>Reports</span>
          <span>Cross-modal</span>
        </nav>
        <div className="app-nav-actions" />
      </header>
      <div className="workspace-main">
        <div className="workspace-title-row">
          <div>
            <p className="eyebrow">TRUTHLENS FORENSIC WORKSPACE</p>
            <h1>Loading Forensic Workspace…</h1>
          </div>
        </div>
        <div style={{ display: 'flex', minHeight: '40vh', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', color: '#94a3b8' }}>
            <LoaderCircle className="spinning" style={{ width: '28px', height: '28px', color: '#06b6d4' }} />
            <p style={{ fontSize: '13px', margin: 0, fontWeight: 500 }}>Initializing forensic pipeline &amp; local inference models…</p>
          </div>
        </div>
      </div>
    </main>
  )
}

export default function WorkspacePage() {
  return (
    <Suspense fallback={<WorkspaceLoading />}>
      <WorkspaceShell />
    </Suspense>
  )
}
