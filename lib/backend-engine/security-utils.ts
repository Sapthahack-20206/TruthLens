import path from 'node:path'

export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024 // 100 MB overall limit
export const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024 // 100 MB
export const MAX_AUDIO_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB
export const MAX_IMAGE_SIZE_BYTES = 25 * 1024 * 1024 // 25 MB
export const MAX_CONTEXT_LENGTH = 5000 // 5,000 characters max for supplied notes/context

export const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{3,64}$/

// Dangerous file extensions that must NEVER be accepted under any circumstances
const DANGEROUS_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.bash', '.ps1', '.vbs', '.js', '.mjs', '.cjs',
  '.ts', '.php', '.php3', '.php4', '.php5', '.phtml', '.py', '.rb', '.pl', '.cgi',
  '.jar', '.msi', '.dll', '.scr', '.com', '.pif', '.hta', '.cpl', '.wsf', '.reg',
  '.html', '.htm', '.xhtml', '.svg', '.svgz', '.xml', '.shtml', '.jsp', '.asp',
  '.aspx', '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar', '.iso', '.bin'
])

export const ALLOWED_EXTENSIONS = new Set([
  '.mp4', '.mov', '.avi', '.webm',
  '.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg',
  '.jpg', '.jpeg', '.png', '.webp',
  '.txt'
])

export interface FileSignatureResult {
  isValid: boolean
  category?: 'video' | 'audio' | 'image'
  detectedMime: string
  normalizedExt: string
  error?: string
}

/**
 * Validates actual binary magic bytes of an uploaded buffer.
 * Defends against MIME/extension spoofing and rejects dangerous files.
 */
export function validateFileSignature(
  buffer: Buffer,
  declaredFilename: string,
  declaredMime?: string
): FileSignatureResult {
  if (buffer.length < 4) {
    return {
      isValid: false,
      detectedMime: declaredMime || 'application/octet-stream',
      normalizedExt: '',
      error: 'File is too small or truncated to contain a valid media header.',
    }
  }

  // 1. Check for Dangerous Executable / Script / Archive Magic Bytes
  // Windows DOS / PE executable header: "MZ" (0x4D, 0x5A)
  if (buffer[0] === 0x4D && buffer[1] === 0x5A) {
    return {
      isValid: false,
      detectedMime: 'application/x-dosexec',
      normalizedExt: '.exe',
      error: 'Security Violation: Uploaded file is a Windows/DOS executable. Executable binaries are strictly blocked.',
    }
  }

  // Linux ELF executable header: 0x7F 'E' 'L' 'F'
  if (buffer[0] === 0x7F && buffer[1] === 0x45 && buffer[2] === 0x4C && buffer[3] === 0x46) {
    return {
      isValid: false,
      detectedMime: 'application/x-executable',
      normalizedExt: '.elf',
      error: 'Security Violation: Uploaded file is an ELF executable binary. Executable files are strictly blocked.',
    }
  }

  // Shell script shebang: "#!" (0x23, 0x21)
  if (buffer[0] === 0x23 && buffer[1] === 0x21) {
    return {
      isValid: false,
      detectedMime: 'text/x-shellscript',
      normalizedExt: '.sh',
      error: 'Security Violation: Uploaded file is a shell script. Script files are strictly blocked.',
    }
  }

  // Zip Archive / Office document: "PK\x03\x04"
  if (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return {
      isValid: false,
      detectedMime: 'application/zip',
      normalizedExt: '.zip',
      error: 'Security Violation: Zip/archive containers are not accepted for direct media forensic inspection.',
    }
  }

  // Check for HTML / XML / Script Injection in initial ASCII window
  const asciiHeader = buffer.slice(0, Math.min(256, buffer.length)).toString('utf-8').toLowerCase()
  if (
    asciiHeader.includes('<html') ||
    asciiHeader.includes('<script') ||
    asciiHeader.includes('<?php') ||
    asciiHeader.includes('<!doctype html') ||
    asciiHeader.includes('<svg')
  ) {
    return {
      isValid: false,
      detectedMime: 'text/html',
      normalizedExt: '.html',
      error: 'Security Violation: File contains HTML/XML/Script tags. Web script files are strictly blocked.',
    }
  }

  // 2. Extract and check declared extension
  const rawExt = path.extname(declaredFilename).toLowerCase()
  if (DANGEROUS_EXTENSIONS.has(rawExt)) {
    return {
      isValid: false,
      detectedMime: declaredMime || 'application/octet-stream',
      normalizedExt: rawExt,
      error: `Security Violation: File extension "${rawExt}" is blacklisted for security safety.`,
    }
  }

  // 3. Inspect Media Magic Bytes
  // --- A. JPEG (0xFF, 0xD8, 0xFF) ---
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return {
      isValid: true,
      category: 'image',
      detectedMime: 'image/jpeg',
      normalizedExt: '.jpg',
    }
  }

  // --- B. PNG (0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A) ---
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4E &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0D &&
    buffer[5] === 0x0A &&
    buffer[6] === 0x1A &&
    buffer[7] === 0x0A
  ) {
    return {
      isValid: true,
      category: 'image',
      detectedMime: 'image/png',
      normalizedExt: '.png',
    }
  }

  // --- C. WebP (RIFF....WEBP) ---
  if (
    buffer.length >= 12 &&
    buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    buffer.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return {
      isValid: true,
      category: 'image',
      detectedMime: 'image/webp',
      normalizedExt: '.webp',
    }
  }

  // --- D. WAV Audio (RIFF....WAVE) ---
  if (
    buffer.length >= 12 &&
    buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    buffer.slice(8, 12).toString('ascii') === 'WAVE'
  ) {
    return {
      isValid: true,
      category: 'audio',
      detectedMime: 'audio/wav',
      normalizedExt: '.wav',
    }
  }

  // --- E. AVI Video (RIFF....AVI ) ---
  if (
    buffer.length >= 12 &&
    buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    (buffer.slice(8, 12).toString('ascii') === 'AVI ' || buffer.slice(8, 12).toString('ascii') === 'AVIX')
  ) {
    return {
      isValid: true,
      category: 'video',
      detectedMime: 'video/x-msvideo',
      normalizedExt: '.avi',
    }
  }

  // --- F. WebM / Matroska (0x1A, 0x45, 0xDF, 0xA3) ---
  if (
    buffer[0] === 0x1A &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xDF &&
    buffer[3] === 0xA3
  ) {
    return {
      isValid: true,
      category: 'video',
      detectedMime: 'video/webm',
      normalizedExt: '.webm',
    }
  }

  // --- G. MP4 / MOV / M4A (ftyp atom at offset 4) ---
  if (buffer.length >= 12 && buffer.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.slice(8, 12).toString('ascii').trim().toLowerCase()
    const isM4A = brand === 'm4a' || brand === 'm4b'
    return {
      isValid: true,
      category: isM4A ? 'audio' : 'video',
      detectedMime: isM4A ? 'audio/mp4' : 'video/mp4',
      normalizedExt: isM4A ? '.m4a' : rawExt === '.mov' ? '.mov' : '.mp4',
    }
  }

  // Alternative MP4: moov or mdat atom directly at start (offset 4)
  if (
    buffer.length >= 8 &&
    (buffer.slice(4, 8).toString('ascii') === 'moov' || buffer.slice(4, 8).toString('ascii') === 'mdat')
  ) {
    return {
      isValid: true,
      category: 'video',
      detectedMime: 'video/mp4',
      normalizedExt: '.mp4',
    }
  }

  // --- H. MP3 Audio (ID3 tag or MPEG sync word) ---
  // ID3v2 header: 'ID3' (0x49, 0x44, 0x33)
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
    return {
      isValid: true,
      category: 'audio',
      detectedMime: 'audio/mpeg',
      normalizedExt: '.mp3',
    }
  }
  // MPEG Audio Sync Word (0xFF followed by 0xFB, 0xF3, 0xF2, 0xFA, 0xE3)
  if (buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0) {
    return {
      isValid: true,
      category: 'audio',
      detectedMime: 'audio/mpeg',
      normalizedExt: '.mp3',
    }
  }

  // --- I. FLAC Audio (0x66, 0x4C, 0x61, 0x43 - 'fLaC') ---
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x66 &&
    buffer[1] === 0x4C &&
    buffer[2] === 0x61 &&
    buffer[3] === 0x43
  ) {
    return {
      isValid: true,
      category: 'audio',
      detectedMime: 'audio/flac',
      normalizedExt: '.flac',
    }
  }

  // --- J. OGG Audio/Container (0x4F, 0x67, 0x67, 0x53 - 'OggS') ---
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x4F &&
    buffer[1] === 0x67 &&
    buffer[2] === 0x67 &&
    buffer[3] === 0x53
  ) {
    return {
      isValid: true,
      category: 'audio',
      detectedMime: 'audio/ogg',
      normalizedExt: '.ogg',
    }
  }

  // --- K. AAC Audio (ADTS sync word: 0xFFF) ---
  if (
    buffer.length >= 2 &&
    buffer[0] === 0xFF &&
    (buffer[1] & 0xF6) === 0xF0
  ) {
    return {
      isValid: true,
      category: 'audio',
      detectedMime: 'audio/aac',
      normalizedExt: '.aac',
    }
  }

  // --- L. Plain Text / Transcript (.txt) ---
  if (rawExt === '.txt') {
    let isBinary = false
    const checkLen = Math.min(buffer.length, 1024)
    for (let i = 0; i < checkLen; i++) {
      const byte = buffer[i]
      if (byte === 0 || (byte < 7 && byte !== 9 && byte !== 10 && byte !== 13)) {
        isBinary = true
        break
      }
    }
    if (!isBinary) {
      return {
        isValid: true,
        detectedMime: 'text/plain',
        normalizedExt: '.txt',
      }
    }
  }

  // 4. If declared extension is in allowed list but magic byte didn't match known format:
  // Reject as potential file masquerading / spoofing attack!
  return {
    isValid: false,
    detectedMime: declaredMime || 'application/octet-stream',
    normalizedExt: rawExt,
    error: `File signature mismatch: File bytes do not match a valid media container (JPEG, PNG, WebP, MP4, WebM, AVI, WAV, MP3). Spoofed files are prohibited.`,
  }
}

/**
 * Strictly sanitizes client-provided filenames to prevent path traversal,
 * null byte injection, control character abuse, and shell injection.
 */
export function sanitizeFilename(rawFilename: string): string {
  if (!rawFilename || typeof rawFilename !== 'string') {
    return `evidence_${Date.now()}.bin`
  }

  // 1. Remove any directory path components (both POSIX / and Windows \)
  let clean = path.basename(rawFilename.replace(/\\/g, '/'))

  // 2. Remove null bytes and control characters
  clean = clean.replace(/[\x00-\x1F\x7F-\x9F]/g, '')

  // 3. Remove traversal dots and dangerous Windows characters
  clean = clean.replace(/[<>:"/\\|?*]/g, '_')
  clean = clean.replace(/^\.+/, '') // remove leading dots (hidden files)

  // 4. Retain only safe alphanumeric characters, dashes, underscores, and single dot for ext
  const ext = path.extname(clean).toLowerCase()
  const nameWithoutExt = path.basename(clean, ext)
  const safeBase = nameWithoutExt.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10)

  if (!safeBase) {
    return `evidence_${Date.now()}${safeExt || '.bin'}`
  }

  return `${safeBase}${safeExt}`
}

/**
 * Validates request identifier parameters (investigationId, reportId, taskId).
 */
export function validateIdParam(id: unknown): string | null {
  if (typeof id !== 'string') return null
  const trimmed = id.trim()
  if (!SAFE_ID_REGEX.test(trimmed)) {
    return null
  }
  return trimmed
}

/**
 * Sanitizes supplied user context / notes string.
 */
export function sanitizeContextString(context: unknown): string {
  if (typeof context !== 'string') return ''
  return context
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // remove non-whitespace control chars
    .trim()
    .slice(0, MAX_CONTEXT_LENGTH)
}
