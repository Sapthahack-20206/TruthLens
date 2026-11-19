'use client'

import React, { useState, useMemo } from 'react'
import {
  FileText,
  User,
  Users,
  Clock,
  Search,
  Play,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Volume2,
  ChevronRight,
  ShieldAlert,
  Sliders,
  Sparkles,
} from 'lucide-react'
import type { ForensicResponse } from '@/lib/truthlens-api'

interface TranscriptForensicExplorerProps {
  forensicOutput?: ForensicResponse | null
  onSeekToTimestamp?: (seconds: number) => void
}

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00.00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
}

export default function TranscriptForensicExplorer({
  forensicOutput,
  onSeekToTimestamp,
}: TranscriptForensicExplorerProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSpeakerFilter, setSelectedSpeakerFilter] = useState<string>('all')
  const [expandedWordSegmentId, setExpandedWordSegmentId] = useState<string | null>(null)

  const transcription = forensicOutput?.transcription || []
  const speakerMetrics = forensicOutput?.speakerMetrics
  const transcriptMetrics = forensicOutput?.transcriptMetrics
  const findings = useMemo(() => {
    return (forensicOutput?.findings || []).filter(
      (f) => f.category === 'transcript' || (f.type && f.type.toLowerCase().includes('transcript'))
    )
  }, [forensicOutput?.findings])

  const suspiciousTimestamps = useMemo(() => {
    return (forensicOutput?.suspiciousTimestamps || []).filter(
      (t) =>
        t.label?.toLowerCase().includes('dialogue') ||
        t.label?.toLowerCase().includes('repetition') ||
        t.label?.toLowerCase().includes('silence') ||
        t.label?.toLowerCase().includes('splice')
    )
  }, [forensicOutput?.suspiciousTimestamps])

  // Filtered segments based on search and speaker
  const filteredSegments = useMemo(() => {
    return transcription.filter((seg) => {
      const matchesSearch =
        searchQuery.trim() === '' ||
        seg.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (seg.speaker && seg.speaker.toLowerCase().includes(searchQuery.toLowerCase()))
      const matchesSpeaker =
        selectedSpeakerFilter === 'all' || seg.speaker === selectedSpeakerFilter
      return matchesSearch && matchesSpeaker
    })
  }, [transcription, searchQuery, selectedSpeakerFilter])

  const totalWords = transcriptMetrics?.totalWords ?? transcription.reduce((acc, s) => acc + s.text.split(/\s+/).length, 0)
  const spokenSec = transcriptMetrics?.spokenDurationSec ?? transcription.reduce((acc, s) => acc + (s.end - s.start), 0)
  const speakersList = speakerMetrics?.speakers || []

  const handleJump = (seconds: number) => {
    if (onSeekToTimestamp) {
      onSeekToTimestamp(seconds)
    } else {
      const videoEl = document.querySelector('video')
      const audioEl = document.querySelector('audio')
      const target = videoEl || audioEl
      if (target) {
        target.currentTime = seconds
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        target.play().catch(() => {})
      }
    }
  }

  return (
    <div className="forensic-video-timeline-card" aria-label="AI Transcript & Speech Authenticity Suite">
      {/* Header */}
      <div className="video-timeline-header">
        <div className="video-timeline-title-group">
          <FileText className="h-4 w-4 text-emerald-400" />
          <div>
            <h4 className="video-timeline-title">AI Transcript Analysis &amp; Speech Authenticity Explorer</h4>
            <p className="video-timeline-desc">
              Timestamped speech-to-text recognition, acoustic speaker diarization, lexical consistency verification, and dialogue manipulation detection.
            </p>
          </div>
        </div>
        <div className="video-timeline-badges">
          <span className="video-status-pill ready">
            {transcription.length} Spoken Segments
          </span>
          <span className="video-status-pill">
            {speakerMetrics?.totalSpeakers || (transcription.length > 0 ? 1 : 0)} Speakers Diarized
          </span>
          {transcriptMetrics?.wer !== undefined && transcriptMetrics?.wer !== null && (
            <span className={`video-status-pill ${transcriptMetrics.wer > 25 ? 'scanning' : 'ready'}`}>
              WER: {transcriptMetrics.wer}%
            </span>
          )}
          <span className="heuristic-badge">Faster-Whisper Model</span>
        </div>
      </div>

      {/* Metrics Bar */}
      <div className="audio-telemetry-grid mt-3 mb-4">
        <div className="telemetry-cell">
          <span className="cell-label">Spoken Duration</span>
          <strong className="cell-val text-slate-100">{spokenSec.toFixed(2)}s</strong>
        </div>
        <div className="telemetry-cell">
          <span className="cell-label">Words Transcribed</span>
          <strong className="cell-val text-slate-100">{totalWords}</strong>
        </div>
        <div className="telemetry-cell">
          <span className="cell-label">Speech Ratio</span>
          <strong className="cell-val text-slate-100">
            {transcriptMetrics?.speechRatio ? `${(transcriptMetrics.speechRatio * 100).toFixed(1)}%` : 'Active'}
          </strong>
        </div>
        {transcriptMetrics?.wer !== undefined && transcriptMetrics?.wer !== null && (
          <div className="telemetry-cell">
            <span className="cell-label">Word Error Rate (WER)</span>
            <strong className={`cell-val ${transcriptMetrics.wer > 25 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {transcriptMetrics.wer}%
            </strong>
          </div>
        )}
        {transcriptMetrics?.cer !== undefined && transcriptMetrics?.cer !== null && (
          <div className="telemetry-cell">
            <span className="cell-label">Character Error (CER)</span>
            <strong className={`cell-val ${transcriptMetrics.cer > 20 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {transcriptMetrics.cer}%
            </strong>
          </div>
        )}
        <div className="telemetry-cell">
          <span className="cell-label">Dialogue Anomalies</span>
          <strong className={`cell-val ${(transcriptMetrics?.repetitionCount || 0) + (transcriptMetrics?.spliceCount || 0) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {(transcriptMetrics?.repetitionCount || 0) + (transcriptMetrics?.spliceCount || 0) + (transcriptMetrics?.silenceAnomalyCount || 0)} Flagged
          </strong>
        </div>
      </div>

      {/* Speaker Diarization Badges Strip */}
      {speakersList.length > 0 && (
        <div className="p-3 bg-neutral-900/60 border border-neutral-800 rounded-xl mb-4">
          <div className="flex items-center gap-2 mb-2 text-xs font-medium text-neutral-400">
            <Users className="h-3.5 w-3.5 text-neutral-300" />
            <span>Speaker Diarization Attribution (Acoustic Timbre Profiles):</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                selectedSpeakerFilter === 'all'
                  ? 'border-neutral-400 bg-neutral-800 text-white'
                  : 'border-neutral-800 bg-neutral-950/60 text-neutral-400 hover:text-white'
              }`}
              onClick={() => setSelectedSpeakerFilter('all')}
            >
              All Speakers ({transcription.length})
            </button>
            {speakersList.map((spk) => (
              <button
                key={spk.id}
                type="button"
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  selectedSpeakerFilter === spk.label
                    ? 'border-emerald-500/80 bg-neutral-800 text-emerald-300'
                    : 'border-neutral-800 bg-neutral-950/60 text-neutral-400 hover:text-white'
                }`}
                onClick={() => setSelectedSpeakerFilter(selectedSpeakerFilter === spk.label ? 'all' : spk.label)}
              >
                <User className="h-3 w-3 text-neutral-400" />
                <span>{spk.label}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700">
                  {spk.segmentCount} segments • {spk.totalSpokenSeconds}s
                </span>
                {spk.avgPitchHz && (
                  <span className="text-[10px] text-neutral-400">
                    F₀: {spk.avgPitchHz} Hz
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search Filter Bar */}
      <div className="flex items-center gap-2 mb-4 bg-neutral-900/80 border border-neutral-800 rounded-xl px-3 py-2">
        <Search className="h-4 w-4 text-neutral-400 flex-shrink-0" />
        <input
          type="text"
          placeholder="Filter spoken dialogue keywords, speakers, or text..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-transparent border-none text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none"
        />
        {searchQuery && (
          <button
            type="button"
            className="text-xs text-neutral-400 hover:text-neutral-200"
            onClick={() => setSearchQuery('')}
          >
            Clear
          </button>
        )}
      </div>

      {/* Synchronized Dialogue Segments List */}
      <div className="space-y-2.5 max-h-[480px] overflow-y-auto pr-1">
        {filteredSegments.length > 0 ? (
          filteredSegments.map((seg, idx) => {
            const isExpanded = expandedWordSegmentId === seg.id
            const hasWords = Boolean(seg.words && seg.words.length > 0)
            return (
              <div
                key={seg.id || `seg-${idx}`}
                className="p-3 bg-neutral-950/70 border border-neutral-800/90 hover:border-neutral-700 rounded-xl transition-all"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 text-[11px] font-medium bg-neutral-800 text-neutral-200 rounded border border-neutral-700">
                      {seg.speaker || `Speaker 1`}
                    </span>
                    <span className="text-[11px] font-mono text-neutral-400">
                      {formatDuration(seg.start)} — {formatDuration(seg.end)}
                    </span>
                    {seg.confidence !== undefined && (
                      <span className="text-[10px] px-1.5 py-0.2 bg-neutral-900 text-neutral-400 rounded border border-neutral-800">
                        Conf: {seg.confidence}%
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {hasWords && (
                      <button
                        type="button"
                        className="text-[11px] text-neutral-400 hover:text-neutral-200 underline"
                        onClick={() => setExpandedWordSegmentId(isExpanded ? null : seg.id)}
                      >
                        {isExpanded ? 'Hide Words' : 'Word Timing'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg border border-neutral-700 transition-colors"
                      onClick={() => handleJump(seg.start)}
                      title={`Jump audio to ${formatDuration(seg.start)}`}
                    >
                      <Play className="h-2.5 w-2.5" /> Seek
                    </button>
                  </div>
                </div>

                <p className="text-xs text-neutral-200 leading-relaxed font-normal select-text">
                  {seg.text}
                </p>

                {/* Word-level timing pill strip */}
                {isExpanded && hasWords && (
                  <div className="mt-2.5 pt-2 border-t border-neutral-800/80 flex flex-wrap gap-1.5">
                    {seg.words!.map((w, wIdx) => (
                      <span
                        key={`word-${wIdx}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-neutral-900 border border-neutral-800 rounded text-[10px] text-neutral-300 font-mono"
                        title={`Probability: ${Math.round(w.probability * 100)}% | Time: ${w.start}s - ${w.end}s`}
                      >
                        <span>{w.word}</span>
                        <span className="text-neutral-400">({w.start}s)</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        ) : (
          <div className="text-center py-8 text-neutral-400 text-xs border border-dashed border-neutral-800 rounded-xl">
            {transcription.length === 0 ? (
              <div className="space-y-1.5">
                <p className="font-medium text-neutral-300">No Spoken Dialogue Detected in Evidence</p>
                <p className="text-[11px] text-neutral-400">
                  Audio container contains no active human speech formants or speech recognition is awaiting input.
                </p>
              </div>
            ) : (
              <p>No dialogue segments match the search query "{searchQuery}".</p>
            )}
          </div>
        )}
      </div>

      {/* Forensic Findings Section */}
      {findings.length > 0 && (
        <div className="mt-4 pt-4 border-t border-neutral-800">
          <h5 className="text-xs uppercase tracking-wider font-semibold text-neutral-400 mb-3 flex items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
            Linguistic &amp; Acoustic Transcript Findings ({findings.length})
          </h5>
          <div className="space-y-2">
            {findings.map((f, idx) => (
              <div
                key={f.id || `trn-finding-${idx}`}
                className="p-3 bg-neutral-950 border border-neutral-800 rounded-xl"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 text-[10px] font-semibold rounded uppercase ${
                        f.severity === 'critical'
                          ? 'bg-rose-950 text-rose-300 border border-rose-800'
                          : f.severity === 'high'
                          ? 'bg-amber-950 text-amber-300 border border-amber-800'
                          : 'bg-neutral-800 text-neutral-300 border border-neutral-700'
                      }`}
                    >
                      {f.severity || 'moderate'}
                    </span>
                    <strong className="text-xs text-neutral-200">{f.title}</strong>
                  </div>
                  {f.confidence !== undefined && (
                    <span className="text-[10px] text-neutral-400 font-mono">
                      Conf: {typeof f.confidence === 'number' ? `${f.confidence}%` : f.confidence}
                    </span>
                  )}
                </div>
                <p className="text-xs text-neutral-300 mb-1.5">{f.description}</p>
                {f.humanReviewRecommendation && (
                  <p className="text-[11px] text-neutral-400 italic">
                    <strong>Examiner Review:</strong> {f.humanReviewRecommendation}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Forensic Caveat Footer */}
      <div className="mt-4 pt-3 border-t border-neutral-800/80 flex items-start gap-2 text-[11px] text-neutral-400">
        <AlertTriangle className="h-3.5 w-3.5 text-neutral-400 flex-shrink-0 mt-0.5" />
        <p>
          <strong>Evidentiary Notice:</strong> Automated transcription and unsupervised diarization (Speaker 1, Speaker 2) are probabilistic tools. Technical limitations may occur under low acoustic SNR or heavy room reverberation.
        </p>
      </div>
    </div>
  )
}
