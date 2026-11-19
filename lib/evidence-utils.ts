/**
 * Evidence Utilities for TruthLens Forensics Workspace
 * Validates, formats, hashes, and parses multimodal digital evidence files.
 */

export type EvidenceCategory = 'image' | 'video' | 'audio' | 'text' | 'unknown'

export interface EvidenceValidationResult {
  valid: boolean
  category: EvidenceCategory
  error?: string
}

export const EVIDENCE_CONSTRAINTS = {
  video: {
    extensions: ['mp4', 'mov', 'webm'],
    mimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
    maxBytes: 100 * 1024 * 1024, // 100 MB
    label: 'Video (MP4, MOV, WEBM)',
  },
  audio: {
    extensions: ['mp3', 'wav', 'm4a'],
    mimeTypes: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/aac'],
    maxBytes: 30 * 1024 * 1024, // 30 MB
    label: 'Audio (MP3, WAV, M4A)',
  },
  image: {
    extensions: ['jpg', 'jpeg', 'png', 'webp'],
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: 15 * 1024 * 1024, // 15 MB
    label: 'Image (JPG, JPEG, PNG, WEBP)',
  },
  text: {
    extensions: ['txt'],
    mimeTypes: ['text/plain'],
    maxBytes: 5 * 1024 * 1024, // 5 MB
    label: 'Transcript / Context (TXT)',
  },
} as const

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

export function getFileExtension(filename: string): string {
  const parts = filename.split('.')
  if (parts.length <= 1) return ''
  return parts.pop()?.toLowerCase() ?? ''
}

export function getEvidenceCategory(file: File): EvidenceCategory {
  const ext = getFileExtension(file.name)
  const mime = file.type.toLowerCase()

  if (EVIDENCE_CONSTRAINTS.image.extensions.includes(ext as any) || mime.startsWith('image/')) {
    return 'image'
  }
  if (EVIDENCE_CONSTRAINTS.video.extensions.includes(ext as any) || mime.startsWith('video/')) {
    return 'video'
  }
  if (EVIDENCE_CONSTRAINTS.audio.extensions.includes(ext as any) || mime.startsWith('audio/')) {
    return 'audio'
  }
  if (EVIDENCE_CONSTRAINTS.text.extensions.includes(ext as any) || mime === 'text/plain') {
    return 'text'
  }
  return 'unknown'
}

/**
 * Validates a single evidence file against category restrictions and size limits.
 */
export function validateEvidenceFile(
  file: File,
  allowedCategories: EvidenceCategory[]
): EvidenceValidationResult {
  const ext = getFileExtension(file.name)
  const category = getEvidenceCategory(file)

  if (file.size === 0) {
    return {
      valid: false,
      category,
      error: `File "${file.name}" is empty (0 bytes).`,
    }
  }

  if (category === 'unknown' || !allowedCategories.includes(category)) {
    const allowedLabels = allowedCategories
      .map((cat) => {
        if (cat === 'image') return 'Images (JPG, JPEG, PNG, WEBP)'
        if (cat === 'video') return 'Video (MP4, MOV, WEBM)'
        if (cat === 'audio') return 'Audio (MP3, WAV, M4A)'
        if (cat === 'text') return 'Text (TXT)'
        return cat
      })
      .join(', ')

    return {
      valid: false,
      category,
      error: `Format ".${ext || 'unknown'}" is not supported for this analysis mode. Allowed formats: ${allowedLabels}.`,
    }
  }

  // Check specific category extension and size
  const knownCat = category as 'video' | 'audio' | 'image' | 'text'
  const constraint = EVIDENCE_CONSTRAINTS[knownCat]
  if (!(constraint.extensions as readonly string[]).includes(ext)) {
    return {
      valid: false,
      category,
      error: `File extension ".${ext}" is not permitted for ${category} evidence. Supported: ${constraint.extensions.join(', ').toUpperCase()}.`,
    }
  }

  if (file.size > constraint.maxBytes) {
    return {
      valid: false,
      category,
      error: `File "${file.name}" (${formatBytes(file.size)}) exceeds the maximum allowed limit of ${formatBytes(constraint.maxBytes)} for ${category} files.`,
    }
  }

  return {
    valid: true,
    category,
  }
}

/**
 * Computes the SHA-256 cryptographic hash of a file for digital forensics chain of custody.
 */
export async function calculateFileSha256(file: File): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer()
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch (err) {
    console.error('Failed to compute SHA-256 hash:', err)
    return 'Unavailable'
  }
}

/**
 * Reads the text content of a TXT transcript file.
 */
export async function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('Failed to read text file.'))
    reader.readAsText(file)
  })
}
