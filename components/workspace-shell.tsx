'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import useSWR, { mutate } from 'swr'
import {
  AlertCircle,
  ArrowRight,
  AudioLines,
  Bell,
  ChevronDown,
  Download,
  FileImage,
  FileSearch,
  FileText,
  Fingerprint,
  LoaderCircle,
  LogOut,
  Menu,
  Plus,
  ShieldCheck,
  UserRound,
  Video,
  X,
} from 'lucide-react'
import {
  analyzeAudio,
  analyzeCrossModal,
  analyzeImage,
  analyzeVideo,
  getCurrentUser,
  getInvestigation,
  getReport,
  listInvestigations,
  logoutUser,
  type InvestigationRecord,
  type SafeUser,
} from '@/lib/truthlens-api'
import AnalysisResult from '@/components/analysis-result'
import MediaPreview, { useMediaPreviewUrl } from '@/components/media-preview'
import MediaUpload from '@/components/media-upload'
import UserDashboard from '@/components/user-dashboard'
import AnalysisHistory from '@/components/analysis-history'

const LOGO_URL = 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/TruthLens%20Aperture%20Logo-Zh8uJ1dIwq1yd1IEsjzn4BDgWzmMQA.png'

const navItems = [
  { key: 'overview', label: 'Dashboard' },
  { key: 'investigations', label: 'History' },
  { key: 'image-analysis', label: 'Image analysis' },
  { key: 'video-analysis', label: 'Video analysis' },
  { key: 'audio-analysis', label: 'Audio analysis' },
  { key: 'reports', label: 'Reports' },
]

const sectionTitles: Record<string, { title: string; description: string }> = {
  overview: { title: 'User Dashboard & Analysis Overview', description: 'Monitor digital forensic examinations, analysis metrics, and recent activities.' },
  investigations: { title: 'Analysis History & Records', description: 'Search, filter, and review previous forensic evidence investigations.' },
  'image-analysis': { title: 'Image analysis', description: 'Inspect image evidence and trace findings to their source.' },
  'video-analysis': { title: 'Video analysis', description: 'Review frames, timestamps, and temporal evidence in one place.' },
  'audio-analysis': { title: 'Audio analysis', description: 'Explore voice and sound evidence with timestamp-level context.' },
  'cross-modal': { title: 'Cross-modal evidence', description: 'Bring video, audio, transcript, and context into a single review.' },
  reports: { title: 'Forensic reports', description: 'Retrieve and export evidence-linked investigation reports.' },
  settings: { title: 'Account settings', description: 'Manage your profile and workspace preferences.' },
}

const supportedTypes: Record<string, { label: string; accept: string; extensions: string }> = {
  'image-analysis': { label: 'Image', accept: 'image/png,image/jpeg,image/webp', extensions: 'PNG, JPG, JPEG, WEBP' },
  'video-analysis': { label: 'Video', accept: 'video/mp4,video/quicktime,video/webm', extensions: 'MP4, MOV, WEBM' },
  'audio-analysis': { label: 'Audio', accept: 'audio/wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/aac', extensions: 'WAV, MP3, M4A' },
  'cross-modal': { label: 'Media', accept: 'image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm,audio/wav,audio/mpeg,audio/mp4,audio/x-m4a,text/plain', extensions: 'Video (MP4, MOV, WEBM), Audio (MP3, WAV, M4A), Images (JPG, PNG, WEBP), Transcripts (TXT)' },
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date not provided' : date.toLocaleDateString()
}

function Brand() {
  return (
    <Link className="brand" href="/" aria-label="TruthLens home">
      <span className="brand-symbol"><img src={LOGO_URL} alt="" /></span>
      <span className="brand-name">TruthLens</span>
    </Link>
  )
}

function EmptyState({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon"><FileSearch aria-hidden="true" /></span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  )
}

function UploadWorkspace({ section }: { section: string }) {
  const [files, setFiles] = useState<File[]>([])
  const [activeFileIndex, setActiveFileIndex] = useState(0)
  const [context, setContext] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [response, setResponse] = useState<unknown>(null)
  const config = supportedTypes[section] ?? supportedTypes['cross-modal']
  const sourcePreviewUrl = useMediaPreviewUrl(section === 'image-analysis' ? files[0] : undefined)
  const isCrossModal = section === 'cross-modal'
  const Icon = section === 'image-analysis' ? FileImage : section === 'video-analysis' ? Video : section === 'audio-analysis' ? AudioLines : Fingerprint

  const handleFilesChange = (newFiles: File[]) => {
    setFiles(newFiles)
    setResponse(null)
    setMessage('')
    if (activeFileIndex >= newFiles.length) {
      setActiveFileIndex(Math.max(0, newFiles.length - 1))
    }
  }

  const handleRemoveFile = (index: number) => {
    const updated = files.filter((_, idx) => idx !== index)
    setFiles(updated)
    setResponse(null)
    if (activeFileIndex >= updated.length) {
      setActiveFileIndex(Math.max(0, updated.length - 1))
    }
  }

  const handleSyncContext = (transcriptText: string) => {
    setContext((prev) => {
      const cleanTranscript = transcriptText.trim()
      if (!prev.trim()) return cleanTranscript
      return `${prev.trim()}\n\n[Transcript Context]:\n${cleanTranscript}`
    })
    setMessage('Transcript content synced into investigation context.')
  }

  const submit = async () => {
    if (!files.length) {
      setMessage('Stage at least one supported digital evidence file to proceed.')
      return
    }
    setBusy(true)
    setProgress(0)
    setMessage('')
    setResponse(null)
    try {
      const onProgress = (value: number) => setProgress(value)
      const result = section === 'image-analysis'
        ? await analyzeImage(files[0], context, onProgress)
        : section === 'video-analysis'
          ? await analyzeVideo(files[0], context, onProgress)
          : section === 'audio-analysis'
            ? await analyzeAudio(files[0], context, onProgress)
            : await analyzeCrossModal(files, context, onProgress)
      setResponse(result)
      setProgress(100)
      setMessage('The configured analysis service responded. Only returned evidence is shown below.')
      mutate('truthlens-investigations')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The analysis service is unavailable.')
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="workspace-content-grid">
        <section className="workspace-panel upload-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">NEW INVESTIGATION</p>
              <h2>{isCrossModal ? 'Bring related sources together' : `Start with the ${config.label.toLowerCase()}`}</h2>
            </div>
            <span className="panel-icon"><Icon aria-hidden="true" /></span>
          </div>
          <p className="panel-intro">Upload original files and share any context or transcripts that may help reviewers verify authenticity.</p>

          <MediaUpload
            files={files}
            onFilesChange={handleFilesChange}
            section={section}
            isBusy={busy}
            uploadProgress={progress}
            activeFileIndex={activeFileIndex}
            onSelectFileIndex={setActiveFileIndex}
          />

          {files.length > 0 && (
            <MediaPreview
              files={files}
              activeIndex={activeFileIndex}
              onSelectIndex={setActiveFileIndex}
              onRemoveFile={handleRemoveFile}
              onSyncContext={handleSyncContext}
            />
          )}

          <label className="field-label" htmlFor="analysis-context">Related context &amp; transcripts <span>Optional</span></label>
          <textarea
            id="analysis-context"
            className="workspace-textarea"
            value={context}
            onChange={(event) => setContext(event.target.value)}
            placeholder="Add a caption, verified transcript, or investigation notes for this media..."
            rows={4}
          />

          {progress !== null && (
            <div className="upload-progress" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <span>{busy && progress < 100 ? 'Uploading source' : busy ? 'Processing response' : 'Upload complete'}</span>
              <span className="upload-progress-track"><span style={{ width: `${progress}%` }} /></span>
              <span>{progress}%</span>
            </div>
          )}

          {message && <p className="form-feedback" role="status">{message}</p>}

          <div className="upload-actions">
            <span className="privacy-note"><ShieldCheck aria-hidden="true" /> Files are sent only to the configured backend endpoint.</span>
            <button className="button button-dark" type="button" onClick={submit} disabled={busy || files.length === 0}>
              {busy ? <LoaderCircle className="spinning" /> : null}
              {busy ? 'Analyzing…' : `Start ${config.label.toLowerCase()} analysis`}
              {!busy && <ArrowRight />}
            </button>
          </div>
        </section>

        <aside className="workspace-panel analysis-info">
          <p className="eyebrow">A CAREFUL PROCESS</p>
          <h2>Evidence first. Interpretation second.</h2>
          <div className="info-steps">
            <div><span>01</span><p>Files are submitted to the configurable analysis service.</p></div>
            <div><span>02</span><p>Returned findings include only fields supplied by the backend.</p></div>
            <div><span>03</span><p>Reviewers decide what the evidence means in context.</p></div>
          </div>
          <div className="notice-box">
            <AlertCircle aria-hidden="true" />
            <p>TruthLens does not create detections locally. No findings are shown until the backend returns them.</p>
          </div>
        </aside>
      </div>
      {response !== null && <AnalysisResult response={response} section={config.label} sourcePreviewUrl={sourcePreviewUrl ?? undefined} />}
    </>
  )
}

function InvestigationDetails({ id }: { id: string }) {
  const { data: record, error, isLoading } = useSWR(
    ['truthlens-investigation', id],
    ([, investigationId]) => getInvestigation(investigationId),
    { revalidateOnFocus: false }
  )

  if (isLoading) {
    return (
      <section className="workspace-panel">
        <div className="p-6 text-center text-slate-400 flex items-center justify-center gap-3">
          <LoaderCircle className="spinning h-5 w-5 text-cyan-400" />
          <span>Loading investigation details and historical evidence…</span>
        </div>
      </section>
    )
  }

  if (error || !record) {
    return (
      <section className="workspace-panel">
        <EmptyState
          title="Investigation unavailable"
          text="The requested investigation could not be found or you do not have permission to view it."
          action={
            <Link className="button button-outline mt-3" href="/workspace?section=investigations">
              Back to History
            </Link>
          }
        />
      </section>
    )
  }

  const isReviewRequested = record.requiresReview === true

  return (
    <div className="investigation-reopened-wrapper flex flex-col gap-6">
      {/* Header Overview Card */}
      <section className="workspace-panel investigation-detail-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">PREVIOUS FORENSIC RECORD</p>
            <h2>{record.filename}</h2>
          </div>
          <span className={`status-pill ${isReviewRequested ? 'flagged' : 'passed'}`}>
            {isReviewRequested ? 'Review Requested' : 'Completed'}
          </span>
        </div>

        <dl className="investigation-detail-grid">
          <div>
            <dt>Investigation ID</dt>
            <dd className="font-mono text-cyan-300">{record.id}</dd>
          </div>
          <div>
            <dt>Media Modality</dt>
            <dd className="capitalize font-semibold">{record.mediaType}</dd>
          </div>
          <div>
            <dt>Date Submitted</dt>
            <dd>{formatDate(record.createdAt)}</dd>
          </div>
          <div>
            <dt>Assessment Summary</dt>
            <dd>{record.assessment || 'Analysis completed with verified analytical output parameters.'}</dd>
          </div>
          <div>
            <dt>Review Recommendation</dt>
            <dd>{isReviewRequested ? 'Requires Human Examiner Review' : 'No Significant Anomalies Detected'}</dd>
          </div>
        </dl>

        <div className="investigation-detail-actions flex items-center justify-between flex-wrap gap-3 mt-4 pt-4 border-t border-slate-800">
          <div className="flex items-center gap-3">
            <Link className="button button-outline" href="/workspace?section=investigations">
              ← Back to History
            </Link>
            <Link className="button button-outline" href="/workspace?section=overview">
              Dashboard
            </Link>
          </div>

          {record.reportId && (
            <Link
              className="button button-dark"
              href={`/workspace?section=reports&report=${encodeURIComponent(record.reportId)}`}
            >
              <FileText className="h-4 w-4 mr-1.5 text-emerald-400" /> Reopen Forensic PDF Report
            </Link>
          )}
        </div>
      </section>

      {/* Full Reopened Analysis Result & Explainable Evidence Viewer */}
      {record.output ? (
        <div className="reopened-analysis-section">
          <AnalysisResult
            response={record.output}
            section={record.mediaType.toUpperCase()}
          />
        </div>
      ) : (
        <section className="workspace-panel">
          <div className="p-4 text-center text-slate-400">
            <p>Historical record metadata loaded. Full telemetry output cache was not recorded for this legacy item.</p>
          </div>
        </section>
      )}
    </div>
  )
}

function Reports({ initialId }: { initialId: string }) {
  const [reportId, setReportId] = useState(initialId)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [reportUrl, setReportUrl] = useState<string | null>(null)

  useEffect(() => () => {
    if (reportUrl) URL.revokeObjectURL(reportUrl)
  }, [reportUrl])

  const download = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const id = reportId.trim()
    if (!id) {
      setMessage('Enter a report ID returned by an investigation.')
      return
    }
    setBusy(true)
    setMessage('')
    setReportUrl(null)
    try {
      const blob = await getReport(id)
      if (blob.type.split(';')[0].trim().toLowerCase() !== 'application/pdf') {
        throw new Error('The report endpoint did not return a PDF, so no preview or download was generated.')
      }
      const objectUrl = URL.createObjectURL(blob)
      setReportUrl(objectUrl)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `truthlens-report-${id.replace(/[^a-z0-9._-]/gi, '-')}.pdf`
      document.body.append(link)
      link.click()
      link.remove()
      setMessage('The report was retrieved, previewed below, and downloaded.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The report service is unavailable.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="workspace-panel reports-empty-panel">
      <div className="report-placeholder">
        <span className="report-document"><FileText aria-hidden="true" /></span>
        <p className="eyebrow">REPORT LIBRARY</p>
        <h2>Retrieve a forensic report.</h2>
        <p>Enter a report ID returned by your analysis service. TruthLens will download the file only when the configured backend provides it.</p>
        <form className="report-lookup" onSubmit={download}>
          <label className="sr-only" htmlFor="report-id">Report ID</label>
          <input
            id="report-id"
            value={reportId}
            onChange={(event) => { setReportId(event.target.value); setReportUrl(null) }}
            placeholder="Enter report ID (e.g. rep-baseline-001)"
            autoComplete="off"
          />
          <button className="button button-dark" type="submit" disabled={busy}>
            {busy ? <LoaderCircle className="spinning" /> : <FileText />}
            {busy ? 'Retrieving…' : 'Download PDF'}
          </button>
        </form>
        {message && <p className="form-feedback report-feedback" role="status">{message}</p>}
        {reportUrl && (
          <div className="report-preview">
            <div className="report-preview-heading">
              <strong>Returned report preview</strong>
              <a href={reportUrl} download={`truthlens-report-${reportId.replace(/[^a-z0-9._-]/gi, '-')}.pdf`}>
                Download again <ArrowRight />
              </a>
            </div>
            <iframe src={reportUrl} title={`Forensic report ${reportId}`} />
          </div>
        )}
        <Link className="button button-outline" href="/workspace?section=investigations">
          View investigations <ArrowRight />
        </Link>
      </div>
    </section>
  )
}

function Settings({ user, isGuest }: { user: SafeUser | null; isGuest: boolean }) {
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await logoutUser()
      router.push('/login')
    } catch {
      router.push('/login')
    }
  }

  return (
    <div className="settings-grid">
      <section className="workspace-panel settings-card">
        <p className="eyebrow">PROFILE &amp; CREDENTIALS</p>
        <div className="profile-placeholder">
          <span className="profile-glyph">
            {user ? user.name.slice(0, 2).toUpperCase() : <UserRound />}
          </span>
          <div>
            <h2>{user ? user.name : isGuest ? 'Guest Sandbox Session' : 'Analyst Profile'}</h2>
            <p className="user-email-text">{user ? user.email : 'Unauthenticated temporary session'}</p>
            <span className="user-role-badge">
              {user?.role === 'lead_analyst'
                ? 'Lead Forensic Analyst'
                : user?.role === 'investigator'
                  ? 'Digital Forensics Examiner'
                  : 'Sandbox Guest'}
            </span>
          </div>
        </div>
        {user ? (
          <div className="profile-meta-tags mt-3">
            <small className="text-slate-400">Account ID: <code className="text-cyan-400">{user.id}</code></small>
            <small className="text-slate-400 block mt-1">
              Member Since: {formatDate(user.createdAt)}
            </small>
          </div>
        ) : (
          <Link href="/login" className="button button-dark mt-3">
            Sign in to an existing account
          </Link>
        )}
      </section>

      <section className="workspace-panel settings-card">
        <p className="eyebrow">SESSION SECURITY</p>
        <h2>Account Session &amp; Access</h2>
        <p>Your session maintains strict data boundary isolation. Analysis records are restricted exclusively to your user ID.</p>
        <div className="settings-actions mt-4">
          {user ? (
            <button
              className="button button-outline text-rose-400 border-rose-800/40 hover:bg-rose-950/20"
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
            >
              <LogOut className="h-4 w-4 mr-1.5" />
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          ) : (
            <Link className="button button-outline" href="/register">
              Create an account
            </Link>
          )}
        </div>
      </section>

      <section className="workspace-panel settings-card">
        <p className="eyebrow">FORENSIC ENGINE</p>
        <h2>Pipeline Preferences</h2>
        <p>Local analysis engines and deterministic heuristics are active.</p>
        <label className="settings-disabled-option">
          <input type="checkbox" defaultChecked disabled /> ViT-Deepfake Neural Model v1
        </label>
        <label className="settings-disabled-option">
          <input type="checkbox" defaultChecked disabled /> Error Level Analysis (ELA)
        </label>
        <label className="settings-disabled-option">
          <input type="checkbox" defaultChecked disabled /> Tri-Modal Multimodal Correlation Engine
        </label>
      </section>
    </div>
  )
}

export default function WorkspaceShell() {
  const searchParams = useSearchParams()
  const section = searchParams.get('section') ?? 'overview'
  const investigationId = searchParams.get('investigation')
  const reportQuery = searchParams.get('report') ?? ''
  const [menuOpen, setMenuOpen] = useState(false)

  // Fetch Current User
  const { data: authData } = useSWR('/api/auth/me', getCurrentUser, { revalidateOnFocus: false })
  const user = authData?.user ?? null
  const isGuest = authData?.isGuest ?? true

  // Fetch Investigations List
  const { data: investigationsData, error: investigationsError, isLoading: investigationsLoading } = useSWR(
    'truthlens-investigations',
    listInvestigations,
    { revalidateOnFocus: false }
  )

  const records = useMemo(() => {
    return [...(investigationsData ?? [])].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }, [investigationsData])

  const page = sectionTitles[section] ? section : 'overview'
  const pageTitle = investigationId
    ? { title: 'Investigation details', description: 'Review the file details, findings, and explainable AI telemetry returned for this evidence.' }
    : sectionTitles[page]

  const activeNav = useMemo(
    () => investigationId ? 'investigations' : navItems.find((item) => item.key === page)?.key ?? '',
    [investigationId, page]
  )

  const userInitials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'T'

  return (
    <main className="workspace-shell">
      <header className="app-nav">
        <Brand />
        <nav className={`app-nav-links ${menuOpen ? 'is-open' : ''}`} aria-label="Workspace navigation">
          {navItems.map(({ key, label }) => (
            <Link
              className={activeNav === key ? 'active' : ''}
              href={`/workspace?section=${key}`}
              key={key}
              onClick={() => setMenuOpen(false)}
            >
              {label}
            </Link>
          ))}
          <Link
            className={page === 'cross-modal' && !investigationId ? 'active' : ''}
            href="/workspace?section=cross-modal"
            onClick={() => setMenuOpen(false)}
          >
            Cross-modal
          </Link>
        </nav>

        <div className="app-nav-actions">
          <button type="button" className="icon-button" aria-label="Notifications" disabled>
            <Bell />
          </button>
          <Link className="profile-button" href="/workspace?section=settings">
            <span className="profile-avatar">{userInitials}</span>
            <span>{user ? user.name.split(' ')[0] : 'Account'}</span>
            <ChevronDown />
          </Link>
        </div>

        <button
          className="mobile-menu-button app-menu-toggle"
          type="button"
          aria-label={menuOpen ? 'Close workspace navigation' : 'Open workspace navigation'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X /> : <Menu />}
        </button>
      </header>

      <div className="workspace-main">
        <div className="workspace-title-row">
          <div>
            <p className="eyebrow">TRUTHLENS FORENSIC WORKSPACE</p>
            <h1>{pageTitle.title}</h1>
            <p>{pageTitle.description}</p>
          </div>
          <Link className="button button-dark workspace-new" href="/workspace?section=image-analysis">
            <Plus /> New investigation
          </Link>
        </div>

        {investigationId ? (
          <InvestigationDetails id={investigationId} />
        ) : (
          <>
            {page === 'overview' && (
              <UserDashboard
                user={user}
                isGuest={isGuest}
                records={records}
                isLoading={investigationsLoading}
                error={investigationsError ? new Error(String(investigationsError)) : null}
                onRefresh={() => mutate('truthlens-investigations')}
              />
            )}
            {page === 'investigations' && (
              <AnalysisHistory
                records={records}
                isLoading={investigationsLoading}
                error={investigationsError ? new Error(String(investigationsError)) : null}
                onRefresh={() => mutate('truthlens-investigations')}
              />
            )}
            {['image-analysis', 'video-analysis', 'audio-analysis', 'cross-modal'].includes(page) && (
              <UploadWorkspace section={page} />
            )}
            {page === 'reports' && <Reports key={reportQuery} initialId={reportQuery} />}
            {page === 'settings' && <Settings user={user} isGuest={isGuest} />}
          </>
        )}

        <footer className="workspace-footer">
          <span>TruthLens · Evidence-led digital forensics</span>
          <span>Automated model outputs are not absolute proof of manipulation.</span>
          <Link href="mailto:support@truthlens.ai">Examiner Support</Link>
        </footer>
      </div>
    </main>
  )
}
