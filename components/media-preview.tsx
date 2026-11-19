'use client'

import React, { useEffect, useRef, useState, useMemo } from 'react'
import {
  AudioLines,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  Eye,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Grid,
  Hash,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import ForensicMediaPlayer from '@/components/forensic-media-player'
import {
  calculateFileSha256,
  formatBytes,
  getEvidenceCategory,
  getFileExtension,
  readTextFile,
} from '@/lib/evidence-utils'

export function useMediaPreviewUrl(file?: File) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!file || !/^(image|video|audio)\//.test(file.type)) {
      setPreviewUrl(null)
      return
    }

    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [file])

  return previewUrl
}

interface MediaPreviewProps {
  files: File[]
  activeIndex?: number
  onSelectIndex?: (index: number) => void
  onRemoveFile?: (index: number) => void
  onReplaceFile?: (index: number) => void
  onSyncContext?: (text: string) => void
  response?: unknown
}

export default function MediaPreview({
  files,
  activeIndex: controlledIndex,
  onSelectIndex,
  onRemoveFile,
  onReplaceFile,
  onSyncContext,
  response,
}: MediaPreviewProps) {
  const [internalIndex, setInternalIndex] = useState(0)
  const [showAdvancedForensicPlayer, setShowAdvancedForensicPlayer] = useState(false)
  const activeIndex = controlledIndex !== undefined ? controlledIndex : internalIndex
  const safeIndex = Math.min(Math.max(0, activeIndex), Math.max(0, files.length - 1))
  const currentFile = files[safeIndex]

  const selectIndex = (index: number) => {
    setInternalIndex(index)
    onSelectIndex?.(index)
  }

  // SHA-256 Forensic Hash
  const [fileHash, setFileHash] = useState<string>('Computing hash…')
  const [copiedHash, setCopiedHash] = useState(false)

  useEffect(() => {
    if (!currentFile) {
      setFileHash('')
      return
    }
    let isCancelled = false
    setFileHash('Computing hash…')
    calculateFileSha256(currentFile).then((hash) => {
      if (!isCancelled) setFileHash(hash)
    })
    return () => {
      isCancelled = true
    }
  }, [currentFile])

  const copyHash = async () => {
    if (!fileHash || fileHash.startsWith('Computing')) return
    await navigator.clipboard.writeText(fileHash)
    setCopiedHash(true)
    setTimeout(() => setCopiedHash(false), 2000)
  }

  const category = currentFile ? getEvidenceCategory(currentFile) : 'unknown'
  const ext = currentFile ? getFileExtension(currentFile.name).toUpperCase() : ''

  if (!currentFile || files.length === 0) return null

  // If user explicitly launched advanced forensic media player for video/audio
  if ((category === 'video' || category === 'audio') && showAdvancedForensicPlayer) {
    return (
      <div className="advanced-player-wrapper">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <button
            type="button"
            className="staged-subtle-btn"
            onClick={() => setShowAdvancedForensicPlayer(false)}
          >
            ← Return to Evidence Preview
          </button>
          <span style={{ fontSize: '11px', color: '#666' }}>Interactive Forensic Player Active</span>
        </div>
        <ForensicMediaPlayer file={currentFile} forensicOutput={response as any} />
      </div>
    )
  }

  return (
    <section className="evidence-preview-card" aria-label="Evidence preview workspace">
      {/* Evidence Multi-File Navigation Strip (if more than 1 file) */}
      {files.length > 1 && (
        <div className="evidence-tabs-bar" role="tablist" aria-label="Evidence files">
          <div className="evidence-tabs-scroll">
            {files.map((file, idx) => {
              const fileCat = getEvidenceCategory(file)
              const fileExt = getFileExtension(file.name).toUpperCase()
              const isSelected = idx === safeIndex
              return (
                <button
                  key={`${file.name}-${idx}`}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  className={`evidence-tab ${isSelected ? 'is-active' : ''}`}
                  onClick={() => selectIndex(idx)}
                  title={file.name}
                >
                  <span className="evidence-tab-icon">
                    {fileCat === 'image' && <FileImage aria-hidden="true" />}
                    {fileCat === 'video' && <FileVideo aria-hidden="true" />}
                    {fileCat === 'audio' && <FileAudio aria-hidden="true" />}
                    {fileCat === 'text' && <FileText aria-hidden="true" />}
                  </span>
                  <span className="evidence-tab-name">{file.name}</span>
                  <span className="evidence-tab-ext">{fileExt}</span>
                  <span className="evidence-tab-size">{formatBytes(file.size)}</span>
                </button>
              )
            })}
          </div>
          <span className="evidence-tab-count">
            {safeIndex + 1} of {files.length} evidence sources
          </span>
        </div>
      )}

      {/* Evidence Header */}
      <div className="evidence-preview-header">
        <div className="evidence-title-group">
          <div className="evidence-eyebrow-row">
            <span className="evidence-badge-category">
              <span className="evidence-orange-dot" />
              {category.toUpperCase()} EVIDENCE
            </span>
            <span className="evidence-badge-format">{ext}</span>
            <span className="evidence-badge-size">{formatBytes(currentFile.size)}</span>
          </div>
          <h3 className="evidence-filename" title={currentFile.name}>
            {currentFile.name}
          </h3>
        </div>

        {/* Evidence Actions Toolbar */}
        <div className="evidence-header-actions">
          {(category === 'video' || category === 'audio') && (
            <button
              type="button"
              className="evidence-action-btn"
              onClick={() => setShowAdvancedForensicPlayer(true)}
              title="Launch full forensic audio/video player with live transcript"
            >
              <Sparkles className="action-icon text-orange-600" />
              <span>Forensic Player</span>
            </button>
          )}

          {onReplaceFile && (
            <button
              type="button"
              className="evidence-action-btn"
              onClick={() => onReplaceFile(safeIndex)}
              title="Replace this evidence file"
              aria-label="Replace this evidence file"
            >
              <RefreshCw className="action-icon" />
              <span>Replace</span>
            </button>
          )}

          {onRemoveFile && (
            <button
              type="button"
              className="evidence-action-btn text-destructive"
              onClick={() => onRemoveFile(safeIndex)}
              title="Remove this evidence file"
              aria-label="Remove this evidence file"
            >
              <Trash2 className="action-icon" />
              <span>Remove</span>
            </button>
          )}
        </div>
      </div>

      {/* Forensic Chain of Custody / SHA-256 Hash Bar */}
      <div className="evidence-integrity-bar">
        <div className="integrity-info">
          <Hash className="integrity-icon" aria-hidden="true" />
          <span className="integrity-label">SHA-256 Integrity:</span>
          <code className="integrity-hash" title={fileHash}>
            {fileHash}
          </code>
        </div>
        <button
          type="button"
          className="integrity-copy-btn"
          onClick={copyHash}
          disabled={!fileHash || fileHash.startsWith('Computing')}
          title="Copy cryptographic hash"
          aria-label="Copy cryptographic hash"
        >
          {copiedHash ? (
            <>
              <Check className="copy-icon text-orange-600" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="copy-icon" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Interactive Media Preview Canvas */}
      <div className="evidence-visual-canvas">
        {category === 'image' && <ImageEvidenceViewer file={currentFile} />}
        {category === 'video' && <VideoEvidencePlayer file={currentFile} />}
        {category === 'audio' && <AudioEvidencePlayer file={currentFile} />}
        {category === 'text' && (
          <TextEvidenceViewer file={currentFile} onSyncContext={onSyncContext} />
        )}
        {category === 'unknown' && (
          <div className="evidence-unknown-placeholder">
            <FileText className="unknown-icon" />
            <p>Unsupported evidence file format for direct interactive preview.</p>
            <small>Filename: {currentFile.name}</small>
          </div>
        )}
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/*                                IMAGE VIEWER                                */
/* -------------------------------------------------------------------------- */

function ImageEvidenceViewer({ file }: { file: File }) {
  const url = useMediaPreviewUrl(file)
  const [zoom, setZoom] = useState(100)
  const [showGrid, setShowGrid] = useState(false)
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null)

  const handleZoomIn = () => setZoom((z) => Math.min(400, z + 25))
  const handleZoomOut = () => setZoom((z) => Math.max(25, z - 25))
  const handleResetZoom = () => setZoom(100)

  return (
    <div className="image-viewer-container">
      {/* Viewer controls */}
      <div className="viewer-toolbar">
        <div className="toolbar-group">
          <button
            type="button"
            className="toolbar-btn"
            onClick={handleZoomOut}
            title="Zoom out"
            aria-label="Zoom out"
            disabled={zoom <= 25}
          >
            <ZoomOut />
          </button>
          <span className="zoom-indicator">{zoom}%</span>
          <button
            type="button"
            className="toolbar-btn"
            onClick={handleZoomIn}
            title="Zoom in"
            aria-label="Zoom in"
            disabled={zoom >= 400}
          >
            <ZoomIn />
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={handleResetZoom}
            title="Reset zoom to 100%"
            aria-label="Reset zoom"
          >
            <RotateCcw />
          </button>
        </div>

        <div className="toolbar-group">
          <button
            type="button"
            className={`toolbar-btn ${showGrid ? 'is-active' : ''}`}
            onClick={() => setShowGrid((g) => !g)}
            title="Toggle forensic pixel alignment grid"
            aria-label="Toggle forensic grid"
          >
            <Grid />
            <span>Grid</span>
          </button>
        </div>
      </div>

      {/* Image Stage */}
      <div className={`image-viewport ${showGrid ? 'has-grid' : ''}`}>
        {url ? (
          <img
            src={url}
            alt={file.name}
            style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'center center' }}
            className="preview-image-element"
            onLoad={(e) => {
              const img = e.currentTarget
              setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight })
            }}
          />
        ) : (
          <div className="viewport-loading">Loading image…</div>
        )}
      </div>

      {/* Metadata strip */}
      <div className="evidence-metadata-strip">
        <div className="meta-item">
          <span className="meta-key">Dimensions:</span>
          <span className="meta-val">
            {naturalSize ? `${naturalSize.width} × ${naturalSize.height} px` : 'Reading…'}
          </span>
        </div>
        <div className="meta-item">
          <span className="meta-key">Aspect Ratio:</span>
          <span className="meta-val">
            {naturalSize ? calculateAspectRatio(naturalSize.width, naturalSize.height) : '—'}
          </span>
        </div>
        <div className="meta-item">
          <span className="meta-key">Format:</span>
          <span className="meta-val">{file.type || 'image/' + getFileExtension(file.name)}</span>
        </div>
        <div className="meta-item">
          <span className="meta-key">File Size:</span>
          <span className="meta-val">{formatBytes(file.size)}</span>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                                VIDEO PLAYER                                */
/* -------------------------------------------------------------------------- */

function VideoEvidencePlayer({ file }: { file: File }) {
  const url = useMediaPreviewUrl(file)
  const videoRef = useRef<HTMLVideoElement>(null)

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(
    null
  )

  useEffect(() => {
    setIsPlaying(false)
    setCurrentTime(0)
    setPlaybackRate(1)
  }, [file])

  const togglePlay = () => {
    if (!videoRef.current) return
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {})
      setIsPlaying(true)
    } else {
      videoRef.current.pause()
      setIsPlaying(false)
    }
  }

  // Forensic frame stepping (~25 frames per second = 0.04s per step)
  const stepFrame = (frames: number) => {
    if (!videoRef.current) return
    videoRef.current.pause()
    setIsPlaying(false)
    const frameDuration = 1 / 25
    const newTime = Math.min(
      Math.max(0, videoRef.current.currentTime + frames * frameDuration),
      duration || 0
    )
    videoRef.current.currentTime = newTime
    setCurrentTime(newTime)
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value)
    if (videoRef.current) {
      videoRef.current.currentTime = time
    }
    setCurrentTime(time)
  }

  const toggleMute = () => {
    if (!videoRef.current) return
    videoRef.current.muted = !isMuted
    setIsMuted(!isMuted)
  }

  const changeRate = (rate: number) => {
    if (!videoRef.current) return
    videoRef.current.playbackRate = rate
    setPlaybackRate(rate)
  }

  const formatVideoTimestamp = (seconds: number) => {
    if (Number.isNaN(seconds)) return '00:00.000'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 1000)
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
  }

  return (
    <div className="video-player-container">
      <div className="video-viewport">
        {url ? (
          <video
            ref={videoRef}
            src={url}
            className="evidence-video-element"
            playsInline
            onTimeUpdate={() => {
              if (videoRef.current) setCurrentTime(videoRef.current.currentTime)
            }}
            onLoadedMetadata={() => {
              if (videoRef.current) {
                setDuration(videoRef.current.duration)
                setVideoDimensions({
                  width: videoRef.current.videoWidth,
                  height: videoRef.current.videoHeight,
                })
              }
            }}
            onEnded={() => setIsPlaying(false)}
            onClick={togglePlay}
          />
        ) : (
          <div className="viewport-loading">Loading video…</div>
        )}
      </div>

      {/* Forensic Video Control Bar */}
      <div className="video-controls-bar">
        {/* Timeline Scrubber */}
        <div className="video-scrubber-row">
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.01}
            value={currentTime}
            onChange={handleSeek}
            className="video-scrubber"
            aria-label="Video timeline scrubber"
          />
        </div>

        <div className="video-controls-row">
          {/* Play/Pause & Frame Stepping */}
          <div className="controls-group">
            <button
              type="button"
              className="player-btn primary-player-btn"
              onClick={togglePlay}
              title={isPlaying ? 'Pause' : 'Play'}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause /> : <Play />}
            </button>

            <button
              type="button"
              className="player-btn"
              onClick={() => stepFrame(-1)}
              title="Step backward 1 frame (0.04s)"
              aria-label="Previous frame"
            >
              <ChevronLeft />
              <span className="step-label">-1f</span>
            </button>

            <button
              type="button"
              className="player-btn"
              onClick={() => stepFrame(1)}
              title="Step forward 1 frame (0.04s)"
              aria-label="Next frame"
            >
              <span className="step-label">+1f</span>
              <ChevronRight />
            </button>

            {/* Timestamp */}
            <div className="video-time-display">
              <span className="current-time">{formatVideoTimestamp(currentTime)}</span>
              <span className="time-divider">/</span>
              <span className="total-time">{formatVideoTimestamp(duration)}</span>
            </div>
          </div>

          {/* Speed & Volume */}
          <div className="controls-group">
            <div className="speed-selector">
              {[0.25, 0.5, 1, 2].map((rate) => (
                <button
                  key={rate}
                  type="button"
                  className={`speed-btn ${playbackRate === rate ? 'is-active' : ''}`}
                  onClick={() => changeRate(rate)}
                >
                  {rate}x
                </button>
              ))}
            </div>

            <button
              type="button"
              className="player-btn"
              onClick={toggleMute}
              title={isMuted ? 'Unmute' : 'Mute'}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX /> : <Volume2 />}
            </button>
          </div>
        </div>
      </div>

      {/* Video metadata */}
      <div className="evidence-metadata-strip">
        <div className="meta-item">
          <span className="meta-key">Resolution:</span>
          <span className="meta-val">
            {videoDimensions
              ? `${videoDimensions.width} × ${videoDimensions.height} px`
              : 'Detecting…'}
          </span>
        </div>
        <div className="meta-item">
          <span className="meta-key">Duration:</span>
          <span className="meta-val">{duration ? `${duration.toFixed(2)}s` : 'Reading…'}</span>
        </div>
        <div className="meta-item">
          <span className="meta-key">Format:</span>
          <span className="meta-val">{file.type || 'video/' + getFileExtension(file.name)}</span>
        </div>
        <div className="meta-item">
          <span className="meta-key">File Size:</span>
          <span className="meta-val">{formatBytes(file.size)}</span>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                                AUDIO PLAYER                                */
/* -------------------------------------------------------------------------- */

function AudioEvidencePlayer({ file }: { file: File }) {
  const url = useMediaPreviewUrl(file)
  const audioRef = useRef<HTMLAudioElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([])
  const [audioMeta, setAudioMeta] = useState<{ sampleRate?: number; channels?: number }>({})

  // Decode audio data for real waveform peaks
  useEffect(() => {
    let isCancelled = false

    const extractPeaks = async () => {
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        if (!AudioCtx) throw new Error('AudioContext unavailable')

        const audioCtx = new AudioCtx()
        const buffer = await file.arrayBuffer()
        const decoded = await audioCtx.decodeAudioData(buffer.slice(0))

        if (isCancelled) return

        setAudioMeta({
          sampleRate: decoded.sampleRate,
          channels: decoded.numberOfChannels,
        })
        setDuration(decoded.duration)

        const rawData = decoded.getChannelData(0)
        const totalSamples = 120
        const blockSize = Math.floor(rawData.length / totalSamples)
        const peaks: number[] = []

        for (let i = 0; i < totalSamples; i++) {
          let sum = 0
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[i * blockSize + j] || 0)
          }
          peaks.push(Math.min(1, (sum / blockSize) * 2.5))
        }

        setWaveformPeaks(peaks)
        audioCtx.close()
      } catch (err) {
        // Fallback to synthetic pseudo-waveform if decoding fails
        if (!isCancelled) {
          const fallbackPeaks = Array.from({ length: 100 }, (_, i) => {
            return 0.2 + 0.6 * Math.abs(Math.sin(i * 0.18)) * Math.cos(i * 0.05)
          })
          setWaveformPeaks(fallbackPeaks)
        }
      }
    }

    extractPeaks()

    return () => {
      isCancelled = true
    }
  }, [file])

  // Draw waveform onto canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || waveformPeaks.length === 0) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    const height = canvas.clientHeight

    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    ctx.clearRect(0, 0, width, height)

    const numBars = waveformPeaks.length
    const barWidth = Math.max(2, (width / numBars) * 0.65)
    const barGap = (width - barWidth * numBars) / (numBars - 1)
    const progress = duration > 0 ? currentTime / duration : 0

    waveformPeaks.forEach((peak, i) => {
      const x = i * (barWidth + barGap)
      const barHeight = Math.max(4, peak * (height - 12))
      const y = (height - barHeight) / 2

      const isPlayed = i / numBars <= progress

      if (isPlayed) {
        // Subtle orange accent for active playback
        ctx.fillStyle = '#ea580c'
      } else {
        // Silver / gray for unplayed
        ctx.fillStyle = '#d4d4d8'
      }

      ctx.beginPath()
      ctx.roundRect ? ctx.roundRect(x, y, barWidth, barHeight, 2) : ctx.rect(x, y, barWidth, barHeight)
      ctx.fill()
    })
  }, [waveformPeaks, currentTime, duration])

  const togglePlay = () => {
    if (!audioRef.current) return
    if (audioRef.current.paused) {
      audioRef.current.play().catch(() => {})
      setIsPlaying(true)
    } else {
      audioRef.current.pause()
      setIsPlaying(false)
    }
  }

  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current
    if (!canvas || !audioRef.current || !duration) return
    const rect = canvas.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const percent = Math.min(Math.max(0, clickX / rect.width), 1)
    const newTime = percent * duration
    audioRef.current.currentTime = newTime
    setCurrentTime(newTime)
  }

  const formatAudioTimestamp = (seconds: number) => {
    if (Number.isNaN(seconds)) return '00:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  return (
    <div className="audio-player-container">
      {url && (
        <audio
          ref={audioRef}
          src={url}
          onTimeUpdate={() => {
            if (audioRef.current) setCurrentTime(audioRef.current.currentTime)
          }}
          onLoadedMetadata={() => {
            if (audioRef.current) setDuration(audioRef.current.duration)
          }}
          onEnded={() => setIsPlaying(false)}
        />
      )}

      {/* Interactive Waveform Canvas */}
      <div className="waveform-box" onClick={handleWaveformClick} title="Click to seek">
        <canvas ref={canvasRef} className="waveform-canvas" />
      </div>

      {/* Controls Bar */}
      <div className="audio-controls-bar">
        <div className="controls-group">
          <button
            type="button"
            className="player-btn primary-player-btn"
            onClick={togglePlay}
            title={isPlaying ? 'Pause' : 'Play'}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause /> : <Play />}
          </button>

          <div className="audio-time-display">
            <span className="current-time">{formatAudioTimestamp(currentTime)}</span>
            <span className="time-divider">/</span>
            <span className="total-time">{formatAudioTimestamp(duration)}</span>
          </div>
        </div>

        <div className="controls-group">
          <div className="speed-selector">
            {[0.5, 1, 1.5].map((rate) => (
              <button
                key={rate}
                type="button"
                className={`speed-btn ${playbackRate === rate ? 'is-active' : ''}`}
                onClick={() => {
                  if (audioRef.current) audioRef.current.playbackRate = rate
                  setPlaybackRate(rate)
                }}
              >
                {rate}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Audio Metadata */}
      <div className="evidence-metadata-strip">
        <div className="meta-item">
          <span className="meta-key">Channels:</span>
          <span className="meta-val">
            {audioMeta.channels === 1 ? 'Mono (1ch)' : audioMeta.channels === 2 ? 'Stereo (2ch)' : 'Detecting…'}
          </span>
        </div>
        <div className="meta-item">
          <span className="meta-key">Sample Rate:</span>
          <span className="meta-val">
            {audioMeta.sampleRate ? `${(audioMeta.sampleRate / 1000).toFixed(1)} kHz` : 'Detecting…'}
          </span>
        </div>
        <div className="meta-item">
          <span className="meta-key">Duration:</span>
          <span className="meta-val">{duration ? `${duration.toFixed(1)}s` : 'Reading…'}</span>
        </div>
        <div className="meta-item">
          <span className="meta-key">File Size:</span>
          <span className="meta-val">{formatBytes(file.size)}</span>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                                TEXT VIEWER                                 */
/* -------------------------------------------------------------------------- */

function TextEvidenceViewer({
  file,
  onSyncContext,
}: {
  file: File
  onSyncContext?: (text: string) => void
}) {
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [synced, setSynced] = useState(false)

  useEffect(() => {
    let isCancelled = false
    setLoading(true)
    readTextFile(file)
      .then((text) => {
        if (!isCancelled) {
          setContent(text)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setContent('Failed to load text transcript.')
          setLoading(false)
        }
      })
    return () => {
      isCancelled = true
    }
  }, [file])

  const copyText = async () => {
    if (!content) return
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const syncContext = () => {
    if (!content) return
    onSyncContext?.(content)
    setSynced(true)
    setTimeout(() => setSynced(false), 2500)
  }

  const lines = useMemo(() => content.split('\n'), [content])
  const wordCount = useMemo(() => {
    const trimmed = content.trim()
    return trimmed ? trimmed.split(/\s+/).length : 0
  }, [content])

  return (
    <div className="text-viewer-container">
      {/* Transcript Toolbar */}
      <div className="viewer-toolbar">
        <div className="toolbar-group">
          <span className="transcript-stats">
            {lines.length} lines · {wordCount} words · {content.length} characters
          </span>
        </div>

        <div className="toolbar-group">
          {onSyncContext && (
            <button
              type="button"
              className={`toolbar-btn ${synced ? 'is-active text-orange-600' : ''}`}
              onClick={syncContext}
              title="Apply transcript text to analysis context"
            >
              {synced ? <Check /> : <FileText />}
              <span>{synced ? 'Synced to Context' : 'Sync to Context'}</span>
            </button>
          )}

          <button
            type="button"
            className="toolbar-btn"
            onClick={copyText}
            title="Copy full transcript"
          >
            {copied ? <Check className="text-orange-600" /> : <Copy />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/* Line-numbered scrollable transcript */}
      <div className="transcript-scroll-area">
        {loading ? (
          <div className="viewport-loading">Reading transcript…</div>
        ) : (
          <pre className="transcript-code-block">
            {lines.map((line, idx) => (
              <div key={idx} className="transcript-line">
                <span className="line-number">{idx + 1}</span>
                <span className="line-content">{line || ' '}</span>
              </div>
            ))}
          </pre>
        )}
      </div>

      {/* Transcript metadata */}
      <div className="evidence-metadata-strip">
        <div className="meta-item">
          <span className="meta-key">Type:</span>
          <span className="meta-val">Plain Text Transcript</span>
        </div>
        <div className="meta-item">
          <span className="meta-key">Encoding:</span>
          <span className="meta-val">UTF-8</span>
        </div>
        <div className="meta-item">
          <span className="meta-key">Lines:</span>
          <span className="meta-val">{lines.length}</span>
        </div>
        <div className="meta-item">
          <span className="meta-key">File Size:</span>
          <span className="meta-val">{formatBytes(file.size)}</span>
        </div>
      </div>
    </div>
  )
}

function calculateAspectRatio(width: number, height: number): string {
  if (!width || !height) return '—'
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const divisor = gcd(width, height)
  const ratioW = width / divisor
  const ratioH = height / divisor
  if (ratioW <= 16 && ratioH <= 16) return `${ratioW}:${ratioH}`
  return `${(width / height).toFixed(2)}:1`
}
