'use client'

import React, { useMemo, useState } from 'react'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  AudioLines,
  CheckCircle2,
  Clock,
  Eye,
  FileSearch,
  FileText,
  Filter,
  Fingerprint,
  Info,
  Layers,
  Link2,
  Sparkles,
  Video,
} from 'lucide-react'
import {
  executeMultimodalCorrelation,
  type CorrelationInput,
  type CorrelationResult,
  type TimelineEvent,
} from '@/lib/multimodal-correlation-engine'

interface MultimodalCorrelationPanelProps {
  correlationInput: CorrelationInput
  onNavigateTimestamp?: (seconds: number) => void
}

export default function MultimodalCorrelationPanel({
  correlationInput,
  onNavigateTimestamp,
}: MultimodalCorrelationPanelProps) {
  const [viewMode, setViewMode] = useState<'combined' | 'timeline' | 'separate'>('combined')
  const [selectedSeparateModality, setSelectedSeparateModality] = useState<'video' | 'audio' | 'image' | 'transcript'>('video')
  const [selectedTimelineEvent, setSelectedTimelineEvent] = useState<TimelineEvent | null>(null)

  const correlationResult: CorrelationResult = useMemo(() => {
    return executeMultimodalCorrelation(correlationInput)
  }, [correlationInput])

  const { summary, timeline, separateFindings, combinedFindings, inconclusiveReasons } = correlationResult

  return (
    <div className="multimodal-correlation-container" aria-label="Multimodal Correlation Engine">
      {/* 1. MULTIMODAL EVIDENCE SUMMARY CARD */}
      <div className="correlation-summary-card">
        <div className="summary-header-row">
          <div className="summary-title-group">
            <span className="summary-eyebrow">
              <Sparkles className="h-3 w-3 text-cyan-400" /> MULTIMODAL TRIANGULATION ENGINE
            </span>
            <h3 className="summary-main-heading">Evidence Stream Correlation &amp; Integrity Summary</h3>
          </div>

          <div className="co-occurring-counter">
            <span className="counter-num">{summary.coOccurringAnomalyCount}</span>
            <span className="counter-label">Correlated Anomalies</span>
          </div>
        </div>

        <p className="summary-narrative">{summary.narrativeSummary}</p>

        {/* Stream Health & Availability Chips */}
        <div className="streams-status-strip">
          <div className={`stream-chip ${summary.videoStreamStatus === 'analyzed' ? 'active' : 'inactive'}`}>
            <Video className="h-3.5 w-3.5" />
            <span>Video Stream: <strong>{summary.videoStreamStatus.toUpperCase()}</strong></span>
          </div>

          <div className={`stream-chip ${summary.audioStreamStatus === 'analyzed' ? 'active' : 'inactive'}`}>
            <AudioLines className="h-3.5 w-3.5" />
            <span>Audio Stream: <strong>{summary.audioStreamStatus.toUpperCase()}</strong></span>
          </div>

          <div className={`stream-chip ${summary.transcriptStatus === 'aligned' ? 'active' : summary.transcriptStatus === 'discrepancy_detected' ? 'warning' : 'inactive'}`}>
            <FileText className="h-3.5 w-3.5" />
            <span>Transcript: <strong>{summary.transcriptStatus.toUpperCase().replace('_', ' ')}</strong></span>
          </div>

          <div className={`stream-chip ${summary.imageStatus === 'analyzed' ? 'active' : 'inactive'}`}>
            <Eye className="h-3.5 w-3.5" />
            <span>Image Stream: <strong>{summary.imageStatus.toUpperCase()}</strong></span>
          </div>
        </div>

        {/* Specialized Inconsistency Assessments */}
        <div className="specialized-assessments-grid">
          {/* Lip-Sync Assessment */}
          <div className="specialized-card">
            <div className="spec-top">
              <span className="spec-lbl">LIP-SYNC INTEGRITY CHECK</span>
              {summary.lipSyncAssessment === 'no_mismatch_detected' ? (
                <span className="spec-pill clean"><CheckCircle2 className="h-3 w-3" /> CONGRUENT</span>
              ) : summary.lipSyncAssessment === 'potential_mismatch_flagged' ? (
                <span className="spec-pill alert"><AlertTriangle className="h-3 w-3" /> MISMATCH FLAGGED</span>
              ) : (
                <span className="spec-pill inconclusive"><Info className="h-3 w-3" /> INCONCLUSIVE</span>
              )}
            </div>
            <p className="spec-desc">
              {summary.lipSyncAssessment === 'potential_mismatch_flagged'
                ? 'Co-occurrence detected between audio phoneme onset and video inter-frame distortion.'
                : summary.lipSyncAssessment === 'no_mismatch_detected'
                ? 'No visible phoneme-viseme temporal discrepancies detected across analyzed speech segments.'
                : 'Lip-sync analysis is technically inconclusive due to absence of paired visual face landmarks and speech timestamps.'}
            </p>
          </div>

          {/* Transcript Comparison Assessment */}
          <div className="specialized-card">
            <div className="spec-top">
              <span className="spec-lbl">TRANSCRIPT &amp; CONTEXT VERIFICATION</span>
              {summary.transcriptComparisonAssessment === 'dialogue_matches_context' ? (
                <span className="spec-pill clean"><CheckCircle2 className="h-3 w-3" /> ALIGNED</span>
              ) : summary.transcriptComparisonAssessment === 'discrepancy_detected' ? (
                <span className="spec-pill alert"><AlertTriangle className="h-3 w-3" /> DISCREPANCY</span>
              ) : (
                <span className="spec-pill inconclusive"><Info className="h-3 w-3" /> INCONCLUSIVE</span>
              )}
            </div>
            <p className="spec-desc">
              {summary.transcriptComparisonAssessment === 'discrepancy_detected'
                ? 'Discrepancy noted between user-supplied reference transcript and extracted speech audio.'
                : summary.transcriptComparisonAssessment === 'dialogue_matches_context'
                ? 'Spoken audio dialogue content aligns with supplied reference transcript.'
                : 'Transcript comparison unavailable. Upload reference context or connect automated Whisper engine.'}
            </p>
          </div>
        </div>

        {/* Mandatory Forensic Caution Banner */}
        <div className="correlation-mandate-box">
          <AlertCircle className="h-4 w-4 flex-shrink-0 text-amber-500" />
          <p>
            <strong>Evidentiary Mandate:</strong> {summary.correlationCaveat}
          </p>
        </div>
      </div>

      {/* 2. NAVIGATION & VIEW MODE CONTROLS */}
      <div className="correlation-view-toolbar">
        <div className="view-mode-tabs">
          <button
            type="button"
            className={`view-tab ${viewMode === 'combined' ? 'active' : ''}`}
            onClick={() => setViewMode('combined')}
          >
            <Link2 className="h-3.5 w-3.5" /> Combined Correlations ({combinedFindings.length})
          </button>
          <button
            type="button"
            className={`view-tab ${viewMode === 'timeline' ? 'active' : ''}`}
            onClick={() => setViewMode('timeline')}
          >
            <Clock className="h-3.5 w-3.5" /> Unified Timeline ({timeline.length})
          </button>
          <button
            type="button"
            className={`view-tab ${viewMode === 'separate' ? 'active' : ''}`}
            onClick={() => setViewMode('separate')}
          >
            <Layers className="h-3.5 w-3.5" /> Separate Modalities
          </button>
        </div>

        {onNavigateTimestamp && (
          <span className="nav-hint-badge">
            <Clock className="h-3 w-3 text-cyan-400" /> Click any timestamp to seek media
          </span>
        )}
      </div>

      {/* 3. COMBINED CORRELATIONS VIEW */}
      {viewMode === 'combined' && (
        <div className="combined-correlations-section">
          {combinedFindings.length > 0 ? (
            <div className="combined-cards-grid">
              {combinedFindings.map((cf) => (
                <div key={cf.id} className={`combined-finding-card severity-${cf.severity}`}>
                  <div className="cf-card-header">
                    <div className="cf-badges-row">
                      <span className={`severity-tag ${cf.severity}`}>{cf.severity.toUpperCase()}</span>
                      <span className="inconsistency-type-pill">{cf.inconsistencyType.toUpperCase().replace('-', ' ')}</span>
                      <span className="support-level-tag">{cf.technicalSupportLevel === 'verified_signals' ? 'VERIFIED SIGNALS' : 'HEURISTIC'}</span>
                    </div>

                    {cf.timestamp && (
                      <button
                        type="button"
                        className="timestamp-seek-btn"
                        onClick={() => cf.seconds !== undefined && onNavigateTimestamp?.(cf.seconds)}
                        title={`Seek media to ${cf.timestamp}`}
                      >
                        <Clock className="h-3.5 w-3.5 text-cyan-400" />
                        <span>{cf.timestamp}</span>
                        <ArrowRight className="h-3 w-3 text-slate-400" />
                      </button>
                    )}
                  </div>

                  <h4 className="cf-title">{cf.title}</h4>
                  <p className="cf-explanation">{cf.explanation}</p>

                  {/* Why Flagged (Requirement 9) */}
                  <div className="cf-why-flagged-box">
                    <span className="why-label">WHY THIS CORRELATION WAS FLAGGED:</span>
                    <p>{cf.whyFlagged}</p>
                  </div>

                  {/* Actionable Human Review Recommendation */}
                  <div className="cf-human-review-box">
                    <span className="review-label">RECOMMENDED HUMAN REVIEW:</span>
                    <p>{cf.humanReviewAction}</p>
                  </div>

                  <div className="cf-footer-row">
                    <div className="modalities-involved-tags">
                      <span>Streams Involved:</span>
                      {cf.modalitiesInvolved.map((m) => (
                        <span key={m} className={`modality-micro-tag ${m}`}>{m.toUpperCase()}</span>
                      ))}
                    </div>
                    {cf.confidence && (
                      <span className="cf-confidence">Confidence: <strong>{cf.confidence}%</strong></span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="correlation-empty-state">
              <CheckCircle2 className="h-6 w-6 text-slate-400" />
              <h4>No Multi-Stream Inconsistencies Detected</h4>
              <p>
                Visual frames, acoustic frequencies, and speech segments exhibit no co-occurring contradictions within temporal tolerances.
              </p>
            </div>
          )}
        </div>
      )}

      {/* 4. UNIFIED FORENSIC TIMELINE VIEW (Requirement 6) */}
      {viewMode === 'timeline' && (
        <div className="unified-timeline-section">
          <div className="timeline-header-info">
            <h4>Unified Chronological Forensic Timeline</h4>
            <p>Chronologically correlated events across Video, Audio, and Extracted Transcript streams.</p>
          </div>

          {timeline.length > 0 ? (
            <div className="chronological-timeline-wrapper">
              {timeline.map((ev, index) => {
                const isSelected = selectedTimelineEvent?.id === ev.id
                return (
                  <div
                    key={ev.id}
                    className={`timeline-entry-row ${ev.isCombined ? 'is-combined' : ''} ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => {
                      setSelectedTimelineEvent(ev)
                      if (onNavigateTimestamp) onNavigateTimestamp(ev.seconds)
                    }}
                  >
                    {/* Timestamp Node Column */}
                    <div className="timeline-node-col">
                      <button
                        type="button"
                        className="timeline-time-badge"
                        onClick={(e) => {
                          e.stopPropagation()
                          onNavigateTimestamp?.(ev.seconds)
                        }}
                        title={`Seek to ${ev.timestamp}`}
                      >
                        <Clock className="h-3 w-3" />
                        <span>{ev.timestamp}</span>
                      </button>
                      <div className="timeline-connector-line" />
                    </div>

                    {/* Content Column */}
                    <div className="timeline-content-card">
                      <div className="timeline-card-top">
                        <div className="timeline-modality-tags">
                          {ev.modalities.map((m) => (
                            <span key={m} className={`modality-micro-tag ${m}`}>{m.toUpperCase()}</span>
                          ))}
                          {ev.isCombined && <span className="combined-badge">COMBINED CORRELATION</span>}
                        </div>
                        <span className={`severity-tag ${ev.severity}`}>{ev.severity.toUpperCase()}</span>
                      </div>

                      <strong className="timeline-entry-title">{ev.title}</strong>
                      <p className="timeline-entry-desc">{ev.description}</p>

                      {ev.correlationReason && (
                        <div className="timeline-why-box">
                          <span>Correlation rationale:</span> {ev.correlationReason}
                        </div>
                      )}

                      {ev.evidenceRef && (
                        <span className="timeline-ref-text">Ref: {ev.evidenceRef}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="correlation-empty-state">
              <Clock className="h-6 w-6 text-slate-400" />
              <h4>No Temporal Events Recorded</h4>
              <p>No timestamped forensic markers were detected in this analysis.</p>
            </div>
          )}
        </div>
      )}

      {/* 5. SEPARATE FINDINGS VIEW (Requirement 7) */}
      {viewMode === 'separate' && (
        <div className="separate-modalities-section">
          {/* Sub-tabs for individual modalities */}
          <div className="separate-modality-tabs">
            <button
              type="button"
              className={`sep-tab ${selectedSeparateModality === 'video' ? 'active' : ''}`}
              onClick={() => setSelectedSeparateModality('video')}
            >
              <Video className="h-3.5 w-3.5" /> Video Findings ({separateFindings.video.length})
            </button>
            <button
              type="button"
              className={`sep-tab ${selectedSeparateModality === 'audio' ? 'active' : ''}`}
              onClick={() => setSelectedSeparateModality('audio')}
            >
              <AudioLines className="h-3.5 w-3.5" /> Audio Findings ({separateFindings.audio.length})
            </button>
            <button
              type="button"
              className={`sep-tab ${selectedSeparateModality === 'transcript' ? 'active' : ''}`}
              onClick={() => setSelectedSeparateModality('transcript')}
            >
              <FileText className="h-3.5 w-3.5" /> Transcript Findings ({separateFindings.transcript.length})
            </button>
            <button
              type="button"
              className={`sep-tab ${selectedSeparateModality === 'image' ? 'active' : ''}`}
              onClick={() => setSelectedSeparateModality('image')}
            >
              <Eye className="h-3.5 w-3.5" /> Image Findings ({separateFindings.image.length})
            </button>
          </div>

          <div className="separate-findings-list">
            {separateFindings[selectedSeparateModality].length > 0 ? (
              separateFindings[selectedSeparateModality].map((f) => (
                <div key={f.id} className="separate-finding-item">
                  <div className="item-top">
                    <strong className="item-title">{f.title}</strong>
                    <div className="item-meta">
                      {f.timestamp && (
                        <button
                          type="button"
                          className="item-time-btn"
                          onClick={() => {
                            const secs = parseFloat(f.timestamp || '0')
                            if (!isNaN(secs)) onNavigateTimestamp?.(secs)
                          }}
                        >
                          <Clock className="h-3 w-3" /> {f.timestamp}
                        </button>
                      )}
                      <span className={`severity-tag ${f.severity}`}>{f.severity.toUpperCase()}</span>
                    </div>
                  </div>
                  <p className="item-desc">{f.description}</p>
                  {f.confidence && (
                    <span className="item-conf">Confidence: <strong>{f.confidence}%</strong></span>
                  )}
                </div>
              ))
            ) : (
              <div className="separate-empty-box">
                <Info className="h-4 w-4 text-slate-400" />
                <span>No specific {selectedSeparateModality} anomalies detected for this evidence file.</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 6. INCONCLUSIVE REASONS & TECHNICAL CAVEATS (Requirement 10) */}
      {inconclusiveReasons.length > 0 && (
        <div className="inconclusive-boundaries-panel">
          <div className="inconclusive-header">
            <Info className="h-4 w-4 text-slate-400" />
            <h5>Inconclusive Boundaries &amp; Missing Streams</h5>
          </div>
          <ul className="inconclusive-list">
            {inconclusiveReasons.map((reason, idx) => (
              <li key={idx}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
