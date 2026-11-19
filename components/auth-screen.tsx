'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ArrowLeft, ArrowRight, LoaderCircle, ShieldCheck, UserCheck } from 'lucide-react'
import { loginUser, registerUser } from '@/lib/truthlens-api'

const LOGO_URL = 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/TruthLens%20Aperture%20Logo-Zh8uJ1dIwq1yd1IEsjzn4BDgWzmMQA.png'

type AuthMode = 'login' | 'register' | 'forgot-password' | 'reset-password'

const copy: Record<AuthMode, { eyebrow: string; title: string; description: string; action: string }> = {
  login: { eyebrow: 'WELCOME BACK', title: 'Sign in to TruthLens', description: 'Continue to your digital forensic investigation workspace.', action: 'Sign in' },
  register: { eyebrow: 'CREATE YOUR ACCOUNT', title: 'Start with TruthLens', description: 'Create an account to organize your forensic investigations and reports.', action: 'Create account' },
  'forgot-password': { eyebrow: 'ACCOUNT RECOVERY', title: 'Reset your password', description: 'Enter your email and we’ll send a reset link if the account exists.', action: 'Send reset link' },
  'reset-password': { eyebrow: 'ACCOUNT RECOVERY', title: 'Choose a new password', description: 'Set a new password for your TruthLens account.', action: 'Save password' },
}

export default function AuthScreen({ mode }: { mode: AuthMode }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [successNotice, setSuccessNotice] = useState('')

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setNotice('')
    setSuccessNotice('')
    setBusy(true)

    try {
      if (mode === 'login') {
        await loginUser(email, password)
        setSuccessNotice('Signed in successfully. Redirecting to workspace...')
        setTimeout(() => {
          router.push('/workspace?section=overview')
        }, 400)
      } else if (mode === 'register') {
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match. Please verify your password entry.')
        }
        await registerUser(name, email, password)
        setSuccessNotice('Account created successfully! Redirecting to workspace...')
        setTimeout(() => {
          router.push('/workspace?section=overview')
        }, 400)
      } else if (mode === 'forgot-password') {
        setSuccessNotice('If an account exists with this email address, password recovery instructions have been sent.')
      } else if (mode === 'reset-password') {
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match.')
        }
        setSuccessNotice('Password reset successfully. Please sign in with your new credentials.')
        setTimeout(() => {
          router.push('/login')
        }, 1200)
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Authentication operation failed.')
    } finally {
      setBusy(false)
    }
  }

  const handleQuickDemoLogin = async () => {
    setBusy(true)
    setNotice('')
    setSuccessNotice('')
    try {
      await loginUser('analyst@truthlens.ai', 'TruthLens2026!')
      setSuccessNotice('Signed in as Lead Forensic Analyst. Redirecting...')
      setTimeout(() => {
        router.push('/workspace?section=overview')
      }, 400)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Demo sign in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-screen">
      <header className="auth-nav">
        <Link className="brand" href="/">
          <span className="brand-symbol"><img src={LOGO_URL} alt="" /></span>
          <span className="brand-name">TruthLens</span>
        </Link>
        <Link className="auth-back" href="/">
          <ArrowLeft /> Back to home
        </Link>
      </header>

      <section className="auth-card">
        <div className="auth-mark">
          <ShieldCheck aria-hidden="true" />
        </div>
        <p className="eyebrow">{copy[mode].eyebrow}</p>
        <h1>{copy[mode].title}</h1>
        <p className="auth-description">{copy[mode].description}</p>

        {mode === 'login' && (
          <div className="demo-login-box">
            <button
              type="button"
              className="quick-demo-btn"
              onClick={handleQuickDemoLogin}
              disabled={busy}
            >
              <UserCheck className="h-4 w-4" />
              <span>Quick Login: Lead Forensic Analyst</span>
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <label className="auth-field">
              Full name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Dr. Maya Patel"
                required
                autoComplete="name"
              />
            </label>
          )}

          {(mode === 'login' || mode === 'register' || mode === 'forgot-password') && (
            <label className="auth-field">
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="analyst@truthlens.ai"
                required
                autoComplete="email"
              />
            </label>
          )}

          {(mode === 'login' || mode === 'register' || mode === 'reset-password') && (
            <label className="auth-field">
              {mode === 'reset-password' ? 'New password' : 'Password'}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </label>
          )}

          {(mode === 'register' || mode === 'reset-password') && (
            <label className="auth-field">
              Confirm password
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="new-password"
              />
            </label>
          )}

          {mode === 'login' && (
            <div className="auth-options">
              <label><input type="checkbox" defaultChecked /> Remember me</label>
              <Link href="/forgot-password">Forgot password?</Link>
            </div>
          )}

          <button className="button button-dark auth-submit" type="submit" disabled={busy}>
            {busy ? <LoaderCircle className="spinning" /> : null}
            {busy ? 'Authenticating…' : copy[mode].action}
            {!busy && <ArrowRight />}
          </button>

          {mode === 'login' && (
            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <button
                type="button"
                className="button button-outline"
                style={{ width: '100%', fontSize: '12px', color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.35)', padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                onClick={handleQuickDemoLogin}
                disabled={busy}
              >
                <UserCheck className="h-3.5 w-3.5 text-cyan-400" />
                <span>1-Click Hackathon Demo Sign-In (Analyst)</span>
              </button>
            </div>
          )}

          {notice && <p className="form-feedback error" role="alert">{notice}</p>}
          {successNotice && <p className="form-feedback success" role="status">{successNotice}</p>}
        </form>

        {mode === 'login' && (
          <p className="auth-switch">New to TruthLens? <Link href="/register">Create an account</Link></p>
        )}
        {mode === 'register' && (
          <p className="auth-switch">Already have an account? <Link href="/login">Sign in</Link></p>
        )}
        {mode === 'forgot-password' && (
          <p className="auth-switch">Remembered your password? <Link href="/login">Return to sign in</Link></p>
        )}
        {mode === 'reset-password' && (
          <p className="auth-switch"><Link href="/login">Return to sign in</Link></p>
        )}
      </section>

      <footer className="auth-footer">TruthLens · Evidence-led digital forensics</footer>
    </main>
  )
}
