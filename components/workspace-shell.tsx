'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { Activity, AlertCircle, ArrowDown, ArrowRight, AudioLines, Bell, Check, ChevronDown, CircleHelp, Clock3, FileImage, FileSearch, FileText, Fingerprint, Image as ImageIcon, LoaderCircle, Menu, Plus, Search, ShieldCheck, Upload, UserRound, Video, X } from 'lucide-react'
import { analyzeAudio, analyzeCrossModal, analyzeImage, analyzeVideo, getInvestigation, getReport, listInvestigations, type InvestigationRecord } from '@/lib/truthlens-api'
import AnalysisResult from '@/components/analysis-result'
import MediaPreview, { useMediaPreviewUrl } from '@/components/media-preview'
import MediaUpload from '@/components/media-upload'

const LOGO_URL = 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/TruthLens%20Aperture%20Logo-Zh8uJ1dIwq1yd1IEsjzn4BDgWzmMQA.png'

const navItems = [
  { key: 'overview', label: 'Overview' },
  { key: 'investigations', label: 'Investigations' },
  { key: 'image-analysis', label: 'Image analysis' },
  { key: 'video-analysis', label: 'Video analysis' },
  { key: 'audio-analysis', label: 'Audio analysis' },
  { key: 'reports', label: 'Reports' },
]

const sectionTitles: Record<string, { title: string; description: string }> = {
  overview: { title: 'Your investigation workspace', description: 'Monitor your digital forensic investigations and review analysis results.' },
  investigations: { title: 'Investigations', description: 'Search and review your submitted media investigations.' },
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

const acceptedExtensions: Record<string, string[]> = {
  'image-analysis': ['png', 'jpg', 'jpeg', 'webp'],
  'video-analysis': ['mp4', 'mov', 'webm'],
  'audio-analysis': ['wav', 'mp3', 'm4a'],
  'cross-modal': ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'mov', 'webm', 'wav', 'mp3', 'm4a', 'txt'],
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date not provided' : date.toLocaleDateString()
}

function Brand() {
  return <Link className="brand" href="/" aria-label="TruthLens home"><span className="brand-symbol"><img src={LOGO_URL} alt="" /></span><span className="brand-name">TruthLens</span></Link>
}

function EmptyState({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return <div className="empty-state"><span className="empty-state-icon"><FileSearch aria-hidden="true" /></span><h3>{title}</h3><p>{text}</p>{action}</div>
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
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The analysis service is unavailable.')
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }

  return <>
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

        {/* Modular Evidence Upload Component */}
        <MediaUpload
          files={files}
          onFilesChange={handleFilesChange}
          section={section}
          isBusy={busy}
          uploadProgress={progress}
          activeFileIndex={activeFileIndex}
          onSelectFileIndex={setActiveFileIndex}
        />

        {/* Modular Evidence Preview Area */}
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
}

function Overview() {
  const { data, error, isLoading } = useSWR('truthlens-investigations', listInvestigations, { revalidateOnFocus: false })
  const records = [...(data ?? [])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  const reviewedValuesAvailable = records.length > 0 && records.every((record) => typeof record.requiresReview === 'boolean')
  const reviewCount = reviewedValuesAvailable ? String(records.filter((record) => record.requiresReview).length) : '—'
  const stats = [
    ['Total investigations', isLoading || error ? '—' : String(records.length), FileSearch],
    ['Images analysed', isLoading || error ? '—' : String(records.filter((record) => record.mediaType === 'image').length), ImageIcon],
    ['Videos analysed', isLoading || error ? '—' : String(records.filter((record) => record.mediaType === 'video').length), Video],
    ['Audio files analysed', isLoading || error ? '—' : String(records.filter((record) => record.mediaType === 'audio').length), AudioLines],
    ['Requires further review', isLoading || error ? '—' : reviewCount, CircleHelp],
  ] as const
  const reports = records.filter((record) => record.reportId).slice(0, 3)

  return <>
    {error && <p className="form-feedback dashboard-feedback" role="status">Workspace totals are unavailable until the analysis service is connected.</p>}
    <div className="stats-grid">{stats.map(([label, value, Icon]) => <article className="stat-card" key={label}><div className="stat-label"><span>{label}</span><Icon aria-hidden="true" /></div><strong>{value}</strong><span className="stat-footnote">{error ? 'Service not connected' : isLoading ? 'Loading live totals' : label === 'Requires further review' && reviewCount === '—' ? 'Not returned by the service' : 'From returned records'}</span></article>)}</div>
    <div className="overview-grid">
      <section className="workspace-panel recent-panel"><div className="panel-heading"><div><p className="eyebrow">YOUR ACTIVITY</p><h2>Recent investigations</h2></div><Link className="subtle-link" href="/workspace?section=investigations">View all <ArrowRight /></Link></div>{records.length ? <div className="overview-record-list">{records.slice(0, 4).map((record) => <div className="overview-record-row" key={record.id}><FileSearch aria-hidden="true" /><div><strong>{record.filename}</strong><small>{record.mediaType} · {formatDate(record.createdAt)} · {record.status}</small></div><Link href={`/workspace?investigation=${encodeURIComponent(record.id)}`}>View</Link></div>)}</div> : <EmptyState title={isLoading ? 'Loading investigations' : 'Your workspace is ready'} text={error ? 'Connect the analysis backend to load returned investigation records.' : 'Investigations will appear here when returned by the analysis service.'} action={!error && !isLoading ? <Link className="button button-outline" href="/workspace?section=image-analysis"><Plus /> New investigation</Link> : undefined} />}</section>
      <section className="workspace-panel activity-panel"><div className="panel-heading"><div><p className="eyebrow">WORKSPACE STATUS</p><h2>Analysis activity</h2></div><Activity aria-hidden="true" /></div>{records.length ? <div className="overview-record-list">{records.slice(0, 3).map((record) => <div className="overview-record-row" key={record.id}><Clock3 aria-hidden="true" /><div><strong>{record.filename}</strong><small>Service status: {record.status}</small></div></div>)}</div> : <div className="activity-empty"><span className="activity-line" /><p>No returned analysis activity</p><span>Activity appears when the service returns records.</span></div>}</section>
      <section className="workspace-panel status-panel"><div className="panel-heading"><div><p className="eyebrow">OVERVIEW</p><h2>Investigation status</h2></div><Clock3 aria-hidden="true" /></div>{records.length ? <div className="status-empty"><span className="status-ring"><Check aria-hidden="true" /></span><p>{reviewedValuesAvailable ? `${reviewCount} flagged for review` : 'Review flags not returned'}</p><span>Status reflects only fields returned by the service.</span></div> : <div className="status-empty"><span className="status-ring"><Check aria-hidden="true" /></span><p>No returned investigations</p><span>Review status will appear with live records.</span></div>}</section>
      <section className="workspace-panel reports-panel"><div className="panel-heading"><div><p className="eyebrow">DOCUMENTS</p><h2>Recent reports</h2></div><Link className="subtle-link" href="/workspace?section=reports">Browse reports <ArrowRight /></Link></div>{reports.length ? <div className="overview-record-list">{reports.map((record) => <div className="overview-record-row" key={record.reportId}><FileText aria-hidden="true" /><div><strong>{record.filename}</strong><small>Report {record.reportId}</small></div><Link href={`/workspace?section=reports&report=${encodeURIComponent(record.reportId!)}`}>Open</Link></div>)}</div> : <EmptyState title="No reports returned" text="Reports appear here when the backend returns report IDs for completed investigations." />}</section>
    </div>
  </>
}

function Investigations() {
  const [query, setQuery] = useState('')
  const [mediaFilter, setMediaFilter] = useState('all')
  const [newestFirst, setNewestFirst] = useState(true)
  const { data, error, isLoading } = useSWR('truthlens-investigations', listInvestigations, { revalidateOnFocus: false })
  const records = useMemo(() => (data ?? []).filter((record) => `${record.id} ${record.filename}`.toLowerCase().includes(query.toLowerCase()) && (mediaFilter === 'all' || record.mediaType === mediaFilter)).sort((a, b) => {
    const difference = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    return newestFirst ? -difference : difference
  }), [data, mediaFilter, newestFirst, query])

  return <section className="workspace-panel investigations-panel">
    <div className="history-toolbar"><label className="search-field"><Search aria-hidden="true" /><span className="sr-only">Search investigations</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by file name or investigation ID" /></label><label className="history-filter">Filter media <select value={mediaFilter} onChange={(event) => setMediaFilter(event.target.value)}><option value="all">All media</option><option value="image">Images</option><option value="video">Videos</option><option value="audio">Audio</option><option value="text">Text</option></select></label><button className="button button-outline" type="button" onClick={() => setNewestFirst((current) => !current)}><ArrowDown aria-hidden="true" /> Sort: {newestFirst ? 'newest' : 'oldest'}</button></div>
    {error && <p className="form-feedback" role="status">Investigation history is unavailable until the analysis service is connected.</p>}
    <div className="history-table-wrap"><table className="history-table"><thead><tr><th>Investigation</th><th>Media type</th><th>Date</th><th>Status</th><th>Assessment</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{records.length > 0 ? records.map((record) => <tr key={record.id}><td>{record.filename}<small className="record-id">{record.id}</small></td><td>{record.mediaType}</td><td>{formatDate(record.createdAt)}</td><td>{record.status}</td><td>{record.assessment ?? 'Not provided'}</td><td><Link className="subtle-link" href={`/workspace?investigation=${encodeURIComponent(record.id)}`}>View results <ArrowRight /></Link>{record.reportId && <Link className="subtle-link" href={`/workspace?section=reports&report=${encodeURIComponent(record.reportId)}`}>Report</Link>}</td></tr>) : <tr><td colSpan={6}><EmptyState title={isLoading ? 'Loading investigations' : error ? 'History unavailable' : query || mediaFilter !== 'all' ? 'No matching investigations' : 'No investigations yet'} text={error ? 'Connect the analysis service to load returned investigation records.' : 'When the backend returns investigation records, they will appear here for searching and review.'} action={!isLoading && !error ? <Link className="button button-dark" href="/workspace?section=image-analysis"><Plus /> New investigation</Link> : undefined} /></td></tr>}</tbody></table></div>
  </section>
}

function InvestigationDetails({ id }: { id: string }) {
  const { data: record, error, isLoading } = useSWR(['truthlens-investigation', id], ([, investigationId]) => getInvestigation(investigationId), { revalidateOnFocus: false })
  if (isLoading) return <section className="workspace-panel"><p role="status">Loading investigation details…</p></section>
  if (error || !record) return <section className="workspace-panel"><EmptyState title="Investigation unavailable" text="The configured service did not return this investigation. Check the ID or connect the FastAPI backend." /></section>

  return <section className="workspace-panel investigation-detail-panel"><div className="panel-heading"><div><p className="eyebrow">RETURNED INVESTIGATION</p><h2>{record.filename}</h2></div><span className="response-status">{record.status}</span></div><dl className="investigation-detail-grid"><div><dt>Investigation ID</dt><dd>{record.id}</dd></div><div><dt>Media type</dt><dd>{record.mediaType}</dd></div><div><dt>Date submitted</dt><dd>{formatDate(record.createdAt)}</dd></div><div><dt>Assessment</dt><dd>{record.assessment ?? 'Not provided by the service'}</dd></div><div><dt>Review flag</dt><dd>{typeof record.requiresReview === 'boolean' ? (record.requiresReview ? 'Review requested' : 'No review flag returned') : 'Not provided by the service'}</dd></div></dl><div className="investigation-detail-actions">{record.reportId && <Link className="button button-outline" href={`/workspace?section=reports&report=${encodeURIComponent(record.reportId)}`}><FileText /> Download report <ArrowRight /></Link>}<Link className="button button-outline" href="/workspace?section=investigations">Back to investigations</Link></div></section>
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
      if (blob.type.split(';')[0].trim().toLowerCase() !== 'application/pdf') throw new Error('The report endpoint did not return a PDF, so no preview or download was generated.')
      const objectUrl = URL.createObjectURL(blob)
      setReportUrl(objectUrl)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `truthlens-report-${id.replace(/[^a-z0-9._-]/gi, '-')}.pdf`
      document.body.append(link)
      link.click()
      link.remove()
      setMessage('The report was returned by the configured service, previewed below, and downloaded.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The report service is unavailable.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="workspace-panel reports-empty-panel"><div className="report-placeholder"><span className="report-document"><FileText aria-hidden="true" /></span><p className="eyebrow">REPORT LIBRARY</p><h2>Retrieve a forensic report.</h2><p>Enter a report ID returned by your analysis service. TruthLens will download the file only when the configured backend provides it.</p><form className="report-lookup" onSubmit={download}><label className="sr-only" htmlFor="report-id">Report ID</label><input id="report-id" value={reportId} onChange={(event) => { setReportId(event.target.value); setReportUrl(null) }} placeholder="Enter report ID" autoComplete="off" /><button className="button button-dark" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spinning" /> : <FileText />}{busy ? 'Retrieving…' : 'Download PDF'}</button></form>{message && <p className="form-feedback report-feedback" role="status">{message}</p>}{reportUrl && <div className="report-preview"><div className="report-preview-heading"><strong>Returned report preview</strong><a href={reportUrl} download={`truthlens-report-${reportId.replace(/[^a-z0-9._-]/gi, '-')}.pdf`}>Download again <ArrowRight /></a></div><iframe src={reportUrl} title={`Forensic report ${reportId}`} /></div>}<Link className="button button-outline" href="/workspace?section=investigations">View investigations <ArrowRight /></Link></div></section>
}

function Settings() {
  return <div className="settings-grid">
    <section className="workspace-panel settings-card"><p className="eyebrow">PROFILE</p><div className="profile-placeholder"><span><UserRound /></span><div><h2>Account profile</h2><p>Sign in and profile details require an authentication service.</p></div></div><button className="button button-outline" type="button" disabled>Edit profile</button></section>
    <section className="workspace-panel settings-card"><p className="eyebrow">SECURITY</p><h2>Account security</h2><p>Password changes, active sessions, and sign-out are unavailable until authentication is connected.</p><div className="settings-actions"><button className="button button-outline" type="button" disabled>Change password</button><button className="button button-outline" type="button" disabled>Sign out</button></div></section>
    <section className="workspace-panel settings-card"><p className="eyebrow">NOTIFICATIONS</p><h2>Notification preferences</h2><p>Notification preferences can be configured after an account service is connected.</p><label className="settings-disabled-option"><input type="checkbox" disabled /> Investigation updates</label></section>
  </div>
}

export default function WorkspaceShell() {
  const searchParams = useSearchParams()
  const section = searchParams.get('section') ?? 'overview'
  const investigationId = searchParams.get('investigation')
  const reportQuery = searchParams.get('report') ?? ''
  const [menuOpen, setMenuOpen] = useState(false)
  const page = sectionTitles[section] ? section : 'overview'
  const pageTitle = investigationId ? { title: 'Investigation details', description: 'Review only the file details and findings returned by your configured analysis service.' } : sectionTitles[page]
  const activeNav = useMemo(() => investigationId ? 'investigations' : navItems.find((item) => item.key === page)?.key ?? '', [investigationId, page])

  return <main className="workspace-shell">
    <header className="app-nav"><Brand /><nav className={`app-nav-links ${menuOpen ? 'is-open' : ''}`} aria-label="Workspace navigation">{navItems.map(({ key, label }) => <Link className={activeNav === key ? 'active' : ''} href={`/workspace?section=${key}`} key={key} onClick={() => setMenuOpen(false)}>{label}</Link>)}<Link className={page === 'cross-modal' && !investigationId ? 'active' : ''} href="/workspace?section=cross-modal" onClick={() => setMenuOpen(false)}>Cross-modal</Link></nav><div className="app-nav-actions"><button type="button" className="icon-button" aria-label="Notifications" disabled><Bell /></button><Link className="profile-button" href="/workspace?section=settings"><span className="profile-avatar">T</span><span>Account</span><ChevronDown /></Link></div><button className="mobile-menu-button app-menu-toggle" type="button" aria-label={menuOpen ? 'Close workspace navigation' : 'Open workspace navigation'} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X /> : <Menu />}</button></header>
    <div className="workspace-main"><div className="workspace-title-row"><div><p className="eyebrow">TRUTHLENS WORKSPACE</p><h1>{pageTitle.title}</h1><p>{pageTitle.description}</p></div><Link className="button button-dark workspace-new" href="/workspace?section=image-analysis"><Plus /> New investigation</Link></div>
      {investigationId ? <InvestigationDetails id={investigationId} /> : <>
        {page === 'overview' && <Overview />}
        {page === 'investigations' && <Investigations />}
        {['image-analysis', 'video-analysis', 'audio-analysis', 'cross-modal'].includes(page) && <UploadWorkspace section={page} />}
        {page === 'reports' && <Reports key={reportQuery} initialId={reportQuery} />}
        {page === 'settings' && <Settings />}
      </>}
      <footer className="workspace-footer"><span>TruthLens · Evidence-led review</span><span>Analysis findings are not absolute proof.</span><Link href="mailto:hello@truthlens.ai">Help &amp; support</Link></footer>
    </div>
  </main>
}
