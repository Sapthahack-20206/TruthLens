'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertCircle, RotateCcw } from 'lucide-react'

const LOGO_URL = 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/TruthLens%20Aperture%20Logo-Zh8uJ1dIwq1yd1IEsjzn4BDgWzmMQA.png'

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Workspace error:', error)
  }, [error])

  return (
    <main className="workspace-shell">
      <header className="app-nav">
        <Link className="brand" href="/" aria-label="TruthLens home">
          <span className="brand-symbol"><img src={LOGO_URL} alt="" /></span>
          <span className="brand-name">TruthLens</span>
        </Link>
      </header>
      <div className="workspace-main">
        <div style={{ display: 'flex', minHeight: '50vh', alignItems: 'center', justifyContent: 'center' }}>
          <section className="workspace-panel" style={{ maxWidth: '480px', width: '100%', textAlign: 'center', padding: '36px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#dc2626' }}>
              <AlertCircle aria-hidden="true" style={{ width: '22px', height: '22px' }} />
            </div>
            <div>
              <p className="eyebrow" style={{ color: '#dc2626' }}>WORKSPACE ERROR</p>
              <h2 style={{ fontSize: '18px', fontWeight: 600, margin: '6px 0 8px' }}>Something went wrong</h2>
              <p style={{ fontSize: '12px', color: '#666', margin: 0, lineHeight: 1.6 }}>
                An unexpected error occurred while loading this workspace view. You can try refreshing the component or returning to the overview.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              <button className="button button-dark" type="button" onClick={() => reset()}>
                <RotateCcw style={{ width: '14px', height: '14px' }} /> Try again
              </button>
              <Link className="button button-outline" href="/workspace">
                Reset workspace
              </Link>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
