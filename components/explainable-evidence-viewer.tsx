'use client'

import React, { useState, useMemo } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  AudioLines,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  ExternalLink,
  Eye,
  FileSearch,
  FileText,
  Fingerprint,
  Info,
  Layers,
  Maximize2,
  Play,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Video,
  X,
  ZoomIn,
} from 'lucide-react'
import { getSafeVisualizationUrl } from '@/lib/truthlens-api'

export interface EnrichedFindingItem {
  id?: string
  type?: string
  title?: string
  description?: string
  timestamp?: string
  frameNumber?: number
  evidenceRef?: string
  sourceRef?: string
  confidence?: number | string
  severity?: 'critical' | 'high' | 'moderate' | 'low' | 'info'
  evidenceType?: 'video' | 'audio' | 'transcript' | 'image' | 'cross-modal'
  isHeuristic?: boolean
  modelName?: string
  humanReview?: string
  humanReviewRecommendation?: string
}

export interface SuspiciousTimestampItem {
  timestamp: string
  seconds?: number
  label?: string
  description?: string
  evidenceRef?: string
  severity?: string
}

export interface SuspiciousRegionItem {
  id: string
  box: [number, number, number, number]
  deepfakeProbability?: number
  label: string
  description: string
  confidence: number
}

export interface VisualizationItem {
  label: string
  url: string
}

export interface ExplainableEvidenceViewerProps {
  findings: EnrichedFindingItem[]
  timestamps?: SuspiciousTimestampItem[]
  suspiciousRegions?: SuspiciousRegionItem[]
  visualizations?: VisualizationItem[]
  limitations?: string[]
  onNavigateTimestamp?: (seconds: number) => void
  mediaType?: string
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

function formatConfidence(confidence?: number | string): string | null {
  if (confidence === undefined || confidence === null || confidence === '') return null
  if (typeof confidence === 'number') {
    const val = confidence <= 1 && confidence > 0 ? Math.round(confidence * 100) : Math.round(confidence)
    return `${val}%`
  }
  return String(confidence)
}

export default function ExplainableEvidenceViewer({
  findings,
  timestamps = [],
  suspiciousRegions = [],
  visualizations = [],
  limitations = [],
  onNavigateTimestamp,
  mediaType = 'Media Evidence',
}: ExplainableEvidenceViewerProps) {
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'neural' | 'heuristic' | 'video' | 'audio' | 'image'>('all')
  const [expandedFindings, setExpandedFindings] = useState<Record<string, boolean>>({})
  const [activeModalImage, setActiveModalImage] = useState<{ url: string; label: string } | null>(null)
  const [showMethodologyGuide, setShowMethodologyGuide] = useState<boolean>(true)

  const toggleFinding = (id: string) => {
    setExpandedFindings((prev) => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  const expandAll = () => {
    const allExpanded: Record<string, boolean> = {}
    findings.forEach((f, i) => {
      allExpanded[f.id ?? `finding-${i}`] = true
    })
    setExpandedFindings(allExpanded)
  }

  const collapseAll = () => {
    setExpandedFindings({})
  }

  // Filtered findings list
  const filteredFindings = useMemo(() => {
    return findings.filter((f) => {
      if (selectedFilter === 'all') return true
      if (selectedFilter === 'neural') return f.isHeuristic === false
      if (selectedFilter === 'heuristic') return f.isHeuristic !== false
      if (selectedFilter === 'video') return f.evidenceType === 'video'
      if (selectedFilter === 'audio') return f.evidenceType === 'audio'
      if (selectedFilter === 'image') return f.evidenceType === 'image'
      return true
    })
  }, [findings, selectedFilter])

  const neuralCount = useMemo(() => findings.filter((f) => f.isHeuristic === false).length, [findings])
  const heuristicCount = useMemo(() => findings.filter((f) => f.isHeuristic !== false).length, [findings])

  const handleSeek = (timeStr?: string, sec?: number) => {
    if (onNavigateTimestamp) {
      const targetSec = sec !== undefined ? sec : parseTimeToSeconds(timeStr)
      onNavigateTimestamp(targetSec)
    }
  }

  return (
    <div className="explainable-evidence-viewer-container">
      {/* 1. Methodology & Classification Educational Banner (Requirement 7) */}
      <section className="evidence-classification-guide">
        <div className="guide-header-row">
          <div className="guide-title-block">
            <Sparkles className="h-4 w-4 text-cyan-400" />
            <h4>Forensic Signal Methodology &amp; Explainability Framework</h4>
          </div>
          <button
            type="button"
            className="guide-toggle-btn"
            onClick={() => setShowMethodologyGuide(!showMethodologyGuide)}
          >
            {showMethodologyGuide ? 'Hide Guidance' : 'What Do These Signals Mean?'}
          </button>
        </div>

        {showMethodologyGuide && (
          <div className="classification-trio-grid">
            {/* Neural Model Predictions */}
            <div className="classification-card neural-model-card">
              <div className="classification-card-top">
                <span className="type-icon-dot neural" />
                <strong>Neural Model Predictions</strong>
                <span className="badge-micro neural">Probabilistic</span>
              </div>
              <p>
                Generated by deep neural networks (e.g. Vision Transformer ViT, YuNet Face Detector). Evaluates high-dimensional spatial and facial embeddings.
              </p>
              <div className="card-criteria">
                <span className="criteria-label">Evidence Output:</span>
                <code>Confidence Score (0-100%) + Bounding Boxes</code>
              </div>
            </div>

            {/* Heuristic Forensic Indicators */}
            <div className="classification-card heuristic-indicator-card">
              <div className="classification-card-top">
                <span className="type-icon-dot heuristic" />
                <strong>Heuristic Forensic Indicators</strong>
                <span className="badge-micro heuristic">Deterministic</span>
              </div>
              <p>
                Algorithmic calculations of physical and mathematical properties: Error Level Analysis (ELA) compression gradients, clipping, SNR, and container metadata.
              </p>
              <div className="card-criteria">
                <span className="criteria-label">Evidence Output:</span>
                <code>Signal Metrics &amp; Visual Difference Maps</code>
              </div>
            </div>

            {/* Inconclusive Uncertainty Boundaries */}
            <div className="classification-card inconclusive-boundary-card">
              <div className="classification-card-top">
                <span className="type-icon-dot boundary" />
                <strong>Inconclusive Boundaries</strong>
                <span className="badge-micro boundary">Ethical Guardrail</span>
              </div>
              <p>
                Surfaces technical limitations where evidence is missing or insufficient (e.g. absent audio stream, low resolution). TruthLens strictly avoids fabricating scores.
              </p>
              <div className="card-criteria">
                <span className="criteria-label">Principle:</span>
                <code>Absence of Proof is NOT Proof of Authenticity</code>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 2. Visual Evidence Overlays & Inspection Gallery (Requirement 3, 4, 5) */}
      {visualizations.length > 0 && (
        <section className="forensic-subpanel visual-evidence-gallery">
          <div className="panel-subheading">
            <Eye className="h-4 w-4 text-cyan-400" />
            <div>
              <h3>Visual Evidence Overlays &amp; Feature Maps ({visualizations.length})</h3>
              <p>Direct spatial and spectral artifacts produced by neural detectors and compression difference engines.</p>
            </div>
          </div>

          <div className="visual-evidence-grid">
            {visualizations.map((item, index) => {
              const safeUrl = getSafeVisualizationUrl(item.url)
              return (
                <div key={`${item.label}-${index}`} className="visual-evidence-item">
                  <div
                    className="image-thumbnail-wrap"
                    onClick={() => safeUrl && setActiveModalImage({ url: safeUrl, label: item.label })}
                    role="button"
                    tabIndex={0}
                  >
                    {safeUrl ? (
                      <img src={safeUrl} alt={item.label} className="evidence-img" />
                    ) : (
                      <div className="img-placeholder">Visualization not locally hosted</div>
                    )}
                    <span className="zoom-hint">
                      <ZoomIn className="h-4 w-4" /> Expand
                    </span>
                  </div>
                  <div className="visual-evidence-meta">
                    <span className="visual-evidence-title">{item.label}</span>
                    {item.label.toLowerCase().includes('keyframe') && (
                      <span className="badge-mini text-cyan-300 bg-cyan-950/60 border border-cyan-800">
                        Keyframe Artifact
                      </span>
                    )}
                    {item.label.toLowerCase().includes('ela') && (
                      <span className="badge-mini text-amber-300 bg-amber-950/60 border border-amber-800">
                        JPEG ELA Difference
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* 3. Suspicious Video & Audio Timestamps Inspector (Requirement 3, 4, 8) */}
      {timestamps.length > 0 && (
        <section className="forensic-subpanel suspicious-timestamps-inspector">
          <div className="panel-subheading">
            <Clock3 className="h-4 w-4 text-amber-400" />
            <div>
              <h3>Suspicious Timestamp Sequence ({timestamps.length} points of interest)</h3>
              <p>Temporal positions where neural models or acoustic analyzers identified anomalies. Click any timestamp to jump the media player.</p>
            </div>
          </div>

          <div className="timestamps-scroll-track">
            {timestamps.map((ts, idx) => {
              const secondsVal = ts.seconds !== undefined ? ts.seconds : parseTimeToSeconds(ts.timestamp)
              const isVideo = ts.evidenceRef?.toLowerCase().includes('frame') || mediaType.toLowerCase().includes('video')
              return (
                <div key={`ts-${idx}`} className="timestamp-inspect-card">
                  <div className="timestamp-card-top">
                    <button
                      type="button"
                      className="timestamp-seek-btn"
                      onClick={() => handleSeek(ts.timestamp, secondsVal)}
                      title="Seek player to this timestamp"
                    >
                      <Play className="h-3 w-3 fill-current" />
                      <span>{ts.timestamp}</span>
                    </button>
                    {ts.severity && (
                      <span className={`severity-tag-micro severity-${ts.severity.toLowerCase()}`}>
                        {ts.severity.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <h5 className="timestamp-event-label">{ts.label || 'Flagged Event'}</h5>
                  {ts.description && <p className="timestamp-event-desc">{ts.description}</p>}
                  {ts.evidenceRef && (
                    <span className="timestamp-ref-pill">
                      {isVideo ? <Video className="h-3 w-3 text-cyan-400" /> : <AudioLines className="h-3 w-3 text-purple-400" />}
                      <span>{ts.evidenceRef}</span>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* 4. Suspicious Facial Regions (Requirement 5) */}
      {suspiciousRegions.length > 0 && (
        <section className="forensic-subpanel suspicious-regions-inspector">
          <div className="panel-subheading">
            <ShieldAlert className="h-4 w-4 text-rose-400" />
            <div>
              <h3>Localized Facial Regions of Interest ({suspiciousRegions.length})</h3>
              <p>YuNet face coordinates evaluated with Vision Transformer deepfake probability scores.</p>
            </div>
          </div>

          <div className="regions-cards-grid">
            {suspiciousRegions.map((region) => (
              <div key={region.id} className="region-inspect-card">
                <div className="region-card-top">
                  <span className="region-label">{region.label}</span>
                  <span className="region-conf-badge">
                    ViT Score: <strong>{region.confidence}%</strong>
                  </span>
                </div>
                <p className="region-desc">{region.description}</p>
                <div className="region-coord-box">
                  <code>
                    Bounding Box: [x: {region.box[0]}, y: {region.box[1]}, w: {region.box[2]}, h: {region.box[3]}]
                  </code>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 5. Comprehensive Expandable Findings Inspector (Requirement 1, 2, 6, 8, 9) */}
      <section className="forensic-subpanel findings-inspector-section">
        <div className="findings-toolbar-row">
          <div className="panel-subheading">
            <FileSearch className="h-4 w-4 text-cyan-400" />
            <div>
              <h3>Explainable Findings Inspector ({filteredFindings.length})</h3>
              <p>Transparent evidence cards detailing detection models, algorithmic reasoning, and human verification actions.</p>
            </div>
          </div>

          {/* Filtering Tabs */}
          <div className="findings-filter-strip">
            <button
              type="button"
              className={`filter-pill ${selectedFilter === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedFilter('all')}
            >
              All ({findings.length})
            </button>
            <button
              type="button"
              className={`filter-pill ${selectedFilter === 'neural' ? 'active' : ''}`}
              onClick={() => setSelectedFilter('neural')}
            >
              <Sparkles className="h-3 w-3" /> Neural ({neuralCount})
            </button>
            <button
              type="button"
              className={`filter-pill ${selectedFilter === 'heuristic' ? 'active' : ''}`}
              onClick={() => setSelectedFilter('heuristic')}
            >
              <Layers className="h-3 w-3" /> Heuristic ({heuristicCount})
            </button>
            <div className="filter-divider" />
            <button
              type="button"
              className="expand-all-link"
              onClick={expandAll}
            >
              Expand All
            </button>
            <button
              type="button"
              className="expand-all-link"
              onClick={collapseAll}
            >
              Collapse All
            </button>
          </div>
        </div>

        {/* Expandable Evidence Cards List */}
        {filteredFindings.length > 0 ? (
          <div className="expandable-cards-list">
            {filteredFindings.map((finding, idx) => {
              const findingId = finding.id ?? `finding-${idx}`
              const isExpanded = !!expandedFindings[findingId]
              const confDisplay = formatConfidence(finding.confidence)
              const hasModel = finding.isHeuristic === false && !!finding.modelName
              const secondsVal = parseTimeToSeconds(finding.timestamp)

              return (
                <article
                  key={findingId}
                  className={`evidence-card-expandable severity-${finding.severity ?? 'info'} ${isExpanded ? 'is-expanded' : ''}`}
                >
                  {/* Card Header: Always Visible Summary */}
                  <div
                    className="card-clickable-header"
                    onClick={() => toggleFinding(findingId)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="header-badges-row">
                      {/* Severity Pill */}
                      <span className={`finding-severity-pill severity-${finding.severity ?? 'info'}`}>
                        {(finding.severity ?? 'info').toUpperCase()}
                      </span>

                      {/* Evidence Modality Pill */}
                      <span className="finding-modality-pill">
                        {(finding.evidenceType ?? 'MEDIA').toUpperCase()}
                      </span>

                      {/* Methodology Origin Badge (Requirement 2 & 7) */}
                      {finding.isHeuristic === false ? (
                        <span className="origin-badge neural">
                          <Sparkles className="h-3 w-3" />
                          <span>NEURAL MODEL: {finding.modelName || 'Vision Transformer'}</span>
                        </span>
                      ) : (
                        <span className="origin-badge heuristic">
                          <Layers className="h-3 w-3" />
                          <span>HEURISTIC RULE: {finding.type || 'Deterministic Signal'}</span>
                        </span>
                      )}

                      {/* Model Confidence Score: Only when supplied by an actual model! (Requirement 6) */}
                      {confDisplay ? (
                        <span className="model-confidence-tag">
                          Model Confidence: <strong>{confDisplay}</strong>
                        </span>
                      ) : (
                        <span className="model-confidence-tag deterministic">
                          Deterministic Metric
                        </span>
                      )}

                      <div className="toggle-arrow-wrap">
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </div>

                    <h4 className="card-primary-title">
                      {finding.title ?? 'Forensic Observation'}
                    </h4>
                  </div>

                  {/* Card Body: Expandable Detail with Explainability */}
                  {isExpanded && (
                    <div className="card-expanded-body">
                      {/* 1. Observation Description */}
                      <div className="detail-section">
                        <span className="detail-label">Detailed Finding Explanation:</span>
                        <p className="detail-text">{finding.description ?? 'No granular description provided.'}</p>
                      </div>

                      {/* 2. Model / Method Technical Provenance (Requirement 2) */}
                      <div className="provenance-box">
                        <div className="provenance-row">
                          <span className="provenance-key">Analysis Method:</span>
                          <span className="provenance-val">
                            {hasModel ? `${finding.modelName} (Inference Model)` : `${finding.type || 'Deterministic Heuristic'} (Structural Analysis)`}
                          </span>
                        </div>
                        {finding.evidenceRef && (
                          <div className="provenance-row">
                            <span className="provenance-key">Evidence Reference:</span>
                            <span className="provenance-val font-mono">{finding.evidenceRef}</span>
                          </div>
                        )}
                        {finding.timestamp && (
                          <div className="provenance-row">
                            <span className="provenance-key">Temporal Anchor:</span>
                            <span className="provenance-val font-mono">{finding.timestamp}</span>
                          </div>
                        )}
                      </div>

                      {/* 3. Actionable Human Review Action */}
                      {(finding.humanReview || finding.humanReviewRecommendation) && (
                        <div className="human-action-box">
                          <div className="action-box-header">
                            <ShieldCheck className="h-4 w-4 text-emerald-400" />
                            <strong>Recommended Forensic Review Protocol</strong>
                          </div>
                          <p>{finding.humanReview || finding.humanReviewRecommendation}</p>
                        </div>
                      )}

                      {/* 4. Timestamp Navigation Action Button (Requirement 8) */}
                      {finding.timestamp && onNavigateTimestamp && (
                        <div className="card-footer-nav">
                          <button
                            type="button"
                            className="navigate-timestamp-action"
                            onClick={() => handleSeek(finding.timestamp, secondsVal)}
                          >
                            <Play className="h-3.5 w-3.5 fill-current" />
                            <span>Jump to Video/Audio at {finding.timestamp}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        ) : (
          <div className="findings-empty-notice">
            <Info className="h-4 w-4 text-slate-400" />
            <span>No findings match the selected filter. Switch filters to view other forensic observations.</span>
          </div>
        )}
      </section>

      {/* 6. Technical Limitations & Ethical Boundaries (Requirement 10) */}
      {limitations.length > 0 && (
        <section className="forensic-subpanel technical-limitations-panel">
          <div className="panel-subheading">
            <AlertCircle className="h-4 w-4 text-amber-400" />
            <div>
              <h3>Technical Boundaries &amp; Forensic Limitations ({limitations.length})</h3>
              <p>Explicit criteria where evidence was insufficient, compressed, or single-stream.</p>
            </div>
          </div>

          <div className="limitations-alert-box">
            <div className="alert-header">
              <ShieldAlert className="h-4 w-4 text-amber-300" />
              <span>Ethical AI Standard: Transparent Non-Fabrication Guarantee</span>
            </div>
            <ul className="limitations-clean-list">
              {limitations.map((lim, index) => (
                <li key={`lim-${index}`}>{lim}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Lightbox Modal for High-Resolution Visual Evidence */}
      {activeModalImage && (
        <div className="evidence-lightbox-overlay" onClick={() => setActiveModalImage(null)}>
          <div className="lightbox-content-box" onClick={(e) => e.stopPropagation()}>
            <div className="lightbox-header">
              <h5>{activeModalImage.label}</h5>
              <button
                type="button"
                className="close-lightbox-btn"
                onClick={() => setActiveModalImage(null)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="lightbox-image-wrap">
              <img src={activeModalImage.url} alt={activeModalImage.label} />
            </div>
            <div className="lightbox-footer">
              <span className="caption-text">High-resolution forensic visualization map</span>
              <a
                href={activeModalImage.url}
                target="_blank"
                rel="noreferrer"
                className="open-full-link"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open Full Image
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
