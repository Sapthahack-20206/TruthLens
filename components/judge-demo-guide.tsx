'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  AudioLines,
  Award,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  Eye,
  FileCheck,
  FileSearch,
  FileText,
  Fingerprint,
  Layers,
  Play,
  ScanFace,
  ShieldCheck,
  Sparkles,
  Video,
  X,
} from 'lucide-react'
import { JUDGE_DEMO_STEPS, DEMO_PRESETS } from '@/lib/demo-samples'

interface JudgeDemoGuideProps {
  isOpen: boolean
  onClose: () => void
  onSelectPreset?: (presetId: 'video' | 'audio' | 'image' | 'cross-modal') => void
}

export default function JudgeDemoGuide({
  isOpen,
  onClose,
  onSelectPreset,
}: JudgeDemoGuideProps) {
  const router = useRouter()
  const [activeStepIndex, setActiveStepIndex] = useState(0)
  const [copiedSummary, setCopiedSummary] = useState(false)

  if (!isOpen) return null

  const currentStep = JUDGE_DEMO_STEPS[activeStepIndex]

  const handleLaunchPreset = (modality: 'video' | 'audio' | 'image' | 'cross-modal') => {
    onClose()
    if (onSelectPreset) {
      onSelectPreset(modality)
    } else {
      router.push(`/workspace?section=${DEMO_PRESETS[modality].recommendedSection}&preset=${modality}`)
    }
  }

  const handleCopyPitch = () => {
    const text = `TruthLens: Explainable Digital Media Forensics & Deepfake Verification
• Problem: Generative AI deepfakes and voice clones deceive public discourse, but existing detectors are black-box percentages.
• Solution: TruthLens combines facial boundary Sobel edge gradients, spectral Laplacian variance, acoustic silence splices, and cross-modal lip-sync correlation.
• Key Differentiators: Grounded keyframe timeline, interactive face bounding box zoom, plain-English explanations, strict heuristic vs. model distinction, and certified forensic PDF exports.`
    navigator.clipboard.writeText(text)
    setCopiedSummary(true)
    setTimeout(() => setCopiedSummary(false), 3000)
  }

  return (
    <div className="judge-guide-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="judge-guide-title">
      <div className="judge-guide-modal-card">
        {/* Modal Header */}
        <div className="judge-guide-header">
          <div className="flex items-center gap-2.5">
            <span className="judge-guide-badge">
              <Award className="h-4 w-4 text-amber-400" />
              <span>JUDGE &amp; EVALUATION GUIDE</span>
            </span>
            <span className="hackathon-tag">Hackathon Demo Workflow</span>
          </div>
          <button
            type="button"
            className="guide-close-btn"
            onClick={onClose}
            aria-label="Close guide"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Executive Summary Pitch */}
        <div className="judge-problem-card">
          <div className="problem-statement">
            <div className="problem-badge">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
              <strong>The Problem</strong>
            </div>
            <p>
              Generative AI face-swaps, synthetic speech cloning, and metadata-stripped &quot;cheap fakes&quot; spread rapidly. Existing commercial detectors act as opaque black boxes, outputting arbitrary percentages like &quot;99% Fake&quot; with zero auditable evidence for courts or investigators.
            </p>
          </div>
          <div className="solution-statement">
            <div className="solution-badge">
              <ShieldCheck className="h-3.5 w-3.5 text-cyan-400" />
              <strong>The TruthLens Solution</strong>
            </div>
            <p>
              TruthLens performs <strong>Explainable Tri-Modal Forensics</strong>. It extracts verifiable frame-level pixel gradients, Laplacian texture ratios, acoustic silence drops, and lexical lip-sync alignment—grounding every observation with interactive keyframes, SHA-256 chain of custody, and certified PDF reports.
            </p>
          </div>
        </div>

        {/* 1-Click Interactive Presets Row for Judges */}
        <div className="quick-presets-section">
          <div className="presets-header">
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            <span>Fast Hackathon Presets (1-Click Load Sample Evidence):</span>
          </div>
          <div className="presets-grid">
            <button
              type="button"
              className="preset-card-btn vid"
              onClick={() => handleLaunchPreset('video')}
            >
              <Video className="h-4 w-4 text-sky-400" />
              <div className="preset-card-text">
                <strong>Video Deepfake Benchmark</strong>
                <small>10s 720p interview · Facial seams &amp; texture disparity</small>
              </div>
              <ArrowRight className="h-3.5 w-3.5 ml-auto opacity-70" />
            </button>

            <button
              type="button"
              className="preset-card-btn aud"
              onClick={() => handleLaunchPreset('audio')}
            >
              <AudioLines className="h-4 w-4 text-indigo-400" />
              <div className="preset-card-text">
                <strong>Voice Synthesis Sample</strong>
                <small>PCM WAV 16kHz · Silence gaps &amp; room-tone drop</small>
              </div>
              <ArrowRight className="h-3.5 w-3.5 ml-auto opacity-70" />
            </button>

            <button
              type="button"
              className="preset-card-btn img"
              onClick={() => handleLaunchPreset('image')}
            >
              <Eye className="h-4 w-4 text-rose-400" />
              <div className="preset-card-text">
                <strong>Portrait Keyframe Image</strong>
                <small>High-res frame · Error Level Analysis &amp; EXIF</small>
              </div>
              <ArrowRight className="h-3.5 w-3.5 ml-auto opacity-70" />
            </button>

            <button
              type="button"
              className="preset-card-btn multi"
              onClick={() => handleLaunchPreset('cross-modal')}
            >
              <Fingerprint className="h-4 w-4 text-emerald-400" />
              <div className="preset-card-text">
                <strong>Tri-Modal Bundle</strong>
                <small>Video + Audio + Transcript cross-correlation</small>
              </div>
              <ArrowRight className="h-3.5 w-3.5 ml-auto opacity-70" />
            </button>
          </div>
        </div>

        {/* Step-by-Step Guided Workflow */}
        <div className="guide-stepper-container">
          <div className="stepper-nav-bar">
            {JUDGE_DEMO_STEPS.map((s, idx) => (
              <button
                key={s.step}
                type="button"
                className={`stepper-node ${activeStepIndex === idx ? 'active' : activeStepIndex > idx ? 'completed' : ''}`}
                onClick={() => setActiveStepIndex(idx)}
              >
                <span className="step-num">{s.step}</span>
                <span className="step-short-title">{s.title.split(':')[0]}</span>
              </button>
            ))}
          </div>

          <div className="current-step-card">
            <div className="step-header">
              <span className="step-counter">STEP {currentStep.step} OF 7</span>
              <h3 id="judge-guide-title">{currentStep.title}</h3>
            </div>
            <p className="step-desc">{currentStep.description}</p>
            <div className="eval-criterion-box">
              <CheckCircle2 className="h-3.5 w-3.5 text-cyan-400 flex-shrink-0" />
              <span><strong>What to look for:</strong> {currentStep.evaluationCriterion}</span>
            </div>

            <div className="step-controls">
              <button
                type="button"
                className="btn-stepper-secondary"
                onClick={() => setActiveStepIndex((i) => Math.max(0, i - 1))}
                disabled={activeStepIndex === 0}
              >
                Previous Step
              </button>
              {activeStepIndex < JUDGE_DEMO_STEPS.length - 1 ? (
                <button
                  type="button"
                  className="btn-stepper-primary"
                  onClick={() => setActiveStepIndex((i) => Math.min(JUDGE_DEMO_STEPS.length - 1, i + 1))}
                >
                  Next Step: {JUDGE_DEMO_STEPS[activeStepIndex + 1].title.split(':')[0]} <ArrowRight className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-stepper-primary"
                  onClick={() => handleLaunchPreset('video')}
                >
                  Launch Live Demo Scan <Play className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="judge-guide-footer">
          <button
            type="button"
            className="copy-pitch-btn"
            onClick={handleCopyPitch}
          >
            {copiedSummary ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copiedSummary ? 'Pitch Copied to Clipboard!' : 'Copy Evaluation Summary'}</span>
          </button>
          <div className="footer-links">
            <Link
              href="/workspace?section=video-analysis"
              className="footer-link-action"
              onClick={onClose}
            >
              Open Video Workspace
            </Link>
            <Link
              href="/workspace?section=cross-modal"
              className="footer-link-action"
              onClick={onClose}
            >
              Open Cross-Modal Engine
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
