'use client'

import React, { useMemo, useState } from 'react'
import {
  AlertTriangle,
  AudioLines,
  Clock,
  Eye,
  FileText,
  Fingerprint,
  Info,
  Layers,
  Sparkles,
  Video,
} from 'lucide-react'

export interface EvidenceRelationship {
  source: string
  target: string
  relationship: string
  explanation?: string
  inconsistencyType?: 'lip-sync' | 'transcript-mismatch' | 'video-artifact' | 'audio-manipulation' | 'general'
  severity?: 'critical' | 'high' | 'moderate' | 'low' | 'info'
}

interface EvidenceGraphProps {
  relationships: EvidenceRelationship[]
  timestamps?: Array<{ timestamp: string; label?: string; description?: string; evidenceRef?: string }>
}

function detectInconsistencyType(relationship: string, explanation = ''): 'lip-sync' | 'transcript-mismatch' | 'video-artifact' | 'audio-manipulation' | 'general' {
  const text = `${relationship} ${explanation}`.toLowerCase()
  if (text.includes('lip') || text.includes('viseme') || text.includes('mouth') || text.includes('sync')) return 'lip-sync'
  if (text.includes('transcript') || text.includes('speech') || text.includes('dialogue') || text.includes('text mismatch')) return 'transcript-mismatch'
  if (text.includes('frame') || text.includes('artifact') || text.includes('face') || text.includes('blur') || text.includes('temporal')) return 'video-artifact'
  if (text.includes('audio') || text.includes('voice') || text.includes('spectral') || text.includes('cut') || text.includes('vocoder')) return 'audio-manipulation'
  return 'general'
}

export default function EvidenceGraph({ relationships = [], timestamps = [] }: EvidenceGraphProps) {
  const [selectedIndex, setSelectedIndex] = useState<number>(0)
  const [filterType, setFilterType] = useState<string>('all')

  const enrichedRelationships = useMemo(() => {
    return relationships.map((item, idx) => ({
      ...item,
      id: `rel-${idx}`,
      inconsistencyType: item.inconsistencyType || detectInconsistencyType(item.relationship, item.explanation),
    }))
  }, [relationships])

  const filteredRelationships = useMemo(() => {
    if (filterType === 'all') return enrichedRelationships
    return enrichedRelationships.filter((r) => r.inconsistencyType === filterType)
  }, [enrichedRelationships, filterType])

  const selectedItem = filteredRelationships[selectedIndex] ?? filteredRelationships[0]

  // Track summary counts
  const counts = useMemo(() => {
    return {
      all: enrichedRelationships.length,
      'lip-sync': enrichedRelationships.filter((r) => r.inconsistencyType === 'lip-sync').length,
      'transcript-mismatch': enrichedRelationships.filter((r) => r.inconsistencyType === 'transcript-mismatch').length,
      'video-artifact': enrichedRelationships.filter((r) => r.inconsistencyType === 'video-artifact').length,
      'audio-manipulation': enrichedRelationships.filter((r) => r.inconsistencyType === 'audio-manipulation').length,
    }
  }, [enrichedRelationships])

  if (relationships.length === 0) {
    return (
      <div className="correlation-empty-container">
        <div className="empty-icon-box">
          <Layers className="h-5 w-5 text-slate-400" />
        </div>
        <h4>No Cross-Modal Discrepancies Returned</h4>
        <p>
          Automated correlation algorithms found no supported contradictions between video frames, acoustic signals, and extracted dialogue in this analysis.
        </p>
      </div>
    )
  }

  return (
    <div className="evidence-correlation-suite" aria-label="Evidence Correlation Graph">
      {/* Category Filter Pills */}
      <div className="correlation-filter-bar">
        <span className="filter-label">Filter Inconsistencies:</span>
        <div className="filter-pills-list">
          <button
            type="button"
            className={`corr-pill ${filterType === 'all' ? 'active' : ''}`}
            onClick={() => { setFilterType('all'); setSelectedIndex(0); }}
          >
            All Connections ({counts.all})
          </button>
          {counts['lip-sync'] > 0 && (
            <button
              type="button"
              className={`corr-pill ${filterType === 'lip-sync' ? 'active' : ''}`}
              onClick={() => { setFilterType('lip-sync'); setSelectedIndex(0); }}
            >
              Lip-Sync Mismatches ({counts['lip-sync']})
            </button>
          )}
          {counts['transcript-mismatch'] > 0 && (
            <button
              type="button"
              className={`corr-pill ${filterType === 'transcript-mismatch' ? 'active' : ''}`}
              onClick={() => { setFilterType('transcript-mismatch'); setSelectedIndex(0); }}
            >
              Transcript Discrepancies ({counts['transcript-mismatch']})
            </button>
          )}
          {counts['video-artifact'] > 0 && (
            <button
              type="button"
              className={`corr-pill ${filterType === 'video-artifact' ? 'active' : ''}`}
              onClick={() => { setFilterType('video-artifact'); setSelectedIndex(0); }}
            >
              Video Artifacts ({counts['video-artifact']})
            </button>
          )}
          {counts['audio-manipulation'] > 0 && (
            <button
              type="button"
              className={`corr-pill ${filterType === 'audio-manipulation' ? 'active' : ''}`}
              onClick={() => { setFilterType('audio-manipulation'); setSelectedIndex(0); }}
            >
              Audio Indicators ({counts['audio-manipulation']})
            </button>
          )}
        </div>
      </div>

      {/* Visual Modality Cross-Matrix Diagram */}
      <div className="correlation-matrix-card">
        <div className="matrix-nodes-row">
          <div className="matrix-node video-node">
            <Video className="h-4 w-4 text-sky-400" />
            <div>
              <strong>Video Stream</strong>
              <span>Visual Frames &amp; Motion</span>
            </div>
          </div>

          <div className="matrix-center-indicator">
            <span className="correlation-badge">
              <Sparkles className="h-3 w-3 text-cyan-400 animate-pulse" /> Triangulation Engine
            </span>
          </div>

          <div className="matrix-node audio-node">
            <AudioLines className="h-4 w-4 text-indigo-400" />
            <div>
              <strong>Audio Stream</strong>
              <span>Acoustic Waveforms</span>
            </div>
          </div>
        </div>

        <div className="matrix-nodes-bottom-row">
          <div className="matrix-node transcript-node">
            <FileText className="h-4 w-4 text-emerald-400" />
            <div>
              <strong>Extracted Transcript</strong>
              <span>Spoken Word Alignment</span>
            </div>
          </div>

          {timestamps.length > 0 && (
            <div className="matrix-node timestamp-node">
              <Clock className="h-4 w-4 text-amber-400" />
              <div>
                <strong>Suspicious Timestamps</strong>
                <span>{timestamps.length} Points of Interest</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Interactive Relationships Grid */}
      <div className="correlation-relationships-grid">
        <div className="relationship-links-column">
          <h5 className="column-subheading">
            Supported Correlation Findings ({filteredRelationships.length})
          </h5>
          <div className="links-scroll-list">
            {filteredRelationships.map((item, idx) => {
              const isSelected = selectedIndex === idx
              const tagClass =
                item.inconsistencyType === 'lip-sync'
                  ? 'tag-lipsync'
                  : item.inconsistencyType === 'transcript-mismatch'
                  ? 'tag-transcript'
                  : item.inconsistencyType === 'video-artifact'
                  ? 'tag-video'
                  : item.inconsistencyType === 'audio-manipulation'
                  ? 'tag-audio'
                  : 'tag-general'

              return (
                <div
                  key={item.id}
                  className={`correlation-link-card ${isSelected ? 'active' : ''}`}
                  onClick={() => setSelectedIndex(idx)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setSelectedIndex(idx)
                  }}
                >
                  <div className="link-header">
                    <span className={`inconsistency-tag ${tagClass}`}>
                      {item.inconsistencyType.toUpperCase().replace('-', ' ')}
                    </span>
                    <span className="link-rel-badge">{item.relationship}</span>
                  </div>
                  <div className="link-targets">
                    <span className="source-name">{item.source}</span>
                    <span className="link-arrow">⇄</span>
                    <span className="target-name">{item.target}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Selected Correlation Deep-Dive Card */}
        {selectedItem && (
          <div className="relationship-detail-column">
            <h5 className="column-subheading">Inconsistency Analysis</h5>
            <div className="detail-card-panel">
              <div className="detail-top-bar">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <strong>{selectedItem.relationship}</strong>
              </div>
              <div className="detail-source-target-box">
                <div>
                  <span className="lbl">Source Stream</span>
                  <strong>{selectedItem.source}</strong>
                </div>
                <div className="arrow-box">⟷</div>
                <div>
                  <span className="lbl">Target Stream</span>
                  <strong>{selectedItem.target}</strong>
                </div>
              </div>
              {selectedItem.explanation && (
                <div className="detail-explanation-box">
                  <span className="lbl">Observed Inconsistency:</span>
                  <p>{selectedItem.explanation}</p>
                </div>
              )}
              <div className="detail-forensic-rule">
                <Info className="h-3.5 w-3.5 text-slate-400" />
                <span>
                  This relationship was derived exclusively from output metrics returned by automated forensic triangulators.
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
