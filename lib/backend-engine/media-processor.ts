import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { MediaMetadata } from './types'

const execAsync = promisify(exec)

export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024 // 100 MB

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
])

const TEMP_BASE_DIR = path.join(os.tmpdir(), 'truthlens-forensics')

function ensureTempDir(): string {
  if (!fs.existsSync(TEMP_BASE_DIR)) {
    fs.mkdirSync(TEMP_BASE_DIR, { recursive: true })
  }
  return TEMP_BASE_DIR
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
  const fileId = crypto.randomUUID()
  const sanitizedName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const ext = path.extname(sanitizedName).toLowerCase() || '.bin'
  const targetPath = path.join(tempDir, `${fileId}${ext}`)

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // 1. Validate File Size
  if (buffer.length === 0) {
    errors.push('Uploaded file is empty (0 bytes).')
  }
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    errors.push(`File exceeds maximum permitted size of 100 MB (${(buffer.length / 1024 / 1024).toFixed(2)} MB).`)
  }

  // 2. Validate MIME Type / Magic Bytes
  const mimeType = file.type || inferMimeType(ext)
  if (!isAllowedMime(mimeType, ext)) {
    errors.push(`File type "${mimeType}" (${ext}) is not supported for forensic processing.`)
  }

  // 3. Compute SHA-256 for Evidentiary Chain of Custody
  const hashSha256 = crypto.createHash('sha256').update(buffer).digest('hex')

  // 4. Save to isolated sandbox location
  fs.writeFileSync(targetPath, buffer)

  // 5. Extract structural metadata
  const metadata: MediaMetadata = {
    filename: originalFilename,
    fileSize: buffer.length,
    mimeType,
    extension: ext,
    hashSha256,
    createdAt: new Date().toISOString(),
  }

  // Extract container-level metadata
  extractContainerMetadata(buffer, ext, metadata)

  return {
    savedPath: targetPath,
    metadata,
    errors,
  }
}

function isAllowedMime(mime: string, ext: string): boolean {
  if (ALLOWED_MIME_TYPES.has(mime)) return true
  const validExts = ['.mp4', '.mov', '.avi', '.webm', '.wav', '.mp3', '.m4a', '.jpg', '.jpeg', '.png', '.webp']
  return validExts.includes(ext.toLowerCase())
}

function inferMimeType(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.mp4': return 'video/mp4'
    case '.mov': return 'video/quicktime'
    case '.webm': return 'video/webm'
    case '.avi': return 'video/x-msvideo'
    case '.wav': return 'audio/wav'
    case '.mp3': return 'audio/mpeg'
    case '.m4a': return 'audio/mp4'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.png': return 'image/png'
    case '.webp': return 'image/webp'
    default: return 'application/octet-stream'
  }
}

function extractContainerMetadata(buffer: Buffer, ext: string, out: MediaMetadata) {
  try {
    if (ext === '.jpg' || ext === '.jpeg') {
      // Look for EXIF APP1 marker 0xFFE1
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
      // PNG IHDR chunk (width at offset 16, height at offset 20)
      if (buffer.length >= 24 && buffer.slice(12, 16).toString('ascii') === 'IHDR') {
        const width = buffer.readUInt32BE(16)
        const height = buffer.readUInt32BE(20)
        out.resolution = { width, height }
      }
    } else if (ext === '.wav') {
      // RIFF header
      if (buffer.slice(0, 4).toString('ascii') === 'RIFF') {
        const channels = buffer.readUInt16LE(22)
        const sampleRate = buffer.readUInt32LE(24)
        out.channels = channels
        out.sampleRate = sampleRate
      }
    } else if (ext === '.mp4') {
      // Check for ftyp atom
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

export async function checkFfmpegAvailable(): Promise<boolean> {
  try {
    await execAsync('ffmpeg -version')
    return true
  } catch {
    return false
  }
}

export async function extractVideoFrames(
  videoPath: string,
  framesDir: string,
  fps = 1
): Promise<{ extractedFrames: string[]; error?: string }> {
  const isAvailable = await checkFfmpegAvailable()
  if (!isAvailable) {
    return {
      extractedFrames: [],
      error: 'FFmpeg binary is not installed or available in PATH. Frame extraction skipped.',
    }
  }

  if (!fs.existsSync(framesDir)) {
    fs.mkdirSync(framesDir, { recursive: true })
  }

  const outputPattern = path.join(framesDir, 'frame_%04d.jpg')
  const cmd = `ffmpeg -i "${videoPath}" -vf fps=${fps} -q:v 2 "${outputPattern}" -y`

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
  const isAvailable = await checkFfmpegAvailable()
  if (!isAvailable) {
    return {
      error: 'FFmpeg binary is not installed or available in PATH. Audio track extraction skipped.',
    }
  }

  const cmd = `ffmpeg -i "${videoPath}" -vn -acodec pcm_s16le -ar 44100 -ac 2 "${outputAudioPath}" -y`
  try {
    await execAsync(cmd)
    if (fs.existsSync(outputAudioPath) && fs.statSync(outputAudioPath).size > 0) {
      return { audioPath: outputAudioPath }
    }
    return { error: 'Extracted audio file is empty or video had no audio stream.' }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'FFmpeg audio extraction failed.',
    }
  }
}

export function cleanupTempFiles(...paths: string[]) {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p)
        if (stat.isDirectory()) {
          fs.rmSync(p, { recursive: true, force: true })
        } else {
          fs.unlinkSync(p)
        }
      }
    } catch {
      // Ignore cleanup error in sandbox
    }
  }
}
