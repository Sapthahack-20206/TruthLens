'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowDown,
  ArrowRight,
  AudioLines,
  Award,
  Check,
  ChevronDown,
  Clock,
  FileCheck,
  FileImage,
  FileSearch,
  FileText,
  Fingerprint,
  Layers,
  LoaderCircle,
  Menu,
  Paperclip,
  Play,
  ScanFace,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Upload,
  Video,
  X,
  Zap,
} from 'lucide-react'
import TruthLensRobot from '@/components/truthlens-robot'
import JudgeDemoGuide from '@/components/judge-demo-guide'
import { createInvestigation } from '@/lib/truthlens-api'
import { DEMO_PRESETS, loadDemoSampleFile, loadDemoMultimodalBundle, JUDGE_DEMO_STEPS } from '@/lib/demo-samples'

const LOGO_URL = 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/TruthLens%20Aperture%20Logo-Zh8uJ1dIwq1yd1IEsjzn4BDgWzmMQA.png'

const featureCards = [
  { icon: FileImage, title: 'Image forensics', text: 'Inspect image provenance, edits, and visual signals with evidence-linked findings.' },
  { icon: Video, title: 'Video forensics', text: 'Trace suspicious frames, temporal shifts, and moments that deserve a closer look.' },
  { icon: AudioLines, title: 'Audio forensics', text: 'Explore voice, sound, and timing cues without losing sight of uncertainty.' },
  { icon: Fingerprint, title: 'Cross-modal intelligence', text: 'Bring media, transcript, and context together to reveal inconsistencies.' },
]

const steps = [
  ['01', 'Upload media', 'Bring the source files and relevant context into one investigation.'],
  ['02', 'Analyse evidence', 'Run focused analysis across each supported media type.'],
  ['03', 'Review indicators', 'See what was found, where it appears, and what may be uncertain.'],
  ['04', 'Correlate signals', 'Connect evidence across audio, video, images, and text.'],
  ['05', 'Share a report', 'Keep observations, limitations, and review notes together.'],
]

export default function TruthLensLanding() {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showJudgeGuide, setShowJudgeGuide] = useState(false)
  const [loadingPreset, setLoadingPreset] = useState<string | null>(null)

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return
    setFiles((current) => [...current, ...Array.from(incoming)].slice(0, 8))
    setError('')
  }

  const handleLoadPreset = async (presetKey: 'video' | 'audio' | 'image' | 'cross-modal') => {
    setLoadingPreset(presetKey)
    setError('')
    try {
      if (presetKey === 'cross-modal') {
        const { files: bundleFiles, context } = await loadDemoMultimodalBundle()
        setFiles(bundleFiles)
        setPrompt(context)
      } else {
        const file = await loadDemoSampleFile(presetKey)
        setFiles([file])
        setPrompt(DEMO_PRESETS[presetKey].context)
      }
    } catch {
      setError('Unable to load demo sample file from server. You can select local files using the upload button.')
    } finally {
      setLoadingPreset(null)
    }
  }

  const startInvestigation = async () => {
    if (!files.length) {
      setError('Choose at least one file or select a Hackathon Demo Preset to start.')
      fileInput.current?.click()
      return
    }

    setBusy(true)
    setProgress(0)
    setError('')
    try {
      const result = await createInvestigation(files, prompt, setProgress)
      router.push(`/workspace?investigation=${encodeURIComponent(result.id)}`)
    } catch (cause) {
      setProgress(null)
      setError(cause instanceof Error ? cause.message : 'The investigation service could not be reached.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="site-shell">
      <header className="site-nav">
        <Link className="brand" href="/" aria-label="TruthLens home">
          <span className="brand-symbol"><img src={LOGO_URL} alt="" /></span>
          <span className="brand-name">TruthLens</span>
          <ChevronDown className="brand-chevron" aria-hidden="true" />
        </Link>
        <nav className={`public-links ${mobileOpen ? 'is-open' : ''}`} aria-label="Main navigation">
          <a href="#product" onClick={() => setMobileOpen(false)}>Product</a>
          <a href="#features" onClick={() => setMobileOpen(false)}>Features</a>
          <a href="#how-it-works" onClick={() => setMobileOpen(false)}>How it works</a>
          <a href="#demo-steps" onClick={() => setMobileOpen(false)}>Demo Guide</a>
          <a href="#forensic-science" onClick={() => setMobileOpen(false)}>Methodology</a>
          <a href="#about" onClick={() => setMobileOpen(false)}>About</a>
        </nav>
        <div className="nav-actions">
          <button
            type="button"
            className="judge-guide-trigger-btn"
            onClick={() => setShowJudgeGuide(true)}
            title="Open Interactive Hackathon Judge Walkthrough"
          >
            <Award className="h-3.5 w-3.5" />
            <span>Judge Guide</span>
          </button>
          <Link className="nav-workspace-pill" href="/workspace">
            Workspace <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link className="nav-login" href="/login">Log in</Link>
          <Link className="button button-dark nav-cta" href="/register">Get started</Link>
        </div>
        <button
          className="mobile-menu-button"
          type="button"
          aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? <X /> : <Menu />}
        </button>
      </header>

      <section className="hero" id="product">
        <div className="hero-copy">
          <p className="eyebrow"><span className="eyebrow-dot" /> DIGITAL FORENSICS, MADE CLEAR</p>
          <h1>See Beyond the Surface.</h1>
          <p className="hero-subtitle">
            Detect digital manipulation, analyse suspicious media, and uncover the verifiable evidence behind what you see and hear.
          </p>
        </div>

        <div className="prompt-card" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files) }}>
          {/* Quick Hackathon Demo Presets Strip */}
          <div className="landing-preset-strip">
            <span className="preset-label">
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              <strong>1-Click Hackathon Presets:</strong>
            </span>
            <div className="preset-buttons">
              <button
                type="button"
                className="btn-preset-pill vid"
                onClick={() => handleLoadPreset('video')}
                disabled={loadingPreset !== null || busy}
                title="Load 10s 720p interview video deepfake"
              >
                <Video className="h-3.5 w-3.5 text-sky-400" />
                <span>{loadingPreset === 'video' ? 'Loading…' : 'Video Deepfake (MP4)'}</span>
              </button>
              <button
                type="button"
                className="btn-preset-pill aud"
                onClick={() => handleLoadPreset('audio')}
                disabled={loadingPreset !== null || busy}
                title="Load 16kHz speech sample with silence gap drops"
              >
                <AudioLines className="h-3.5 w-3.5 text-indigo-400" />
                <span>{loadingPreset === 'audio' ? 'Loading…' : 'Voice Clone (WAV)'}</span>
              </button>
              <button
                type="button"
                className="btn-preset-pill img"
                onClick={() => handleLoadPreset('image')}
                disabled={loadingPreset !== null || busy}
                title="Load high-res portrait for ELA inspection"
              >
                <FileImage className="h-3.5 w-3.5 text-rose-400" />
                <span>{loadingPreset === 'image' ? 'Loading…' : 'Portrait Keyframe (JPG)'}</span>
              </button>
              <button
                type="button"
                className="btn-preset-pill multi"
                onClick={() => handleLoadPreset('cross-modal')}
                disabled={loadingPreset !== null || busy}
                title="Load synchronized Video + Audio + Transcript bundle"
              >
                <Fingerprint className="h-3.5 w-3.5 text-emerald-400" />
                <span>{loadingPreset === 'cross-modal' ? 'Loading…' : 'Tri-Modal Case Bundle'}</span>
              </button>
            </div>
          </div>

          <label className="sr-only" htmlFor="investigation-prompt">Describe the media you want to investigate</label>
          <textarea
            id="investigation-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe or upload the media you want to investigate, or click a preset above..."
            rows={2}
          />
          {files.length > 0 && (
            <div className="selected-files" aria-live="polite">
              {files.map((file, index) => (
                <span className="file-chip" key={`${file.name}-${index}`}>
                  <FileText aria-hidden="true" />
                  <span>{file.name}</span>
                  <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}><X /></button>
                </span>
              ))}
            </div>
          )}
          <div className="prompt-card-footer">
            <div className="prompt-tools">
              <button className="upload-trigger" type="button" onClick={() => fileInput.current?.click()}><Paperclip aria-hidden="true" /> Upload media</button>
              <span className="supported-formats">Images, video, audio &amp; documents</span>
              <input ref={fileInput} className="sr-only" type="file" multiple accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/x-msvideo,audio/wav,audio/mpeg,audio/mp4,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => addFiles(event.target.files)} />
            </div>
            <button className="button button-dark start-button" type="button" onClick={startInvestigation} disabled={busy}>
              {busy ? <LoaderCircle className="spinning" aria-hidden="true" /> : null}
              {busy ? 'Connecting…' : 'Start investigation'}
              {!busy && <ArrowRight aria-hidden="true" />}
            </button>
          </div>
          {busy && progress !== null && <div className="landing-progress" role="progressbar" aria-label="Investigation upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span className="upload-progress-track"><span style={{ width: `${progress}%` }} /></span><span>{progress}%</span></div>}
          {error && <p className="form-feedback" role="alert">{error}</p>}
        </div>

        <TruthLensRobot />
        <div className="hero-fade" aria-hidden="true" />
        <a className="discover-button" href="#features">Discover how <ChevronDown aria-hidden="true" /></a>
        <span className="hero-caption">ANALYSIS THAT SHOWS ITS WORK</span>
      </section>

      <section className="trust-strip" aria-label="Platform principles">
        <p>Built for careful review, not instant verdicts.</p>
        <div className="trust-items">
          <span><ShieldCheck aria-hidden="true" /> Evidence-linked</span>
          <span><ScanLine aria-hidden="true" /> Multimodal</span>
          <span><Sparkles aria-hidden="true" /> Uncertainty-aware</span>
        </div>
      </section>

      {/* JUDGE DEMONSTRATION WORKFLOW SECTION (Requirement 13) */}
      <section className="section judge-flow-section" id="demo-steps">
        <div className="section-heading">
          <p className="eyebrow"><Award className="inline-block h-3.5 w-3.5 text-amber-400 mr-1" /> HACKATHON EVALUATION GUIDE</p>
          <h2>Recommended Judge Demonstration Workflow</h2>
          <p>Follow our structured 7-step evaluation path to observe every dimension of TruthLens from ingestion to certified report.</p>
        </div>
        <div className="feature-grid">
          {JUDGE_DEMO_STEPS.map((s) => (
            <article className="feature-card" key={s.step}>
              <span className="feature-index">0{s.step}</span>
              <h3>{s.title.split(':')[0]}</h3>
              <p>{s.description}</p>
              <div className="mt-3 text-xs text-cyan-300 font-medium">
                ✓ Criterion: {s.evaluationCriterion}
              </div>
            </article>
          ))}
        </div>
        <div className="text-center mt-6">
          <button
            type="button"
            className="button button-dark"
            onClick={() => setShowJudgeGuide(true)}
          >
            <Award className="h-4 w-4 mr-2 text-amber-400" />
            Launch Interactive Judge Walkthrough
          </button>
        </div>
      </section>

      <section className="section feature-section" id="features">
        <div className="section-heading">
          <p className="eyebrow">ONE WORKSPACE, EVERY SIGNAL</p>
          <h2>What TruthLens does</h2>
          <p>Bring the pieces together. Give every observation a source, a timestamp, and room for human judgment.</p>
        </div>
        <div className="feature-grid">
          {featureCards.map(({ icon: Icon, title, text }, index) => (
            <article className="feature-card" key={title}>
              <span className="feature-icon"><Icon aria-hidden="true" /></span>
              <span className="feature-index">0{index + 1}</span>
              <h3>{title}</h3>
              <p>{text}</p>
              <ArrowRight className="feature-arrow" aria-hidden="true" />
            </article>
          ))}
        </div>
      </section>

      {/* FORENSIC METHODOLOGY: HOW TRUTHLENS WORKS (Requirement 12) */}
      <section className="section process-section" id="forensic-science">
        <div className="section-heading section-heading-left">
          <p className="eyebrow">FORENSIC SCIENCE &amp; ARCHITECTURE</p>
          <h2>How TruthLens Works Behind the Screen</h2>
          <p>Unlike opaque black-box detectors, TruthLens evaluates physical and signal-processing artifacts across multiple independent engines.</p>
        </div>
        <div className="steps-list">
          <article className="step-row">
            <span className="step-number">01</span>
            <h3>Facial Boundary Edge Disparity (Video)</h3>
            <p>Sobel gradient filters analyze the pixel edge transition between facial masks and the background. Deepfake face-swaps consistently leave subtle blending seams and alpha gradient mismatch.</p>
            <Check aria-hidden="true" />
          </article>
          <article className="step-row">
            <span className="step-number">02</span>
            <h3>Spectral Laplacian Ringing (GAN Artifacts)</h3>
            <p>Generative Adversarial Networks (GANs) and diffusion models exhibit high-frequency ringing and sharpness disparity (measured via Laplacian edge variance ratios up to 9.6x) relative to camera sensor noise floors.</p>
            <Check aria-hidden="true" />
          </article>
          <article className="step-row">
            <span className="step-number">03</span>
            <h3>Acoustic Silence Splicing &amp; Voice Synthesis (Audio)</h3>
            <p>Speech synthesizers and voice clones often display unnatural pitch contour stability, lack natural room acoustic reverberation, and introduce abrupt digital silence drops where speech tokens terminate.</p>
            <Check aria-hidden="true" />
          </article>
          <article className="step-row">
            <span className="step-number">04</span>
            <h3>Tri-Modal Cross-Verification (Lip-Sync &amp; Transcripts)</h3>
            <p>Phoneme audio timing is correlated with viseme facial mouth contours and sworn witness transcripts to detect temporal drift, replaced dialogue, or desynchronized footage.</p>
            <Check aria-hidden="true" />
          </article>
        </div>
      </section>

      <section className="section process-section" id="how-it-works">
        <div className="section-heading section-heading-left">
          <p className="eyebrow">A CLEARER PATH FROM FILE TO FINDING</p>
          <h2>Investigation Workflow</h2>
          <p>Move from source material to a structured, reviewable record — without skipping the details.</p>
        </div>
        <div className="steps-list">
          {steps.map(([number, title, text]) => (
            <article className="step-row" key={number}>
              <span className="step-number">{number}</span>
              <h3>{title}</h3>
              <p>{text}</p>
              <Check aria-hidden="true" />
            </article>
          ))}
        </div>
      </section>

      <section className="principles-section" id="research">
        <div className="principles-copy">
          <p className="eyebrow">OUR CORE INTELLIGENCE</p>
          <h2>Signals are stronger when they agree.</h2>
          <p>TruthLens brings each modality into context, helping reviewers see how evidence relates — and where it does not.</p>
          <Link className="text-link" href="/workspace?section=cross-modal">Explore the workspace <ArrowRight aria-hidden="true" /></Link>
        </div>
        <div className="principle-list">
          <article><span>01</span><div><h3>Tri-modal cross-verification</h3><p>Review audio, video, and text as connected evidence.</p></div><ArrowRight aria-hidden="true" /></article>
          <article><span>02</span><div><h3>Forensic triangulation</h3><p>Follow findings back to the frames and segments that support them.</p></div><ArrowRight aria-hidden="true" /></article>
          <article><span>03</span><div><h3>Uncertainty-aware analysis</h3><p>Keep limitations visible alongside every assessment.</p></div><ArrowRight aria-hidden="true" /></article>
        </div>
      </section>

      <section className="section why-section" id="about">
        <div className="why-heading">
          <p className="eyebrow">WHY TRUTHLENS</p>
          <h2>Clarity without overclaiming.</h2>
        </div>
        <div className="why-content">
          <p>Digital evidence deserves more than a score. TruthLens is designed to make analysis explainable, traceable, and useful to the people responsible for making decisions.</p>
          <div className="capability-tags">
            {['Explainable findings', 'Evidence references', 'Suspicious timestamps', 'Cross-modal review', 'Confidence & uncertainty', 'Human review support'].map((item) => <span key={item}><Check aria-hidden="true" /> {item}</span>)}
          </div>
        </div>
      </section>

      <section className="closing-cta">
        <div>
          <p className="eyebrow">START WITH THE EVIDENCE</p>
          <h2>Look closer. Understand more.</h2>
          <p>Bring your media into one careful, explainable workflow.</p>
        </div>
        <Link className="button button-dark" href="/workspace">Launch Workspace <ArrowRight aria-hidden="true" /></Link>
      </section>

      <footer className="site-footer">
        <Link className="brand footer-brand" href="/" aria-label="TruthLens home">
          <span className="brand-symbol"><img src={LOGO_URL} alt="" /></span>
          <span className="brand-name">TruthLens</span>
        </Link>
        <p>See Beyond the Surface. Verify What Is Real.</p>
        <nav aria-label="Footer navigation"><a href="#about">About</a><a href="#features">Features</a><a href="mailto:hello@truthlens.ai">Contact</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
        <span className="copyright">© 2026 TruthLens. For informed review, not absolute proof.</span>
      </footer>

      {/* Interactive Judge Demo Guide Modal */}
      <JudgeDemoGuide
        isOpen={showJudgeGuide}
        onClose={() => setShowJudgeGuide(false)}
      />
    </main>
  )
}

