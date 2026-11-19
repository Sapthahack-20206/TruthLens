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
  Database,
  Eye,
  FileSearch,
  FileText,
  Filter,
  Fingerprint,
  HelpCircle,
  Info,
  Layers,
  Link2,
  ShieldAlert,
  Sparkles,
  Video,
} from 'lucide-react'
import {
  executeMultimodalCorrelation,
  type CorrelationInput,
  type CorrelationResult,
  type TimelineEvent,
  type StandardizedStreamEvidence,
} from '@/lib/multimodal-correlation-engine'

interface MultimodalCorrelationPanelProps {
  correlationInput: CorrelationInput
  onNavigateTimestamp?: (seconds: number) => void
}

export default function MultimodalCorrelationPanel({
  correlationInput,
  onNavigateTimestamp,
}: MultimodalCorrelationPanelProps) {
  const [viewMode, setViewMode] = useState<'combined' | 'timeline' | 'separate' | 'sources'>('combined')
  const [selectedSeparateModality, setSelectedSeparateModality] = useState<'video' | 'audio' | 'image' | 'transcript'>('video')
  const [selectedTimelineEvent, setSelectedTimelineEvent] = useState<TimelineEvent | null>(null)

  const correlationResult: CorrelationResult = useMemo(() => {
    return executeMultimodalCorrelation(correlationInput)
  }, [correlationInput])

  const {
    summary,
    timeline,
    separateFindings,
    combinedFindings,
    inconclusiveReasons,
    standardizedSources,
  } = correlationResult

  const { evidenceFusion } = summary

  return (
    <div className="multimodal-correlation-container" aria-label="Multimodal Correlation Engine">
      {/* 1. EVIDENCE FUSION & CORRELATION SUMMARY CARD */}
      <div className="correlation-summary-card">
        <div className="summary-header-row">
          <div className="summary-title-group">
            <span className="summary-eyebrow">
              <Sparkles className="h-3 w-3 text-cyan-400" /> MULTIMODAL FORENSIC INTELLIGENCE ENGINE
            </span>
            <h3 className="summary-main-heading">Evidence Fusion &amp; Cross-Modal Triangulation</h3>
          </div>

          <div className="flex items-center gap-3">
            <div className="co-occurring-counter">
              <span className="counter-num">{summary.coOccurringAnomalyCount}</span>
              <span className="counter-label">Cross-Modal Findings</span>
            </div>
            <div className="co-occurring-counter border-cyan-800/40">
              <span className="counter-num text-cyan-300">{evidenceFusion.fusedConfidence}%</span>
              <span className="counter-label">Fused Confidence</span>
            </div>
          </div>
        </div>

        {/* Evidence Fusion Executive Banner */}
        <div className={`p-3.5 rounded-lg border flex flex-col gap-2.5 ${
          evidenceFusion.contradictionDetected
            ? 'bg-rose-950/20 border-rose-500/40 text-rose-200'
            : evidenceFusion.fusedVerdict === 'Likely AI-Generated'
            ? 'bg-purple-950/20 border-purple-500/40 text-purple-200'
            : evidenceFusion.fusedVerdict === 'Likely Manipulated'
            ? 'bg-amber-950/20 border-amber-500/40 text-amber-200'
            : evidenceFusion.fusedVerdict === 'Inconclusive'
            ? 'bg-slate-900/40 border-slate-700/50 text-slate-300'
            : 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
        }`}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              {evidenceFusion.contradictionDetected ? (
                <ShieldAlert className="h-4 w-4 text-rose-400" />
              ) : (
                <Sparkles className="h-4 w-4 text-cyan-400" />
              )}
              <span className="text-xs font-semibold tracking-wide uppercase">
                Fused Evidential Assessment: <strong>{evidenceFusion.fusedVerdict}</strong>
              </span>
            </div>
            <span className="text-xs px-2 py-0.5 rounded bg-black/40 border border-white/10 font-mono">
              Primary Driver: {evidenceFusion.primaryTriggerModality.toUpperCase()}
            </span>
          </div>

          <p className="text-xs leading-relaxed text-slate-300 m-0">
            {evidenceFusion.fusionRationale}
          </p>

          {/* Contradiction Alert Callout */}
          {evidenceFusion.contradictionDetected && evidenceFusion.contradictionExplanation && (
            <div className="p-2.5 bg-rose-900/30 border border-rose-500/50 rounded flex items-start gap-2 text-rose-200 text-xs">
              <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <strong>Cross-Stream Contradiction Detected:</strong>{' '}
                <span>{evidenceFusion.contradictionExplanation}</span>
              </div>
            </div>
          )}

          {/* Modality Contributions Breakdown */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-white/5">
            {evidenceFusion.modalityContributions.video && (
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800 text-[11px]">
                <div className="flex items-center gap-1 text-slate-400 font-medium">
                  <Video className="h-3 w-3 text-sky-400" /> Video Signal
                </div>
                <div className="text-slate-200 font-semibold mt-0.5">
                  {evidenceFusion.modalityContributions.video.score}% ({evidenceFusion.modalityContributions.video.status})
                </div>
                <div className="text-[10px] text-slate-500">
                  Reliability: {(evidenceFusion.modalityContributions.video.reliability * 100).toFixed(0)}%
                </div>
              </div>
            )}
            {evidenceFusion.modalityContributions.audio && (
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800 text-[11px]">
                <div className="flex items-center gap-1 text-slate-400 font-medium">
                  <AudioLines className="h-3 w-3 text-indigo-400" /> Audio Signal
                </div>
                <div className="text-slate-200 font-semibold mt-0.5">
                  {evidenceFusion.modalityContributions.audio.score}% ({evidenceFusion.modalityContributions.audio.status})
                </div>
                <div className="text-[10px] text-slate-500">
                  Reliability: {(evidenceFusion.modalityContributions.audio.reliability * 100).toFixed(0)}%
                </div>
              </div>
            )}
            {evidenceFusion.modalityContributions.image && (
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800 text-[11px]">
                <div className="flex items-center gap-1 text-slate-400 font-medium">
                  <Eye className="h-3 w-3 text-cyan-400" /> Image Signal
                </div>
                <div className="text-slate-200 font-semibold mt-0.5">
                  {evidenceFusion.modalityContributions.image.score}% ({evidenceFusion.modalityContributions.image.status})
                </div>
                <div className="text-[10px] text-slate-500">
                  Reliability: {(evidenceFusion.modalityContributions.image.reliability * 100).toFixed(0)}%
                </div>
              </div>
            )}
            {evidenceFusion.modalityContributions.transcript && (
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800 text-[11px]">
                <div className="flex items-center gap-1 text-slate-400 font-medium">
                  <FileText className="h-3 w-3 text-emerald-400" /> Transcript Signal
                </div>
                <div className="text-slate-200 font-semibold mt-0.5">
                  {evidenceFusion.modalityContributions.transcript.score}% ({evidenceFusion.modalityContributions.transcript.status})
                </div>
                <div className="text-[10px] text-slate-500">
                  Reliability: {(evidenceFusion.modalityContributions.transcript.reliability * 100).toFixed(0)}%
                </div>
              </div>
            )}
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

          {/* Facial Reference Assessment */}
          <div className="specialized-card">
            <div className="spec-top">
              <span className="spec-lbl">FACIAL &amp; STRUCTURAL REFERENCE CHECK</span>
              {summary.facialReferenceAssessment === 'consistent_identity' ? (
                <span className="spec-pill clean"><CheckCircle2 className="h-3 w-3" /> CONSISTENT</span>
              ) : summary.facialReferenceAssessment === 'divergence_detected' ? (
                <span className="spec-pill alert"><AlertTriangle className="h-3 w-3" /> DIVERGENCE</span>
              ) : (
                <span className="spec-pill inconclusive"><Info className="h-3 w-3" /> NO REFERENCE STILL</span>
              )}
            </div>
            <p className="spec-desc">
              {summary.facialReferenceAssessment === 'divergence_detected'
                ? 'Still reference image displays authentic sensor noise, while video keyframes exhibit neural face replacement and boundary seams.'
                : summary.facialReferenceAssessment === 'consistent_identity'
                ? 'Biometric landmarks and facial geometry across still image and video keyframes show consistent identity characteristics.'
                : 'No separate still reference image was provided in this submission bundle.'}
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
          <button
            type="button"
            className={`view-tab ${viewMode === 'sources' ? 'active' : ''}`}
            onClick={() => setViewMode('sources')}
          >
            <Database className="h-3.5 w-3.5" /> Standardized Evidence ({standardizedSources.length})
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
              {combinedFindings.map((cf, cIdx) => (
                <div key={`${cf.id}-${cIdx}`} className={`combined-finding-card severity-${cf.severity}`}>
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

                  {/* Why Flagged */}
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

      {/* 4. UNIFIED FORENSIC TIMELINE VIEW */}
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
                    key={`${ev.id}-${index}`}
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

      {/* 5. SEPARATE FINDINGS VIEW */}
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
              separateFindings[selectedSeparateModality].map((f, fIdx) => (
                <div key={`${f.id}-${fIdx}`} className="separate-finding-item">
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

      {/* 6. STANDARDIZED EVIDENCE SOURCES VIEW (Requirement 1 & 2) */}
      {viewMode === 'sources' && (
        <div className="standardized-sources-section">
          <div className="timeline-header-info mb-4">
            <h4>Standardized Multimodal Evidence Collection</h4>
            <p>Cryptographic integrity hashes, analytical models, and detection boundaries for each ingested stream.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {standardizedSources.map((src) => (
              <div key={src.sourceId} className="bg-slate-900/70 border border-slate-800 rounded-lg p-3.5 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {src.mediaType === 'video' && <Video className="h-4 w-4 text-sky-400" />}
                    {src.mediaType === 'audio' && <AudioLines className="h-4 w-4 text-indigo-400" />}
                    {src.mediaType === 'image' && <Eye className="h-4 w-4 text-cyan-400" />}
                    {src.mediaType === 'transcript' && <FileText className="h-4 w-4 text-emerald-400" />}
                    <strong className="text-sm text-slate-200">{src.filename}</strong>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded uppercase font-semibold bg-slate-800 text-slate-300">
                    {src.mediaType}
                  </span>
                </div>

                {src.sha256 && (
                  <div className="text-[11px] text-slate-400 font-mono bg-black/40 p-1.5 rounded border border-white/5 break-all">
                    SHA-256: {src.sha256}
                  </div>
                )}

                <div className="text-xs text-slate-300 flex flex-col gap-1">
                  <div>
                    <span className="text-slate-500">Forensic Model:</span> <strong>{src.modelInfo.name}</strong>{' '}
                    <span className="text-[10px] text-slate-500">v{src.modelInfo.version || '1.0'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Model Reliability Weight:</span>{' '}
                    <strong>{(src.modelInfo.reliabilityWeight * 100).toFixed(0)}%</strong>{' '}
                    <span className="text-slate-500">({src.modelInfo.isHeuristic ? 'Heuristic' : 'Neural Pipeline'})</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Findings Count:</span>{' '}
                    <strong>{src.findings.length}</strong> indicator{src.findings.length === 1 ? '' : 's'}
                  </div>
                </div>

                {src.limitations.length > 0 && (
                  <div className="bg-amber-950/20 border border-amber-500/20 rounded p-2 text-[11px] text-amber-200">
                    <span className="font-semibold">Stream Limitation:</span> {src.limitations[0]}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 7. INCONCLUSIVE REASONS & TECHNICAL CAVEATS */}
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
