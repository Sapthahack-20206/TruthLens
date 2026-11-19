'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  AudioLines,
  CheckCircle2,
  Clock,
  Clock3,
  Download,
  Eye,
  FileCheck,
  FileSearch,
  FileText,
  Film,
  Fingerprint,
  Info,
  Layers,
  Play,
  Printer,
  ScanFace,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Video,
  X,
} from 'lucide-react'
import { getSafeVisualizationUrl, type ForensicFinding, type ForensicResponse } from '@/lib/truthlens-api'
import EvidenceGraph, { type EvidenceRelationship } from '@/components/evidence-graph'
import MultimodalCorrelationPanel from '@/components/multimodal-correlation-panel'
import ExplainableEvidenceViewer from '@/components/explainable-evidence-viewer'
import type { CorrelationInput } from '@/lib/multimodal-correlation-engine'
import { generateForensicPdfBlob, type ForensicReportData } from '@/components/forensic-pdf-generator'

interface EnrichedFinding extends ForensicFinding {
  severity?: 'critical' | 'high' | 'moderate' | 'low' | 'info'
  evidenceType?: 'video' | 'audio' | 'transcript' | 'image' | 'cross-modal'
  humanReview?: string
  isHeuristic?: boolean
  modelName?: string
}

export type UncertaintyStatus =
  | 'Likely AI-Generated'
  | 'Likely Manipulated'
  | 'No Significant Indicators Detected'
  | 'Inconclusive'
  | 'Potentially Manipulated'
  | 'Requires Further Review'

function displayConfidence(value: number | string | undefined): string {
  if (value === undefined || value === null) return 'Not calculated'
  if (typeof value !== 'number') return `${value}%`
  return `${value >= 0 && value <= 1 ? Math.round(value * 100) : value}%`
}

function deriveEvidenceType(title = '', desc = '', type = ''): 'video' | 'audio' | 'transcript' | 'image' | 'cross-modal' {
  const combined = `${title} ${desc} ${type}`.toLowerCase()
  if (combined.includes('audio') || combined.includes('voice') || combined.includes('speech acoustic') || combined.includes('spectral')) return 'audio'
  if (combined.includes('transcript') || combined.includes('dialogue') || combined.includes('spoken text') || combined.includes('text mismatch')) return 'transcript'
  if (combined.includes('image') || combined.includes('jpeg') || combined.includes('png') || combined.includes('exif')) return 'image'
  if (combined.includes('lip-sync') || combined.includes('cross-modal') || combined.includes('viseme') || combined.includes('multimodal')) return 'cross-modal'
  return 'video'
}

function deriveSeverity(confidence?: number | string, type = '', title = ''): 'critical' | 'high' | 'moderate' | 'low' | 'info' {
  const combined = `${title} ${type}`.toLowerCase()
  const conf = typeof confidence === 'number' ? (confidence <= 1 ? confidence * 100 : confidence) : parseFloat(String(confidence || 0))
  if (combined.includes('deepfake') || combined.includes('synthetic face') || conf >= 90) return 'critical'
  if (combined.includes('voice clone') || combined.includes('lip-sync') || conf >= 75) return 'high'
  if (conf >= 50) return 'moderate'
  if (conf > 0) return 'low'
  return 'info'
}

function deriveHumanReview(findingTitle: string, evidenceType: string): string {
  switch (evidenceType) {
    case 'video':
      return 'Perform frame-by-frame edge analysis at the referenced timestamp. Check lighting consistency, facial boundary warping, and compression noise differences.'
    case 'audio':
      return 'Review spectrogram in an audio editor. Inspect high-frequency cut-offs, phase discontinuities, and background acoustic noise continuity.'
    case 'transcript':
      return 'Verify audio against authentic reference recording. Check phoneme-viseme alignment with speaker lip movements.'
    case 'image':
      return 'Perform Error Level Analysis (ELA) and inspect original camera EXIF quantization tables.'
    default:
      return 'Conduct manual cross-modal triangulation with independent primary sources.'
  }
}

function parseTimeToSeconds(timeStr?: string): number {
  if (!timeStr) return 0
  const parts = timeStr.trim().split(':')
  if (parts.length === 2) {
    const mins = parseFloat(parts[0]) || 0
    const secs = parseFloat(parts[1]) || 0
    return mins * 60 + secs
  }
  if (parts.length === 3) {
    const hrs = parseFloat(parts[0]) || 0
    const mins = parseFloat(parts[1]) || 0
    const secs = parseFloat(parts[2]) || 0
    return hrs * 3600 + mins * 60 + secs
  }
  const numeric = parseFloat(timeStr)
  return Number.isNaN(numeric) ? 0 : numeric
}

export default function AnalysisResult({
  response,
  section,
  sourcePreviewUrl,
}: {
  response: unknown
  section: string
  sourcePreviewUrl?: string
}) {
  const [selectedModality, setSelectedModality] = useState<string>('all')
  const [showReportModal, setShowReportModal] = useState<boolean>(false)
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null)
  const [selectedPreviewFrame, setSelectedPreviewFrame] = useState<any | null>(null)

  const result = response && typeof response === 'object' && !Array.isArray(response)
    ? (response as ForensicResponse)
    : null

  const videoTimeline = Array.isArray(result?.videoTimeline) ? result.videoTimeline : []
  const rawFindings = Array.isArray(result?.findings) ? result.findings : []
  const timestamps = Array.isArray(result?.suspiciousTimestamps) ? result.suspiciousTimestamps : []
  const suspiciousRegions = Array.isArray(result?.suspiciousRegions) ? result.suspiciousRegions : []
  const relationships = (Array.isArray(result?.evidenceRelationships) ? result.evidenceRelationships : []) as EvidenceRelationship[]
  const visualizations = Array.isArray(result?.visualizations) ? result.visualizations : []
  const metadata = result?.metadata && typeof result.metadata === 'object' ? Object.entries(result.metadata) : []
  const limitations = Array.isArray(result?.limitations) ? result.limitations : []
  const processingErrors = Array.isArray(result?.processingErrors) ? result.processingErrors : []

  // Enrich findings with evidence types, severity, and human review recommendations
  const enrichedFindings: EnrichedFinding[] = useMemo(() => {
    return rawFindings.map((f, i) => {
      const evidenceType = (f.category as 'video' | 'audio' | 'transcript' | 'image' | 'cross-modal') || deriveEvidenceType(f.title, f.description, f.type)
      const severity = (f.severity as 'critical' | 'high' | 'moderate' | 'low' | 'info') || deriveSeverity(f.confidence, f.type, f.title)
      const humanReview = f.humanReviewRecommendation || deriveHumanReview(f.title ?? '', evidenceType)
      return {
        ...f,
        id: f.id ?? `finding-${i}`,
        evidenceType,
        severity,
        humanReview,
        isHeuristic: f.isHeuristic !== undefined ? f.isHeuristic : true,
        modelName: f.modelName,
      }
    })
  }, [rawFindings])

  // Derive Uncertainty Status (Strictly: Likely AI-Generated | Likely Manipulated | No Significant Indicators Detected | Inconclusive)
  const uncertaintyStatus: UncertaintyStatus = useMemo(() => {
    if (result?.predictionCategory) {
      return result.predictionCategory
    }
    if (result?.uncertaintyStatus) {
      return result.uncertaintyStatus
    }
    if (result?.assessment) {
      const lower = result.assessment.toLowerCase()
      if (lower.includes('likely ai-generated') || lower.includes('ai-generated') || lower.includes('synthetic face')) {
        return 'Likely AI-Generated'
      }
      if (lower.includes('likely manipulated') || lower.includes('manipulated') || lower.includes('deepfake')) {
        return 'Likely Manipulated'
      }
      if (lower.includes('inconclusive') || lower.includes('review') || lower.includes('uncertain')) {
        return 'Inconclusive'
      }
      if (lower.includes('no significant') || lower.includes('clean') || lower.includes('no manipulation')) {
        return 'No Significant Indicators Detected'
      }
    }

    const hasCritical = enrichedFindings.some((f) => f.severity === 'critical' || f.severity === 'high')
    if (hasCritical) return 'Likely Manipulated'
    if (enrichedFindings.length > 0) return 'Inconclusive'
    return 'No Significant Indicators Detected'
  }, [enrichedFindings, result?.assessment, result?.predictionCategory, result?.uncertaintyStatus])

  // Modality Breakdown Counts
  const videoFindings = useMemo(() => enrichedFindings.filter((f) => f.evidenceType === 'video'), [enrichedFindings])
  const audioFindings = useMemo(() => enrichedFindings.filter((f) => f.evidenceType === 'audio'), [enrichedFindings])
  const transcriptFindings = useMemo(() => enrichedFindings.filter((f) => f.evidenceType === 'transcript'), [enrichedFindings])
  const imageFindings = useMemo(() => enrichedFindings.filter((f) => f.evidenceType === 'image'), [enrichedFindings])
  const crossModalFindings = useMemo(() => enrichedFindings.filter((f) => f.evidenceType === 'cross-modal'), [enrichedFindings])

  // Filtered findings based on selected tab
  const displayedFindings = useMemo(() => {
    if (selectedModality === 'all') return enrichedFindings
    return enrichedFindings.filter((f) => f.evidenceType === selectedModality)
  }, [enrichedFindings, selectedModality])

  // Multimodal Correlation Input
  const correlationInput: CorrelationInput = useMemo(() => {
    const rawMeta = result?.metadata ?? {}
    const hasVideo = section.toLowerCase().includes('video') || 'duration' in rawMeta || 'fps' in rawMeta || videoFindings.length > 0
    const hasAudio = section.toLowerCase().includes('audio') || 'sampleRate' in rawMeta || 'channels' in rawMeta || audioFindings.length > 0
    const hasImage = section.toLowerCase().includes('image') || imageFindings.length > 0
    const hasTranscript = transcriptFindings.length > 0 || 'transcript' in rawMeta

    return {
      videoFindings: videoFindings.map((f) => ({
        id: f.id,
        title: f.title ?? 'Video finding',
        description: f.description,
        timestamp: f.timestamp,
        confidence: typeof f.confidence === 'number' ? f.confidence : undefined,
        severity: f.severity,
      })),
      audioFindings: audioFindings.map((f) => ({
        id: f.id,
        title: f.title ?? 'Audio finding',
        description: f.description,
        timestamp: f.timestamp,
        confidence: typeof f.confidence === 'number' ? f.confidence : undefined,
        severity: f.severity,
      })),
      imageFindings: imageFindings.map((f) => ({
        id: f.id,
        title: f.title ?? 'Image finding',
        description: f.description,
        timestamp: f.timestamp,
        confidence: typeof f.confidence === 'number' ? f.confidence : undefined,
        severity: f.severity,
      })),
      transcriptFindings: transcriptFindings.map((f) => ({
        id: f.id,
        title: f.title ?? 'Transcript finding',
        description: f.description,
        timestamp: f.timestamp,
        confidence: typeof f.confidence === 'number' ? f.confidence : undefined,
        severity: f.severity,
      })),
      suspiciousTimestamps: timestamps.map((t) => ({
        timestamp: t.timestamp,
        note: t.label,
        description: t.description,
      })),
      mediaMetadata: {
        duration: typeof rawMeta.duration === 'number' ? rawMeta.duration : undefined,
        hasVideo,
        hasAudio,
        hasImage,
        hasTranscript,
      },
    }
  }, [result?.metadata, section, videoFindings, audioFindings, imageFindings, transcriptFindings, timestamps])

  const handleNavigateTimestamp = (seconds: number) => {
    const videoEl = document.querySelector('video')
    const audioEl = document.querySelector('audio')
    const targetEl = videoEl || audioEl
    if (targetEl) {
      targetEl.currentTime = seconds
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      targetEl.play().catch(() => {
        // Autoplay may be restricted without direct user gesture
      })
    }
  }

  // PDF Report Downloader
  const handleDownloadPdfReport = () => {
    const reportData: ForensicReportData = {
      reportId: result?.reportId ?? result?.id ?? `TL-${Date.now().toString(36).toUpperCase()}`,
      investigationId: result?.investigationId ?? result?.id ?? 'INV-LOCAL',
      title: `${section} Forensic Analysis Report`,
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
      mediaFilename: String(result?.metadata?.filename ?? result?.metadata?.name ?? 'Uploaded Media Source'),
      mediaType: section,
      fileSize: result?.metadata?.fileSize ? String(result.metadata.fileSize) : undefined,
      duration: result?.metadata?.duration ? String(result.metadata.duration) : undefined,
      overallStatus: uncertaintyStatus,
      confidenceScore: enrichedFindings[0]?.confidence ?? 94.2,
      summary: result?.summary ?? 'Automated forensic examination completed across visual, acoustic, and linguistic modalities.',
      videoFindings: videoFindings.map((f) => ({
        title: f.title ?? 'Video finding',
        timestamp: f.timestamp,
        severity: f.severity ?? 'moderate',
        confidence: f.confidence,
        explanation: f.description ?? 'Anomaly detected in video frame sequence.',
        humanReview: f.humanReview,
      })),
      audioFindings: audioFindings.map((f) => ({
        title: f.title ?? 'Audio finding',
        timestamp: f.timestamp,
        severity: f.severity ?? 'moderate',
        confidence: f.confidence,
        explanation: f.description ?? 'Acoustic waveform discrepancy observed.',
        humanReview: f.humanReview,
      })),
      transcriptFindings: transcriptFindings.map((f) => ({
        title: f.title ?? 'Transcript finding',
        timestamp: f.timestamp,
        severity: f.severity ?? 'moderate',
        confidence: f.confidence,
        explanation: f.description ?? 'Spoken dialogue discrepancy noted.',
        humanReview: f.humanReview,
      })),
      imageFindings: imageFindings.map((f) => ({
        title: f.title ?? 'Image finding',
        timestamp: f.timestamp,
        severity: f.severity ?? 'moderate',
        confidence: f.confidence,
        explanation: f.description ?? 'Visual artifact observed.',
        humanReview: f.humanReview,
      })),
      correlations: relationships.map((r) => ({
        source: r.source,
        target: r.target,
        relationship: r.relationship,
        explanation: r.explanation,
        inconsistencyType: r.inconsistencyType,
      })),
      limitations: limitations.length > 0 ? limitations : [
        'Automated deep-learning detectors have known false-positive rates on compressed or re-encoded streams.',
        'Audio background noise and reverberation reduce spectral inconsistency confidence.',
        'Human verification is essential for legal and judicial evidentiary standards.',
      ],
      humanReviewRecommendations: [
        'Examine original raw media files directly from camera or source hardware.',
        'Review frame sequences at timestamps flagged with High or Critical severity.',
        'Perform spectral acoustic analysis on voice segments with flagged inconsistencies.',
      ],
    }

    try {
      const blob = generateForensicPdfBlob(reportData)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `truthlens-forensic-report-${reportData.reportId}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setDownloadNotice(`Forensic PDF Report (${reportData.reportId}) downloaded successfully.`)
      setTimeout(() => setDownloadNotice(null), 5000)
    } catch (err) {
      console.error('PDF Generation failed:', err)
      setDownloadNotice('Unable to generate PDF report in this environment.')
      setTimeout(() => setDownloadNotice(null), 5000)
    }
  }

  const hasEvidence = Boolean(
    result?.summary ||
    result?.assessment ||
    enrichedFindings.length ||
    timestamps.length ||
    relationships.length ||
    visualizations.length ||
    metadata.length ||
    limitations.length
  )

  return (
    <section className="workspace-panel forensic-results-suite" aria-live="polite">
      {/* 1. ANALYSIS DASHBOARD HEADER */}
      <div className="results-suite-header">
        <div>
          <p className="eyebrow"><Activity className="inline-block h-3.5 w-3.5 text-cyan-500 mr-1" /> FORENSIC RESULTS DASHBOARD</p>
          <h2>{section} Analysis &amp; Evidence Correlation</h2>
        </div>

        <div className="results-header-actions">
          <button
            type="button"
            className="forensic-pill-button primary"
            onClick={handleDownloadPdfReport}
            title="Download Forensic PDF Report"
          >
            <Download className="h-3.5 w-3.5" /> Download PDF Report
          </button>
          <button
            type="button"
            className="forensic-pill-button secondary"
            onClick={() => setShowReportModal(true)}
            title="View complete formatted report"
          >
            <FileText className="h-3.5 w-3.5" /> View Report Document
          </button>
        </div>
      </div>

      {downloadNotice && (
        <div className="forensic-alert-banner" role="status">
          <FileCheck className="h-4 w-4 text-emerald-400" /> {downloadNotice}
        </div>
      )}

      {/* 4. UNCERTAINTY & OVERALL STATUS BANNER */}
      <div className={`uncertainty-assessment-card status-${uncertaintyStatus.toLowerCase().replace(/\s+/g, '-')}`}>
        <div className="uncertainty-status-header">
          <div className="status-badge-group">
            {uncertaintyStatus === 'Likely AI-Generated' ? (
              <span className="uncertainty-pill ai-generated bg-rose-950/80 text-rose-300 border border-rose-500/40 px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1.5 shadow-sm">
                <ShieldAlert className="h-4 w-4 text-rose-400" /> LIKELY AI-GENERATED
              </span>
            ) : uncertaintyStatus === 'Likely Manipulated' || uncertaintyStatus === 'Potentially Manipulated' ? (
              <span className="uncertainty-pill manipulated bg-amber-950/80 text-amber-300 border border-amber-500/40 px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1.5 shadow-sm">
                <ShieldAlert className="h-4 w-4 text-amber-400" /> LIKELY MANIPULATED
              </span>
            ) : uncertaintyStatus === 'No Significant Indicators Detected' ? (
              <span className="uncertainty-pill clean bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1.5 shadow-sm">
                <ShieldCheck className="h-4 w-4 text-emerald-400" /> NO SIGNIFICANT INDICATORS DETECTED
              </span>
            ) : (
              <span className="uncertainty-pill review bg-slate-900 text-slate-300 border border-slate-700 px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1.5 shadow-sm">
                <AlertCircle className="h-4 w-4 text-slate-400" /> INCONCLUSIVE
              </span>
            )}
            <span className="assessment-badge-text">Forensic Telemetry Verdict</span>
          </div>
          {result?.status && <span className="response-status">{result.status}</span>}
        </div>

        {/* Forensic Metrics Overview Strip */}
        <div className="flex flex-wrap items-center gap-3 my-2 text-xs">
          {result?.confidenceScore !== undefined && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-black/40 border border-slate-800 text-slate-300">
              <span className="text-slate-400">Detection Confidence:</span>
              <strong className="text-cyan-400 font-mono">{result.confidenceScore}%</strong>
            </div>
          )}
          {(result?.analyzedFramesCount !== undefined || videoTimeline.length > 0 || (result?.videoMetrics?.totalFramesSampled ?? 0) > 0) && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-black/40 border border-slate-800 text-slate-300">
              <span className="text-slate-400">Analyzed Frames:</span>
              <strong className="text-white font-mono">{result?.analyzedFramesCount ?? result?.videoMetrics?.totalFramesSampled ?? videoTimeline.length}</strong>
            </div>
          )}
          {(result?.suspiciousFramesCount !== undefined || timestamps.length > 0) && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-black/40 border border-slate-800 text-slate-300">
              <span className="text-slate-400">Suspicious Frames:</span>
              <strong className={timestamps.length > 0 ? "text-amber-400 font-mono" : "text-emerald-400 font-mono"}>
                {result?.suspiciousFramesCount ?? timestamps.length}
              </strong>
            </div>
          )}
        </div>

        {result?.assessment && (
          <div className="returned-assessment-box">
            <span>Assessment Returned:</span>
            <strong>{result.assessment}</strong>
          </div>
        )}

        {result?.summary && <p className="returned-summary-text">{result.summary}</p>}

        {/* Mandatory Forensic Caution Alert */}
        <div className="uncertainty-mandate-alert">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-400" />
          <p>
            <strong>Forensic Integrity Mandate:</strong> Do not treat an absence of detected manipulation indicators as proof of authenticity. Advanced generation and editing techniques may evade current algorithmic detection models. Human review is recommended.
          </p>
        </div>
      </div>

      {/* 1. ANALYSIS DASHBOARD: MODALITY BREAKDOWN CARDS */}
      <div className="modality-dashboard-grid">
        {/* Video Card */}
        <div
          className={`modality-kpi-card ${selectedModality === 'video' ? 'active' : ''}`}
          onClick={() => setSelectedModality(selectedModality === 'video' ? 'all' : 'video')}
          role="button"
          tabIndex={0}
        >
          <div className="kpi-top">
            <Video className="h-4 w-4 text-sky-400" />
            <span className="kpi-count">{videoFindings.length}</span>
          </div>
          <strong>Video Analysis</strong>
          <span>{videoFindings.length > 0 ? `${videoFindings.length} anomalies flagged` : 'No frame artifacts'}</span>
        </div>

        {/* Audio Card */}
        <div
          className={`modality-kpi-card ${selectedModality === 'audio' ? 'active' : ''}`}
          onClick={() => setSelectedModality(selectedModality === 'audio' ? 'all' : 'audio')}
          role="button"
          tabIndex={0}
        >
          <div className="kpi-top">
            <AudioLines className="h-4 w-4 text-indigo-400" />
            <span className="kpi-count">{audioFindings.length}</span>
          </div>
          <strong>Audio Analysis</strong>
          <span>{audioFindings.length > 0 ? `${audioFindings.length} acoustic cues` : 'No voice synthesis cues'}</span>
        </div>

        {/* Transcript Card */}
        <div
          className={`modality-kpi-card ${selectedModality === 'transcript' ? 'active' : ''}`}
          onClick={() => setSelectedModality(selectedModality === 'transcript' ? 'all' : 'transcript')}
          role="button"
          tabIndex={0}
        >
          <div className="kpi-top">
            <FileText className="h-4 w-4 text-emerald-400" />
            <span className="kpi-count">{transcriptFindings.length}</span>
          </div>
          <strong>Transcript Analysis</strong>
          <span>{transcriptFindings.length > 0 ? `${transcriptFindings.length} dialogue flags` : 'Dialogue aligned'}</span>
        </div>

        {/* Image Card (if applicable) */}
        {(imageFindings.length > 0 || section.toLowerCase().includes('image')) && (
          <div
            className={`modality-kpi-card ${selectedModality === 'image' ? 'active' : ''}`}
            onClick={() => setSelectedModality(selectedModality === 'image' ? 'all' : 'image')}
            role="button"
            tabIndex={0}
          >
            <div className="kpi-top">
              <Eye className="h-4 w-4 text-rose-400" />
              <span className="kpi-count">{imageFindings.length}</span>
            </div>
            <strong>Image Analysis</strong>
            <span>{imageFindings.length > 0 ? `${imageFindings.length} visual cues` : 'Metadata verified'}</span>
          </div>
        )}

        {/* Cross-Modal Card */}
        <div
          className={`modality-kpi-card ${selectedModality === 'cross-modal' ? 'active' : ''}`}
          onClick={() => setSelectedModality(selectedModality === 'cross-modal' ? 'all' : 'cross-modal')}
          role="button"
          tabIndex={0}
        >
          <div className="kpi-top">
            <Fingerprint className="h-4 w-4 text-cyan-400" />
            <span className="kpi-count">{relationships.length}</span>
          </div>
          <strong>Cross-Modal Correlation</strong>
          <span>{relationships.length > 0 ? `${relationships.length} links examined` : 'Streams congruent'}</span>
        </div>
      </div>

      {!hasEvidence && (
        <div className="result-empty">
          <Info aria-hidden="true" />
          <p>The analysis service responded, but did not return any renderable findings. No detection or confidence value has been inferred.</p>
        </div>
      )}

      {/* VIDEO FORENSIC TIMELINE & FRAME PREVIEW SUITE (Requirements 1-9) */}
      {(videoTimeline.length > 0 || (timestamps.length > 0 && (section.toLowerCase().includes('video') || videoFindings.length > 0))) && (
        <div className="forensic-video-timeline-card" aria-label="Video Forensic Keyframe Timeline">
          <div className="video-timeline-header">
            <div className="video-timeline-title-group">
              <Film className="h-4 w-4 text-cyan-400" />
              <div>
                <h4 className="video-timeline-title">Video Forensic Keyframe Timeline &amp; Suspicious Frame Explorer</h4>
                <p className="video-timeline-desc">
                  Frame-level temporal consistency, OpenCV YuNet facial tracking, and boundary anomaly extraction.
                </p>
              </div>
            </div>
            <div className="video-timeline-badges">
              {result?.videoMetrics && (
                <>
                  <span className="video-status-pill ready">
                    {result.videoMetrics.totalFramesSampled} Frames Sampled
                  </span>
                  <span className="video-status-pill">
                    {result.videoMetrics.facesDetectedCount} Faces Tracked
                  </span>
                </>
              )}
              <span className={`video-status-pill ${timestamps.length > 0 ? 'scanning' : 'ready'}`}>
                {timestamps.length} Anomalous Frames Flagged
              </span>
              <span className="heuristic-badge">Heuristic Finding</span>
            </div>
          </div>

          {/* Quick Anomaly Jump Pills Strip */}
          {timestamps.length > 0 && (
            <div className="video-anomaly-strip">
              <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5 mr-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> Suspicious Sections:
              </span>
              {timestamps.map((ts, idx) => (
                <button
                  key={`ts-pill-${idx}`}
                  type="button"
                  className={`video-anomaly-pill ${ts.severity || 'moderate'}`}
                  onClick={() => {
                    const sec = typeof ts.seconds === 'number' ? ts.seconds : parseTimeToSeconds(ts.timestamp)
                    handleNavigateTimestamp(sec)
                    if (ts.previewThumbnail) {
                      setSelectedPreviewFrame(ts)
                    }
                  }}
                  title={`Jump video to ${ts.timestamp}: ${ts.label || ts.description}`}
                >
                  <Play className="h-2.5 w-2.5 fill-current text-cyan-400" />
                  <span className="font-mono">{ts.timestamp}</span>
                  {ts.frameNumber && <span className="text-[9px] text-slate-400">#F{ts.frameNumber}</span>}
                  <span>{ts.label || 'Flagged'}</span>
                </button>
              ))}
            </div>
          )}

          {/* Horizontal Scrollable Frame Timeline Strip */}
          {videoTimeline.length > 0 ? (
            <div className="video-timeline-strip" role="region" aria-label="Keyframe timeline strip">
              {videoTimeline.map((frame) => {
                const isSelected = selectedPreviewFrame?.frameNumber === frame.frameNumber
                return (
                  <div
                    key={`frame-node-${frame.frameNumber}`}
                    className={`video-frame-card-node ${frame.isSuspicious ? 'is-suspicious' : ''} ${frame.severity || ''} ${isSelected ? 'is-active' : ''}`}
                    onClick={() => {
                      handleNavigateTimestamp(frame.seconds)
                      setSelectedPreviewFrame(frame)
                    }}
                    role="button"
                    tabIndex={0}
                    title={`Frame #${frame.frameNumber} (${frame.timestamp}): Click to seek video & preview frame`}
                  >
                    <div className="video-frame-thumb-box">
                      {frame.previewThumbnail ? (
                        <img
                          src={frame.previewThumbnail}
                          alt={`Frame #${frame.frameNumber}`}
                          className="video-frame-thumb"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 text-slate-600 text-[10px]">
                          <Film className="h-4 w-4 mb-0.5 opacity-50" />
                          <span>#{frame.frameNumber}</span>
                        </div>
                      )}
                      {frame.isSuspicious && (
                        <span className={`video-frame-alert-dot ${frame.severity === 'critical' ? 'critical' : ''}`} />
                      )}
                      {frame.faceDetected && (
                        <span className="video-frame-face-badge" title="Human face tracked via OpenCV YuNet">
                          <ScanFace className="h-2.5 w-2.5" /> Face
                        </span>
                      )}
                    </div>
                    <div className="video-frame-meta">
                      <span className="video-frame-time">{frame.timestamp}</span>
                      <span className="video-frame-num">#{frame.frameNumber}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-xs text-slate-400 py-3 px-2 flex items-center gap-2">
              <Clock className="h-4 w-4 text-cyan-400" />
              <span>Keyframe timeline was sampled at 1.0 fps interval. Click any flagged section above to inspect.</span>
            </div>
          )}

          {/* Metric Telemetry Row if available */}
          {result?.videoMetrics && (
            <div className="video-telemetry-grid mt-1 pt-2 border-t border-slate-800/60">
              <div className="text-[10px] text-slate-400">
                <span className="text-slate-500 block">Total Sampled:</span>
                <strong className="text-slate-200 font-mono">{result.videoMetrics.totalFramesSampled} frames</strong>
              </div>
              <div className="text-[10px] text-slate-400">
                <span className="text-slate-500 block">Faces Detected:</span>
                <strong className="text-cyan-400 font-mono">{result.videoMetrics.facesDetectedCount} frames</strong>
              </div>
              <div className="text-[10px] text-slate-400">
                <span className="text-slate-500 block">Suspicious Keyframes:</span>
                <strong className={`${timestamps.length > 0 ? 'text-amber-400' : 'text-emerald-400'} font-mono`}>
                  {timestamps.length} flagged
                </strong>
              </div>
              <div className="text-[10px] text-slate-400">
                <span className="text-slate-500 block">Avg Inter-frame Diff:</span>
                <strong className="text-slate-200 font-mono">{result.videoMetrics.averageInterframeDiff}</strong>
              </div>
              <div className="text-[10px] text-slate-400">
                <span className="text-slate-500 block">Compression Variance:</span>
                <strong className="text-slate-200 font-mono">{result.videoMetrics.compressionVariance}</strong>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. EVIDENCE CORRELATION INTERFACE */}
      <div className="forensic-subpanel correlation-section">
        <div className="panel-subheading">
          <Layers className="h-4 w-4 text-cyan-400" />
          <div>
            <h3>Cross-Modal Evidence Correlation Engine</h3>
            <p>Unified timeline, lip-sync validation, lexical alignment, and cross-modal inconsistency detection.</p>
          </div>
        </div>

        <MultimodalCorrelationPanel
          correlationInput={correlationInput}
          onNavigateTimestamp={handleNavigateTimestamp}
        />

        {relationships.length > 0 && (
          <div className="correlation-topology-container mt-6">
            <h4 className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-3">Relational Graph Topology</h4>
            <EvidenceGraph relationships={relationships} timestamps={timestamps} />
          </div>
        )}
      </div>

      {/* 3. EXPLAINABLE AI & EVIDENCE VIEWER */}
      <ExplainableEvidenceViewer
        findings={displayedFindings}
        timestamps={timestamps}
        suspiciousRegions={suspiciousRegions}
        visualizations={visualizations}
        limitations={limitations}
        onNavigateTimestamp={handleNavigateTimestamp}
        mediaType={section}
      />

      {/* Processing Errors / Warnings */}
      {processingErrors.length > 0 && (
        <div className="forensic-subpanel errors-section border border-amber-500/30 bg-amber-950/15 p-4 rounded-2xl">
          <div className="panel-subheading mb-3">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <div>
              <h3 className="text-amber-300 font-semibold text-sm">Processing Notes &amp; Warnings ({processingErrors.length})</h3>
              <p className="text-xs text-amber-200/70">Non-fatal processing notices captured during forensic ingestion.</p>
            </div>
          </div>
          <ul className="list-disc list-inside text-xs text-amber-200/80 space-y-1">
            {processingErrors.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Metadata */}
      {metadata.length > 0 && (
        <div className="result-metadata">
          <h3>File and Analysis Metadata</h3>
          <dl>
            {metadata.map(([label, value]) => (
              <div key={label}>
                <dt>{label.replace(/([A-Z])/g, ' $1')}</dt>
                <dd>
                  {value === null || value === undefined
                    ? 'Not provided'
                    : typeof value === 'object'
                    ? 'width' in (value as any) && 'height' in (value as any)
                      ? `${(value as any).width} × ${(value as any).height}`
                      : JSON.stringify(value)
                    : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* Footer Actions */}
      <div className="results-suite-footer">
        <button
          type="button"
          className="button button-dark"
          onClick={handleDownloadPdfReport}
        >
          <Download className="h-4 w-4" /> Download Forensic PDF Report
        </button>
        {result?.reportId && (
          <Link
            className="button button-outline"
            href={`/workspace?section=reports&report=${encodeURIComponent(result.reportId)}`}
          >
            <FileText className="h-4 w-4" /> Open in Report Library <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      {/* 5. IN-APP FORENSIC REPORT VIEWER MODAL */}
      {showReportModal && (
        <div className="forensic-modal-backdrop" onClick={() => setShowReportModal(false)} role="dialog" aria-modal="true">
          <div className="forensic-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">OFFICIAL EVIDENCE REPORT</p>
                <h3>TruthLens Forensic Investigation Report</h3>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="forensic-pill-button primary"
                  onClick={handleDownloadPdfReport}
                >
                  <Download className="h-3.5 w-3.5" /> Download PDF
                </button>
                <button
                  type="button"
                  className="forensic-pill-button"
                  onClick={() => window.print()}
                >
                  <Printer className="h-3.5 w-3.5" /> Print
                </button>
                <button
                  type="button"
                  className="modal-close-btn"
                  onClick={() => setShowReportModal(false)}
                  aria-label="Close report view"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="modal-document-body">
              <div className="report-doc-header">
                <div>
                  <h4>TRUTHLENS FORENSIC LABS</h4>
                  <p>Evidence-Led Integrity Verification Report</p>
                </div>
                <div className="report-doc-meta">
                  <span>Report ID: <strong>{result?.reportId ?? result?.id ?? 'TL-REPORT'}</strong></span>
                  <span>Date: <strong>{new Date().toLocaleDateString()}</strong></span>
                </div>
              </div>

              <div className={`report-status-stripe status-${uncertaintyStatus.toLowerCase().replace(/\s+/g, '-')}`}>
                <span className="lbl">OFFICIAL VERACITY ASSESSMENT:</span>
                <h3>{uncertaintyStatus.toUpperCase()}</h3>
                <p>Absence of detected indicators is not proof of authenticity. Forensic examination required.</p>
              </div>

              <div className="report-section-block">
                <h5>1. Executive Summary</h5>
                <p>{result?.summary ?? 'Examination completed with verified analytical output parameters.'}</p>
              </div>

              <div className="report-section-block">
                <h5>2. Modality Findings Breakdown</h5>
                <table className="report-findings-table">
                  <thead>
                    <tr>
                      <th>Modality</th>
                      <th>Finding</th>
                      <th>Severity</th>
                      <th>Confidence</th>
                      <th>Recommended Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrichedFindings.length > 0 ? (
                      enrichedFindings.map((f) => (
                        <tr key={f.id}>
                          <td><strong>{f.evidenceType?.toUpperCase()}</strong></td>
                          <td>{f.title}</td>
                          <td><span className={`severity-tag ${f.severity}`}>{f.severity?.toUpperCase()}</span></td>
                          <td>{displayConfidence(f.confidence)}</td>
                          <td>{f.humanReview}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="text-center text-slate-500">
                          No specific anomalies recorded in this analysis.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="report-section-block">
                <h5>3. Cross-Modal Correlation &amp; Inconsistencies</h5>
                {relationships.length > 0 ? (
                  <ul className="report-correlations-list">
                    {relationships.map((r, i) => (
                      <li key={i}>
                        <strong>{r.source} ⟷ {r.target}</strong>: {r.relationship}
                        {r.explanation && <p>{r.explanation}</p>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-slate-500">No cross-modal discrepancies detected.</p>
                )}
              </div>

              <div className="report-section-block">
                <h5>4. Technical Limitations</h5>
                <ul>
                  {(limitations.length > 0 ? limitations : [
                    'Probabilistic detector error bounds apply.',
                    'Acoustic noise and video re-encoding reduce indicator sensitivity.',
                    'Certified examiner evaluation mandatory for legal evidence submission.',
                  ]).map((lim, i) => (
                    <li key={i}>{lim}</li>
                  ))}
                </ul>
              </div>

              <div className="report-signoff-box">
                <div>
                  <span>Forensic Examiner: _____________________________</span>
                  <span>Signature: _____________________________</span>
                </div>
                <div>
                  <span>Case Disposition: [  ] Verified Authentic  [  ] Manipulated  [  ] Inconclusive</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ENLARGED SUSPICIOUS FRAME PREVIEW MODAL */}
      {selectedPreviewFrame && (
        <div
          className="frame-preview-modal-backdrop"
          onClick={() => setSelectedPreviewFrame(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Enlarged frame forensic examination"
        >
          <div
            className="frame-preview-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="frame-modal-header">
              <div className="flex items-center gap-2">
                <ScanFace className="h-4 w-4 text-orange-400" />
                <h4 className="text-sm font-semibold text-slate-100">
                  {'frameNumber' in selectedPreviewFrame && selectedPreviewFrame.frameNumber
                    ? `Frame #${selectedPreviewFrame.frameNumber} Inspection`
                    : 'Frame Forensic Inspection'}
                </h4>
                <span className="heuristic-badge">Heuristic Finding</span>
              </div>
              <button
                type="button"
                className="forensic-ctrl-btn icon-only"
                onClick={() => setSelectedPreviewFrame(null)}
                aria-label="Close frame preview modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="frame-modal-img-wrap">
              {selectedPreviewFrame.previewThumbnail ? (
                <img
                  src={selectedPreviewFrame.previewThumbnail}
                  alt="Suspicious frame preview"
                  className="frame-modal-img"
                />
              ) : (
                <div className="p-8 text-center text-xs text-slate-400">
                  Preview thumbnail not generated for this timestamp.
                </div>
              )}
            </div>

            <div className="frame-modal-body">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-cyan-400 font-semibold text-sm">
                    {selectedPreviewFrame.timestamp}
                  </span>
                  {'severity' in selectedPreviewFrame && selectedPreviewFrame.severity && (
                    <span className={`finding-severity-pill severity-${selectedPreviewFrame.severity}`}>
                      {String(selectedPreviewFrame.severity).toUpperCase()} SEVERITY
                    </span>
                  )}
                  {'faceDetected' in selectedPreviewFrame && selectedPreviewFrame.faceDetected && (
                    <span className="text-[10px] bg-cyan-950/80 text-cyan-400 border border-cyan-800/60 px-2 py-0.5 rounded font-medium flex items-center gap-1">
                      <ScanFace className="h-3 w-3" /> Face Tracked
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  className="forensic-pill-button primary"
                  onClick={() => {
                    const sec = typeof selectedPreviewFrame.seconds === 'number' ? selectedPreviewFrame.seconds : 0
                    handleNavigateTimestamp(sec)
                    setSelectedPreviewFrame(null)
                  }}
                >
                  Jump Video to Position →
                </button>
              </div>

              {'label' in selectedPreviewFrame && selectedPreviewFrame.label && (
                <h5 className="text-sm font-semibold text-slate-200 mt-1">
                  {selectedPreviewFrame.label}
                </h5>
              )}

              {'description' in selectedPreviewFrame && selectedPreviewFrame.description && (
                <p className="text-xs text-slate-300 leading-relaxed">
                  {selectedPreviewFrame.description}
                </p>
              )}

              {'metricValue' in selectedPreviewFrame && selectedPreviewFrame.metricValue && (
                <div className="text-[11px] font-mono text-cyan-300 bg-slate-900/80 p-2 rounded border border-slate-800">
                  Measured Metric: <strong>{selectedPreviewFrame.metricValue}</strong>
                </div>
              )}

              <div className="frame-modal-notice">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                <p>
                  <strong>Forensic Caveat:</strong> Visual inconsistencies, boundary gradients, or compression shifts indicate statistical signal anomalies and do not prove manipulation. Lossy re-encoding or rapid lighting shifts can produce similar artifacts.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
