'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowLeft, ArrowRight, ShieldCheck } from 'lucide-react'

const LOGO_URL = 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/TruthLens%20Aperture%20Logo-Zh8uJ1dIwq1yd1IEsjzn4BDgWzmMQA.png'

type AuthMode = 'login' | 'register' | 'forgot-password' | 'reset-password'

const copy: Record<AuthMode, { eyebrow: string; title: string; description: string; action: string }> = {
  login: { eyebrow: 'WELCOME BACK', title: 'Sign in to TruthLens', description: 'Continue to your investigation workspace.', action: 'Sign in' },
  register: { eyebrow: 'CREATE YOUR ACCOUNT', title: 'Start with TruthLens', description: 'Create an account to organise your forensic investigations.', action: 'Create account' },
  'forgot-password': { eyebrow: 'ACCOUNT RECOVERY', title: 'Reset your password', description: 'Enter your email and we’ll send a reset link if the account exists.', action: 'Send reset link' },
  'reset-password': { eyebrow: 'ACCOUNT RECOVERY', title: 'Choose a new password', description: 'Set a new password for your TruthLens account.', action: 'Save password' },
}

export default function AuthScreen({ mode }: { mode: AuthMode }) {
  const [notice, setNotice] = useState('')
  const fields = mode === 'register' ? ['Full name', 'Email', 'Password', 'Confirm password'] : mode === 'forgot-password' ? ['Email'] : mode === 'reset-password' ? ['New password', 'Confirm new password'] : ['Email', 'Password']
  const fieldType = (field: string) => field.toLowerCase().includes('password') ? 'password' : field === 'Email' ? 'email' : 'text'

  return <main className="auth-screen"><header className="auth-nav"><Link className="brand" href="/"><span className="brand-symbol"><img src={LOGO_URL} alt="" /></span><span className="brand-name">TruthLens</span></Link><Link className="auth-back" href="/"><ArrowLeft /> Back to home</Link></header><section className="auth-card"><div className="auth-mark"><ShieldCheck aria-hidden="true" /></div><p className="eyebrow">{copy[mode].eyebrow}</p><h1>{copy[mode].title}</h1><p className="auth-description">{copy[mode].description}</p><form onSubmit={(event) => { event.preventDefault(); setNotice('Authentication is not connected yet. Connect your identity service to continue securely.') }}>
    {fields.map((field) => <label className="auth-field" key={field}>{field}<input type={fieldType(field)} autoComplete={fieldType(field) === 'password' ? (field.toLowerCase().includes('confirm') ? 'new-password' : 'current-password') : fieldType(field)} required /></label>)}
    {mode === 'login' && <div className="auth-options"><label><input type="checkbox" /> Remember me</label><Link href="/forgot-password">Forgot password?</Link></div>}
    <button className="button button-dark auth-submit" type="submit">{copy[mode].action}<ArrowRight /></button>
    {notice && <p className="form-feedback" role="status">{notice}</p>}
  </form>{mode === 'login' && <p className="auth-switch">New to TruthLens? <Link href="/register">Create an account</Link></p>}{mode === 'register' && <p className="auth-switch">Already have an account? <Link href="/login">Sign in</Link></p>}{mode === 'forgot-password' && <p className="auth-switch">Remembered your password? <Link href="/login">Return to sign in</Link></p>}{mode === 'reset-password' && <p className="auth-switch"><Link href="/login">Return to sign in</Link></p>}</section><footer className="auth-footer">TruthLens · Evidence-led digital forensics</footer></main>
}
