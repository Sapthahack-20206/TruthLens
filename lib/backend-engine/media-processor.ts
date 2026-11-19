import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { MediaMetadata } from './types'
import {
  validateFileSignature,
  sanitizeFilename,
  MAX_FILE_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
  MAX_AUDIO_SIZE_BYTES,
  MAX_IMAGE_SIZE_BYTES,
} from './security-utils'
import { logger } from './logger'
import { modelService } from './model-service'

const execAsync = promisify(exec)

export const ALLOWED_MIME_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/webm',
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
])

export const TEMP_BASE_DIR = path.join(os.tmpdir(), 'truthlens-forensics')

function ensureTempDir(): string {
  if (!fs.existsSync(TEMP_BASE_DIR)) {
    fs.mkdirSync(TEMP_BASE_DIR, { recursive: true })
  }
  return TEMP_BASE_DIR
}

/**
 * Periodically or on-demand purges orphaned forensic temporary files older than maxAgeMs.
 * Prevents local disk exhaustion and ensures privacy hygiene.
 */
export function purgeStaleTempFiles(maxAgeMs = 30 * 60 * 1000) {
  try {
    if (!fs.existsSync(TEMP_BASE_DIR)) return
    const now = Date.now()
    const entries = fs.readdirSync(TEMP_BASE_DIR)

    for (const entry of entries) {
      const fullPath = path.join(TEMP_BASE_DIR, entry)
      try {
        const stats = fs.statSync(fullPath)
        if (now - stats.mtimeMs > maxAgeMs) {
          if (stats.isDirectory()) {
            fs.rmSync(fullPath, { recursive: true, force: true })
          } else {
            fs.unlinkSync(fullPath)
          }
        }
      } catch {
        // Continue cleaning other entries
      }
    }
  } catch (err) {
    logger.warn('Error during stale temp file purge', err)
  }
}

export async function validateAndSaveMediaFile(
  file: File | Blob,
  originalFilename = 'evidence.bin'
): Promise<{
  savedPath: string
  metadata: MediaMetadata
  errors: string[]
}> {
  const errors: string[] = []
  const tempDir = ensureTempDir()
  
  // Clean up stale files on incoming upload
  purgeStaleTempFiles()

  // 1. Sanitize Client Filename & Defend Against Path Traversal
  const sanitizedName = sanitizeFilename(originalFilename)

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // 2. Validate Buffer Integrity & Absolute Size Limit
  if (buffer.length === 0) {
    errors.push('Uploaded file is empty (0 bytes).')
    return {
      savedPath: '',
      metadata: {
        filename: sanitizedName,
        fileSize: 0,
        mimeType: 'application/octet-stream',
        extension: path.extname(sanitizedName),
        hashSha256: '',
      },
      errors,
    }
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    errors.push(`File exceeds maximum permitted size of 100 MB (${(buffer.length / 1024 / 1024).toFixed(2)} MB).`)
    return {
      savedPath: '',
      metadata: {
        filename: sanitizedName,
        fileSize: buffer.length,
        mimeType: 'application/octet-stream',
        extension: path.extname(sanitizedName),
        hashSha256: '',
      },
      errors,
    }
  }

  // 3. Strict File Signature (Magic Bytes) Verification
  const sig = validateFileSignature(buffer, sanitizedName, file.type)
  if (!sig.isValid) {
    errors.push(sig.error || 'File validation failed: Unsupported or malformed file container.')
    return {
      savedPath: '',
      metadata: {
        filename: sanitizedName,
        fileSize: buffer.length,
        mimeType: sig.detectedMime,
        extension: sig.normalizedExt,
        hashSha256: '',
      },
      errors,
    }
  }

  // 4. Modality-Specific File Size Thresholds
  if (sig.category === 'image' && buffer.length > MAX_IMAGE_SIZE_BYTES) {
    errors.push(`Image file exceeds maximum permitted image size of 15 MB (${(buffer.length / 1024 / 1024).toFixed(2)} MB).`)
    return {
      savedPath: '',
      metadata: {
        filename: sanitizedName,
        fileSize: buffer.length,
        mimeType: sig.detectedMime,
        extension: sig.normalizedExt,
        hashSha256: '',
      },
      errors,
    }
  }

  if (sig.category === 'audio' && buffer.length > MAX_AUDIO_SIZE_BYTES) {
    errors.push(`Audio file exceeds maximum permitted audio size of 30 MB (${(buffer.length / 1024 / 1024).toFixed(2)} MB).`)
    return {
      savedPath: '',
      metadata: {
        filename: sanitizedName,
        fileSize: buffer.length,
        mimeType: sig.detectedMime,
        extension: sig.normalizedExt,
        hashSha256: '',
      },
      errors,
    }
  }

  // 5. Compute SHA-256 for Evidentiary Chain of Custody
  const hashSha256 = crypto.createHash('sha256').update(buffer).digest('hex')

  // 6. Write File using a Secure Random UUID
  // NEVER use user-controlled filenames on the filesystem!
  const fileId = crypto.randomUUID()
  const targetPath = path.join(tempDir, `${fileId}${sig.normalizedExt}`)
  fs.writeFileSync(targetPath, buffer)

  // 7. Extract Container Structural Metadata Safely
  const metadata: MediaMetadata = {
    filename: sanitizedName,
    fileSize: buffer.length,
    mimeType: sig.detectedMime,
    extension: sig.normalizedExt,
    hashSha256,
    createdAt: new Date().toISOString(),
  }

  extractContainerMetadata(buffer, sig.normalizedExt, metadata)

  return {
    savedPath: targetPath,
    metadata,
    errors,
  }
}


function extractContainerMetadata(buffer: Buffer, ext: string, out: MediaMetadata) {
  try {
    if (ext === '.jpg' || ext === '.jpeg') {
      let offset = 2
      while (offset < buffer.length - 4) {
        if (buffer[offset] === 0xFF && buffer[offset + 1] === 0xE1) {
          const exifHeader = buffer.slice(offset + 4, offset + 10).toString('ascii')
          if (exifHeader.startsWith('Exif')) {
            out.exifDetected = true
            break
          }
        }
        offset++
      }
      out.colorSpace = 'sRGB'
    } else if (ext === '.png') {
      if (buffer.length >= 24 && buffer.slice(12, 16).toString('ascii') === 'IHDR') {
        const width = buffer.readUInt32BE(16)
        const height = buffer.readUInt32BE(20)
        out.resolution = { width, height }
      }
    } else if (ext === '.wav') {
      if (buffer.slice(0, 4).toString('ascii') === 'RIFF') {
        const channels = buffer.readUInt16LE(22)
        const sampleRate = buffer.readUInt32LE(24)
        out.channels = channels
        out.sampleRate = sampleRate
      }
    } else if (ext === '.mp4' || ext === '.mov' || ext === '.m4a') {
      if (buffer.slice(4, 8).toString('ascii') === 'ftyp') {
        out.containerFormat = 'ISO/IEC 14496-12 (MPEG-4 Part 12)'
        const brand = buffer.slice(8, 12).toString('ascii')
        out.majorBrand = brand
      }
    }
  } catch {
    // Graceful fallback for non-standard buffers
  }
}

let cachedFfmpegPath: string | null = null

function ensureExecutable(binaryPath: string): string {
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(binaryPath, 0o755)
    } catch {
      // Ignore if filesystem is read-only or permission already granted
    }
  }
  return binaryPath
}

export function getFfmpegPath(): string {
  if (cachedFfmpegPath) return cachedFfmpegPath

  try {
    // 1. Try ffmpeg-static package
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegStatic = require('ffmpeg-static')
    if (ffmpegStatic && typeof ffmpegStatic === 'string' && fs.existsSync(ffmpegStatic)) {
      cachedFfmpegPath = ensureExecutable(ffmpegStatic)
      return cachedFfmpegPath
    }
  } catch {
    // Ignore and fallback
  }

  // 1b. Try cwd/node_modules/ffmpeg-static binary fallback
  try {
    const cwdBinary = path.join(
      process.cwd(),
      'node_modules',
      'ffmpeg-static',
      process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    )
    if (fs.existsSync(cwdBinary)) {
      cachedFfmpegPath = ensureExecutable(cwdBinary)
      return cachedFfmpegPath
    }
  } catch {
    // Ignore and fallback
  }

  // 2. Try FFMPEG_PATH or FFMPEG_BIN environment variable
  const envPath = process.env.FFMPEG_PATH || process.env.FFMPEG_BIN
  if (envPath && fs.existsSync(envPath)) {
    cachedFfmpegPath = ensureExecutable(envPath)
    return cachedFfmpegPath
  }

  // 3. Fallback to system ffmpeg
  cachedFfmpegPath = 'ffmpeg'
  return 'ffmpeg'
}

export async function checkFfmpegAvailable(): Promise<boolean> {
  const binary = getFfmpegPath()
  try {
    await execAsync(`"${binary}" -version`)
    return true
  } catch {
    return false
  }
}

export async function probeVideoMetadata(videoPath: string): Promise<{
  duration?: number
  resolution?: { width: number; height: number }
  fps?: number
  codec?: string
  hasAudio?: boolean
  error?: string
}> {
  const binary = getFfmpegPath()
  try {
    const { stderr } = await execAsync(`"${binary}" -i "${videoPath}"`)
    return parseFfmpegStderr(stderr)
  } catch (err: unknown) {
    // ffmpeg -i exits with code 1 if no output is provided, but prints stream details in stderr
    const errorObj = err as { stderr?: string; message?: string }
    if (errorObj?.stderr) {
      return parseFfmpegStderr(errorObj.stderr)
    }
    return { error: errorObj?.message || 'Failed to probe video stream metadata.' }
  }
}

function parseFfmpegStderr(stderr: string): {
  duration?: number
  resolution?: { width: number; height: number }
  fps?: number
  codec?: string
  hasAudio?: boolean
  error?: string
} {
  if (stderr.includes('Invalid data found') || stderr.includes('moov atom not found')) {
    return { error: 'Corrupted video container or invalid media header.' }
  }

  let duration: number | undefined
  const durMatch = stderr.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d+)/)
  if (durMatch) {
    const hours = parseInt(durMatch[1], 10)
    const mins = parseInt(durMatch[2], 10)
    const secs = parseFloat(durMatch[3])
    duration = hours * 3600 + mins * 60 + secs
  }

  let resolution: { width: number; height: number } | undefined
  const resMatch = stderr.match(/Stream.*Video:.* (\d{3,5})x(\d{3,5})/)
  if (resMatch) {
    resolution = {
      width: parseInt(resMatch[1], 10),
      height: parseInt(resMatch[2], 10),
    }
  }

  let fps: number | undefined
  const fpsMatch = stderr.match(/(\d+(?:\.\d+)?)\s*fps/)
  if (fpsMatch) {
    fps = parseFloat(fpsMatch[1])
  }

  let codec: string | undefined
  const codecMatch = stderr.match(/Video:\s*([a-zA-Z0-9_-]+)/)
  if (codecMatch) {
    codec = codecMatch[1]
  }

  const hasAudio = /Stream.*Audio:/.test(stderr)

  return { duration, resolution, fps, codec, hasAudio }
}

export async function extractVideoFrames(
  videoPath: string,
  framesDir: string,
  fps = 1,
  maxFrames = 60
): Promise<{ extractedFrames: string[]; error?: string }> {
  const binary = getFfmpegPath()
  // Validate path safety: must reside inside TEMP_BASE_DIR
  const resolvedVideo = path.resolve(videoPath)
  const resolvedFrames = path.resolve(framesDir)
  if (!resolvedVideo.startsWith(TEMP_BASE_DIR) || !resolvedFrames.startsWith(TEMP_BASE_DIR)) {
    return {
      extractedFrames: [],
      error: 'Security boundary violated: Paths must reside strictly within the forensic sandbox.',
    }
  }

  // Use safe numerical fps argument
  const safeFps = Math.max(0.1, Math.min(fps, 30))

  const isAvailable = await checkFfmpegAvailable()
  if (!isAvailable) {
    // Intelligent fallback: Extract video frames via OpenCV Python engine
    try {
      const openCvRes = await modelService.extractVideoFramesOpenCV(resolvedVideo, framesDir, safeFps, maxFrames)
      if (openCvRes.extractedFrames.length > 0) {
        return { extractedFrames: openCvRes.extractedFrames }
      }
      return {
        extractedFrames: [],
        error: openCvRes.error || 'OpenCV video frame extraction failed.',
      }
    } catch (err) {
      return {
        extractedFrames: [],
        error: `Frame extraction fallback error: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  if (!fs.existsSync(framesDir)) {
    fs.mkdirSync(framesDir, { recursive: true })
  }

  const outputPattern = path.join(framesDir, 'frame_%04d.jpg')
  const cmd = `"${binary}" -i "${resolvedVideo}" -vf fps=${safeFps} -q:v 2 -frames:v ${maxFrames} "${outputPattern}" -y`

  try {
    await execAsync(cmd)
    const files = fs.readdirSync(framesDir)
      .filter((f) => f.startsWith('frame_') && f.endsWith('.jpg'))
      .sort()
      .map((f) => path.join(framesDir, f))
    return { extractedFrames: files }
  } catch (err) {
    return {
      extractedFrames: [],
      error: err instanceof Error ? err.message : 'FFmpeg frame extraction failed.',
    }
  }
}

export async function extractAudioTrack(
  videoPath: string,
  outputAudioPath: string
): Promise<{ audioPath?: string; error?: string }> {
  const binary = getFfmpegPath()
  const resolvedVideo = path.resolve(videoPath)
  const resolvedAudio = path.resolve(outputAudioPath)
  if (!resolvedVideo.startsWith(TEMP_BASE_DIR) || !resolvedAudio.startsWith(TEMP_BASE_DIR)) {
    return {
      error: 'Security boundary violated: Audio extraction path outside forensic sandbox.',
    }
  }

  const isAvailable = await checkFfmpegAvailable()
  if (!isAvailable) {
    return {
      error: 'FFmpeg binary is not installed or available in PATH. Audio track extraction skipped.',
    }
  }

  const cmd = `"${binary}" -i "${resolvedVideo}" -vn -acodec pcm_s16le -ar 44100 -ac 2 "${resolvedAudio}" -y`
  try {
    await execAsync(cmd)
    if (fs.existsSync(resolvedAudio) && fs.statSync(resolvedAudio).size > 0) {
      return { audioPath: resolvedAudio }
    }
    return { error: 'Extracted audio file is empty or video had no audio stream.' }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'FFmpeg audio extraction failed.',
    }
  }
}

export function cleanupTempFiles(...paths: (string | undefined | null)[]) {
  for (const p of paths) {
    if (!p) continue
    try {
      const resolved = path.resolve(p)
      // Only delete files within TEMP_BASE_DIR for safety
      if (resolved.startsWith(TEMP_BASE_DIR) && fs.existsSync(resolved)) {
        const stat = fs.statSync(resolved)
        if (stat.isDirectory()) {
          fs.rmSync(resolved, { recursive: true, force: true })
        } else {
          fs.unlinkSync(resolved)
        }
      }
    } catch {
      // Ignore cleanup error in sandbox
    }
  }
}
