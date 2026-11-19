'use client'

import React, { useRef, useState, useMemo, useCallback } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  AudioLines,
  Check,
  FileAudio,
  FileCheck,
  FileImage,
  FileText,
  FileVideo,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  EVIDENCE_CONSTRAINTS,
  formatBytes,
  getEvidenceCategory,
  getFileExtension,
  validateEvidenceFile,
  type EvidenceCategory,
} from '@/lib/evidence-utils'

interface MediaUploadProps {
  files: File[]
  onFilesChange: (files: File[]) => void
  section: string
  isBusy?: boolean
  uploadProgress?: number | null
  activeFileIndex?: number
  onSelectFileIndex?: (index: number) => void
}

export default function MediaUpload({
  files,
  onFilesChange,
  section,
  isBusy = false,
  uploadProgress = null,
  activeFileIndex = 0,
  onSelectFileIndex,
}: MediaUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const [replacingIndex, setReplacingIndex] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)

  const [validationErrors, setValidationErrors] = useState<string[]>([])

  // Determine allowed categories and limits based on section
  const { allowedCategories, isMultiFile, acceptMimeString, formatSummary } = useMemo(() => {
    let cats: EvidenceCategory[] = []
    let multi = false

    if (section === 'image-analysis') {
      cats = ['image']
    } else if (section === 'video-analysis') {
      cats = ['video']
    } else if (section === 'audio-analysis') {
      cats = ['audio']
    } else {
      // cross-modal or default
      cats = ['image', 'video', 'audio', 'text']
      multi = true
    }

    const mimeTypes: string[] = []
    const extLabels: string[] = []

    cats.forEach((cat) => {
      if (cat === 'unknown') return
      const c = EVIDENCE_CONSTRAINTS[cat]
      mimeTypes.push(...c.mimeTypes)
      extLabels.push(...(c.extensions as readonly string[]).map((e: string) => e.toUpperCase()))
    })

    return {
      allowedCategories: cats,
      isMultiFile: multi,
      acceptMimeString: mimeTypes.join(','),
      formatSummary: extLabels.join(', '),
    }
  }, [section])

  // Handle incoming files from drop or picker
  const processIncomingFiles = useCallback(
    (incoming: FileList | File[] | null) => {
      if (!incoming || incoming.length === 0) return

      const candidates = Array.from(incoming)
      const validFiles: File[] = []
      const errors: string[] = []

      candidates.forEach((file) => {
        const result = validateEvidenceFile(file, allowedCategories)
        if (result.valid) {
          validFiles.push(file)
        } else if (result.error) {
          errors.push(result.error)
        }
      })

      if (errors.length > 0) {
        setValidationErrors(errors)
      } else {
        setValidationErrors([])
      }

      if (validFiles.length > 0) {
        if (isMultiFile) {
          // Append up to 10 files total in cross-modal
          onFilesChange([...files, ...validFiles].slice(0, 10))
        } else {
          // Replace with the single valid candidate
          onFilesChange(validFiles.slice(0, 1))
        }
      }
    },
    [allowedCategories, files, isMultiFile, onFilesChange]
  )

  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current += 1
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current -= 1
    if (dragCounter.current <= 0) {
      setIsDragging(false)
      dragCounter.current = 0
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    dragCounter.current = 0

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processIncomingFiles(e.dataTransfer.files)
      e.dataTransfer.clearData()
    }
  }

  // File replacement logic
  const handleTriggerReplace = (index: number) => {
    setReplacingIndex(index)
    replaceInputRef.current?.click()
  }

  const handleReplaceFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const incoming = e.target.files?.[0]
    e.target.value = ''
    if (!incoming || replacingIndex === null) return

    const result = validateEvidenceFile(incoming, allowedCategories)
    if (!result.valid) {
      setValidationErrors([result.error || 'Replacement file is invalid.'])
      return
    }

    setValidationErrors([])
    const updated = [...files]
    updated[replacingIndex] = incoming
    onFilesChange(updated)
    setReplacingIndex(null)
  }

  // Remove individual file
  const handleRemoveFile = (index: number) => {
    const updated = files.filter((_, idx) => idx !== index)
    onFilesChange(updated)
    if (activeFileIndex >= updated.length) {
      onSelectFileIndex?.(Math.max(0, updated.length - 1))
    }
  }

  // Clear all files
  const handleClearAll = () => {
    onFilesChange([])
    setValidationErrors([])
  }

  const totalBytes = useMemo(() => files.reduce((acc, f) => acc + f.size, 0), [files])

  return (
    <div className="media-upload-container">
      {/* Hidden standard file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple={isMultiFile}
        accept={acceptMimeString}
        className="sr-only"
        onChange={(e) => {
          processIncomingFiles(e.target.files)
          e.currentTarget.value = ''
        }}
        aria-label="Upload evidence file"
        disabled={isBusy}
      />

      <input
        ref={replaceInputRef}
        type="file"
        accept={acceptMimeString}
        className="sr-only"
        onChange={handleReplaceFileChange}
        aria-label="Replace evidence file"
        disabled={isBusy}
      />

      {/* Interactive Drop Zone */}
      <div
        className={`evidence-drop-zone ${isDragging ? 'is-dragging' : ''} ${files.length > 0 ? 'has-files' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div className="drop-zone-content">
          <div className="drop-zone-icon-box">
            <Upload className={`drop-zone-icon ${isDragging ? 'text-orange-600' : ''}`} aria-hidden="true" />
          </div>

          <h3 className="drop-zone-title">
            {isDragging ? 'Release to stage digital evidence' : 'Drag & drop evidence files here'}
          </h3>

          <p className="drop-zone-subtitle">
            or{' '}
            <button
              type="button"
              className="inline-action"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
            >
              browse device files
            </button>
          </p>

          <div className="drop-zone-formats">
            <span className="formats-label">Supported Evidence Formats:</span>
            <div className="format-tags-list">
              {allowedCategories.includes('video') && (
                <span className="format-tag">
                  <FileVideo className="tag-icon" /> Video (MP4, MOV, WEBM)
                </span>
              )}
              {allowedCategories.includes('audio') && (
                <span className="format-tag">
                  <FileAudio className="tag-icon" /> Audio (MP3, WAV, M4A)
                </span>
              )}
              {allowedCategories.includes('image') && (
                <span className="format-tag">
                  <FileImage className="tag-icon" /> Images (JPG, JPEG, PNG, WEBP)
                </span>
              )}
              {allowedCategories.includes('text') && (
                <span className="format-tag">
                  <FileText className="tag-icon" /> Transcripts (TXT)
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Validation Feedback Banner */}
      {validationErrors.length > 0 && (
        <div className="evidence-validation-alert" role="alert">
          <AlertTriangle className="alert-icon text-orange-600" aria-hidden="true" />
          <div className="alert-content">
            <strong>Evidence file validation notice</strong>
            <ul>
              {validationErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            className="alert-dismiss-btn"
            onClick={() => setValidationErrors([])}
            aria-label="Dismiss validation warnings"
          >
            <X />
          </button>
        </div>
      )}

      {/* Staged Evidence File List */}
      {files.length > 0 && (
        <div className="staged-evidence-panel">
          <div className="staged-evidence-header">
            <div className="staged-header-title">
              <span className="eyebrow">STAGED EVIDENCE ({files.length})</span>
              <span className="staged-size-pill">Total: {formatBytes(totalBytes)}</span>
            </div>

            <div className="staged-header-actions">
              {isMultiFile && files.length < 10 && (
                <button
                  type="button"
                  className="staged-subtle-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isBusy}
                  title="Add another evidence file"
                >
                  <Plus className="btn-icon" />
                  <span>Add File</span>
                </button>
              )}

              <button
                type="button"
                className="staged-subtle-btn text-destructive"
                onClick={handleClearAll}
                disabled={isBusy}
                title="Clear all staged files"
              >
                <Trash2 className="btn-icon" />
                <span>Clear All</span>
              </button>
            </div>
          </div>

          <div className="staged-files-list">
            {files.map((file, index) => {
              const cat = getEvidenceCategory(file)
              const ext = getFileExtension(file.name).toUpperCase()
              const isSelected = index === activeFileIndex

              return (
                <div
                  key={`${file.name}-${index}`}
                  className={`staged-file-card ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => onSelectFileIndex?.(index)}
                >
                  <div className="file-card-main">
                    <span className="file-type-icon">
                      {cat === 'image' && <FileImage />}
                      {cat === 'video' && <FileVideo />}
                      {cat === 'audio' && <FileAudio />}
                      {cat === 'text' && <FileText />}
                    </span>

                    <div className="file-details">
                      <div className="file-name-row">
                        <strong className="file-name" title={file.name}>
                          {file.name}
                        </strong>
                        <span className="file-ext-badge">{ext}</span>
                      </div>
                      <div className="file-meta-row">
                        <span className="file-size">{formatBytes(file.size)}</span>
                        <span className="meta-dot">·</span>
                        <span className="file-category-label">{cat} evidence</span>
                        <span className="meta-dot">·</span>
                        <span className="file-status-label">
                          {isBusy && uploadProgress !== null ? (
                            <span className="status-uploading">Uploading ({uploadProgress}%)</span>
                          ) : (
                            <span className="status-ready">Ready for analysis</span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Individual File Actions */}
                  <div className="file-card-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="file-action-icon-btn"
                      onClick={() => handleTriggerReplace(index)}
                      disabled={isBusy}
                      title={`Replace ${file.name}`}
                      aria-label={`Replace ${file.name}`}
                    >
                      <RefreshCw />
                    </button>

                    <button
                      type="button"
                      className="file-action-icon-btn text-destructive"
                      onClick={() => handleRemoveFile(index)}
                      disabled={isBusy}
                      title={`Remove ${file.name}`}
                      aria-label={`Remove ${file.name}`}
                    >
                      <Trash2 />
                    </button>
                  </div>

                  {/* Individual upload progress bar */}
                  {isBusy && uploadProgress !== null && (
                    <div className="file-card-progress-bar">
                      <div
                        className="file-card-progress-fill"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
