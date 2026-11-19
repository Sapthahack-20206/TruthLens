'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  AudioLines,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileSearch,
  FileText,
  Image as ImageIcon,
  Layers,
  Plus,
  RefreshCw,
  ShieldCheck,
  Video,
} from 'lucide-react'
import type { InvestigationRecord, SafeUser } from '@/lib/truthlens-api'

interface UserDashboardProps {
  user: SafeUser | null
  isGuest: boolean
  records: InvestigationRecord[]
  isLoading: boolean
  error: Error | null
  onRefresh?: () => void
}

function formatDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Recently'
  const now = Date.now()
  const diffMinutes = Math.floor((now - date.getTime()) / (60 * 1000))
  if (diffMinutes < 1) return 'Just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}h ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function UserDashboard({
  user,
  isGuest,
  records,
  isLoading,
  error,
  onRefresh,
}: UserDashboardProps) {
  // Compute real statistics from actual analysis records
  const stats = useMemo(() => {
    const total = records.length
    const imageCount = records.filter((r) => r.mediaType === 'image').length
    const videoCount = records.filter((r) => r.mediaType === 'video').length
    const audioCount = records.filter((r) => r.mediaType === 'audio').length
    const reviewCount = records.filter((r) => r.requiresReview === true).length
    const cleanCount = records.filter((r) => r.requiresReview === false).length

    const imagePct = total > 0 ? Math.round((imageCount / total) * 100) : 0
    const videoPct = total > 0 ? Math.round((videoCount / total) * 100) : 0
    const audioPct = total > 0 ? Math.round((audioCount / total) * 100) : 0

    return {
      total,
      imageCount,
      videoCount,
      audioCount,
      reviewCount,
      cleanCount,
      imagePct,
      videoPct,
      audioPct,
    }
  }, [records])

  const recentInvestigations = useMemo(() => records.slice(0, 6), [records])
  const recentReports = useMemo(
    () => records.filter((r) => Boolean(r.reportId)).slice(0, 4),
    [records]
  )

  const displayName = user?.name || (isGuest ? 'Guest Investigator' : 'Analyst')
  const userRole = user?.role === 'lead_analyst'
    ? 'Lead Forensic Analyst'
    : user?.role === 'investigator'
      ? 'Digital Forensics Examiner'
      : isGuest
        ? 'Guest Sandbox'
        : 'Forensics Specialist'

  return (
    <div className="user-dashboard-root">
      {/* 1. Welcome & Operational Banner */}
      <section className="dashboard-welcome-banner">
        <div className="welcome-text-col">
          <div className="analyst-badge-row">
            <span className="analyst-status-dot" />
            <span className="analyst-role-pill">{userRole}</span>
            {isGuest && (
              <span className="guest-tag">
                Sandbox Mode · <Link href="/login" className="guest-login-link">Sign in to save permanently</Link>
              </span>
            )}
          </div>
          <h2>Welcome back, {displayName}</h2>
          <p>
            TruthLens Evidence Engine · All forensic indicators are calculated deterministically or via validated neural models.
          </p>
        </div>

        <div className="dashboard-quick-actions">
          {onRefresh && (
            <button
              type="button"
              className="refresh-dashboard-btn"
              onClick={onRefresh}
              title="Refresh analysis totals"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Refresh</span>
            </button>
          )}
          <Link href="/workspace?section=video-analysis" className="btn-dash-primary">
            <Plus className="h-4 w-4" />
            <span>New Video Scan</span>
          </Link>
          <Link href="/workspace?section=cross-modal" className="btn-dash-primary" style={{ background: '#0284c7' }}>
            <Layers className="h-4 w-4" />
            <span>Tri-Modal Scan</span>
          </Link>
        </div>
      </section>

      {/* Error state */}
      {error && (
        <div className="dashboard-error-banner" role="alert">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <span>Unable to connect to analysis records service. Displaying cached records if available.</span>
        </div>
      )}

      {/* 2. Key Forensic Metrics Grid */}
      <section className="dashboard-kpi-grid">
        <div className="kpi-card total-card">
          <div className="kpi-top">
            <span className="kpi-label">Total Investigations</span>
            <span className="kpi-icon-wrap total">
              <FileSearch className="h-4 w-4" />
            </span>
          </div>
          <div className="kpi-value-row">
            <strong className="kpi-num">{isLoading ? '—' : stats.total}</strong>
          </div>
          <span className="kpi-subtext">Total verified media submissions</span>
        </div>

        <div className="kpi-card image-card">
          <div className="kpi-top">
            <span className="kpi-label">Images Analysed</span>
            <span className="kpi-icon-wrap image">
              <ImageIcon className="h-4 w-4" />
            </span>
          </div>
          <div className="kpi-value-row">
            <strong className="kpi-num">{isLoading ? '—' : stats.imageCount}</strong>
            <span className="kpi-share">{stats.imagePct}% of total</span>
          </div>
          <span className="kpi-subtext">ELA &amp; ViT facial localization</span>
        </div>

        <div className="kpi-card video-card">
          <div className="kpi-top">
            <span className="kpi-label">Videos Analysed</span>
            <span className="kpi-icon-wrap video">
              <Video className="h-4 w-4" />
            </span>
          </div>
          <div className="kpi-value-row">
            <strong className="kpi-num">{isLoading ? '—' : stats.videoCount}</strong>
            <span className="kpi-share">{stats.videoPct}% of total</span>
          </div>
          <span className="kpi-subtext">Keyframe temporal extraction</span>
        </div>

        <div className="kpi-card audio-card">
          <div className="kpi-top">
            <span className="kpi-label">Audio Analysed</span>
            <span className="kpi-icon-wrap audio">
              <AudioLines className="h-4 w-4" />
            </span>
          </div>
          <div className="kpi-value-row">
            <strong className="kpi-num">{isLoading ? '—' : stats.audioCount}</strong>
            <span className="kpi-share">{stats.audioPct}% of total</span>
          </div>
          <span className="kpi-subtext">Acoustic spectrogram &amp; synthetic voice</span>
        </div>

        <div className="kpi-card review-card">
          <div className="kpi-top">
            <span className="kpi-label">Flagged for Review</span>
            <span className="kpi-icon-wrap review">
              <AlertTriangle className="h-4 w-4" />
            </span>
          </div>
          <div className="kpi-value-row">
            <strong className="kpi-num">{isLoading ? '—' : stats.reviewCount}</strong>
            <span className="kpi-share warning">{stats.reviewCount > 0 ? 'Requires Examiner' : 'None'}</span>
          </div>
          <span className="kpi-subtext">Anomalies or heuristic triggers</span>
        </div>

        <div className="kpi-card clean-card">
          <div className="kpi-top">
            <span className="kpi-label">Standard / Clean</span>
            <span className="kpi-icon-wrap clean">
              <CheckCircle2 className="h-4 w-4" />
            </span>
          </div>
          <div className="kpi-value-row">
            <strong className="kpi-num">{isLoading ? '—' : stats.cleanCount}</strong>
            <span className="kpi-share success">No major triggers</span>
          </div>
          <span className="kpi-subtext">Passed automated baseline checks</span>
        </div>
      </section>

      {/* 3. Modality Distribution & Multi-Modal Progress */}
      {stats.total > 0 && (
        <section className="modality-distribution-card">
          <div className="distribution-header">
            <div>
              <h3>Modality Analysis Distribution</h3>
              <p>Breakdown of evidentiary source formats processed across investigations.</p>
            </div>
            <div className="distribution-legend">
              <span className="legend-item"><span className="legend-dot img" /> Images ({stats.imageCount})</span>
              <span className="legend-item"><span className="legend-dot vid" /> Videos ({stats.videoCount})</span>
              <span className="legend-item"><span className="legend-dot aud" /> Audio ({stats.audioCount})</span>
            </div>
          </div>

          <div className="modality-bar-track">
            {stats.imagePct > 0 && (
              <div
                className="modality-bar-segment img"
                style={{ width: `${stats.imagePct}%` }}
                title={`Images: ${stats.imagePct}%`}
              />
            )}
            {stats.videoPct > 0 && (
              <div
                className="modality-bar-segment vid"
                style={{ width: `${stats.videoPct}%` }}
                title={`Videos: ${stats.videoPct}%`}
              />
            )}
            {stats.audioPct > 0 && (
              <div
                className="modality-bar-segment aud"
                style={{ width: `${stats.audioPct}%` }}
                title={`Audio: ${stats.audioPct}%`}
              />
            )}
          </div>
        </section>
      )}

      {/* 4. Recent Analysis Activities (Full Available Width) */}
      <section className="dashboard-subpanel recent-activities-panel">
          <div className="panel-subheading">
            <div className="subheading-left">
              <Activity className="h-4 w-4 text-cyan-400" />
              <div>
                <h3>Recent Analysis Activities</h3>
                <p>Latest files examined by the deepfake and synthetic media forensic pipeline.</p>
              </div>
            </div>
            <Link href="/workspace?section=investigations" className="view-all-link">
              View History <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {isLoading ? (
            <div className="dashboard-loading-state">
              <div className="pulse-skeleton-row" />
              <div className="pulse-skeleton-row" />
              <div className="pulse-skeleton-row" />
            </div>
          ) : recentInvestigations.length > 0 ? (
            <div className="recent-activity-list">
              {recentInvestigations.map((rec) => {
                const Icon = rec.mediaType === 'video'
                  ? Video
                  : rec.mediaType === 'audio'
                    ? AudioLines
                    : ImageIcon

                const isFlagged = rec.requiresReview === true
                return (
                  <div key={rec.id} className="activity-row-card">
                    <div className="activity-icon-container">
                      <Icon className="h-4 w-4" />
                    </div>

                    <div className="activity-details">
                      <div className="activity-title-line">
                        <strong className="activity-filename" title={rec.filename}>
                          {rec.filename}
                        </strong>
                        <span className={`status-pill ${isFlagged ? 'flagged' : 'passed'}`}>
                          {isFlagged ? 'Review Requested' : 'Completed'}
                        </span>
                      </div>

                      <div className="activity-meta-line">
                        <span className="media-type-tag">{rec.mediaType.toUpperCase()}</span>
                        <span className="dot-sep">·</span>
                        <span className="meta-time">
                          <Clock3 className="h-3 w-3 inline mr-1 opacity-70" />
                          {formatDate(rec.createdAt)}
                        </span>
                        <span className="dot-sep">·</span>
                        <span className="meta-id">{rec.id}</span>
                      </div>

                      {rec.assessment && (
                        <p className="activity-assessment-snippet">{rec.assessment}</p>
                      )}
                    </div>

                    <div className="activity-actions">
                      <Link
                        href={`/workspace?investigation=${encodeURIComponent(rec.id)}`}
                        className="btn-activity-view"
                      >
                        View Results
                      </Link>
                      {rec.reportId && (
                        <Link
                          href={`/workspace?section=reports&report=${encodeURIComponent(rec.reportId)}`}
                          className="btn-activity-report"
                          title="Open Forensic Report"
                        >
                          <FileText className="h-3.5 w-3.5" />
                        </Link>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="dashboard-empty-card">
              <span className="empty-glyph-wrap">
                <FileSearch className="h-6 w-6 text-slate-400" />
              </span>
              <h4>No analysis records yet</h4>
              <p>Upload an image, video, or audio file to begin your first automated forensic examination.</p>
              <Link href="/workspace?section=image-analysis" className="btn-dash-primary mt-2">
                <Plus className="h-3.5 w-3.5" /> Start New Investigation
              </Link>
            </div>
          )}
        </section>

      {/* 5. Balanced Secondary Grid: Forensic Reports & Forensic Modality Launchpad */}
      <div className="dashboard-secondary-grid">
        {/* Recent Reports Card */}
        <section className="dashboard-subpanel recent-reports-panel">
            <div className="panel-subheading">
              <div className="subheading-left">
                <FileText className="h-4 w-4 text-emerald-400" />
                <div>
                  <h3>Forensic Reports</h3>
                  <p>Certified investigation exports</p>
                </div>
              </div>
              <Link href="/workspace?section=reports" className="view-all-link">
                All Reports <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            {recentReports.length > 0 ? (
              <div className="reports-mini-list">
                {recentReports.map((rec) => (
                  <div key={rec.reportId} className="report-mini-row">
                    <div className="report-mini-icon">
                      <FileText className="h-4 w-4 text-emerald-400" />
                    </div>
                    <div className="report-mini-text">
                      <strong title={rec.filename}>{rec.filename}</strong>
                      <small>Report {rec.reportId} · {formatDate(rec.createdAt)}</small>
                    </div>
                    <Link
                      href={`/workspace?section=reports&report=${encodeURIComponent(rec.reportId!)}`}
                      className="report-open-btn"
                      title="Open and download PDF"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mini-empty-notice">
                <p>Reports are generated automatically upon completed analysis.</p>
              </div>
            )}
          </section>

          {/* Quick Launchpad Card */}
          <section className="dashboard-subpanel quick-launch-panel">
            <div className="panel-subheading">
              <div className="subheading-left">
                <Layers className="h-4 w-4 text-cyan-400" />
                <div>
                  <h3>Forensic Modality Launchpad</h3>
                  <p>Direct investigation workspaces</p>
                </div>
              </div>
            </div>

            <div className="launchpad-grid">
              <Link href="/workspace?section=image-analysis" className="launchpad-item">
                <ImageIcon className="h-4 w-4 text-cyan-400" />
                <div>
                  <strong>Image Analysis</strong>
                  <small>ELA &amp; ViT face detection</small>
                </div>
              </Link>

              <Link href="/workspace?section=video-analysis" className="launchpad-item">
                <Video className="h-4 w-4 text-indigo-400" />
                <div>
                  <strong>Video Analysis</strong>
                  <small>Temporal frame inconsistencies</small>
                </div>
              </Link>

              <Link href="/workspace?section=audio-analysis" className="launchpad-item">
                <AudioLines className="h-4 w-4 text-amber-400" />
                <div>
                  <strong>Audio Analysis</strong>
                  <small>Spectral &amp; voice synthesis</small>
                </div>
              </Link>

              <Link href="/workspace?section=cross-modal" className="launchpad-item">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <div>
                  <strong>Cross-Modal Engine</strong>
                  <small>Tri-modal correlation</small>
                </div>
              </Link>
            </div>
          </section>
        </div>
      </div>
    )
  }
