import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { UploadedFileEvidence, MediaMetadata, MediaType } from './types'

const execFileAsync = promisify(execFile)

export const MAX_FILE_SIZES = {
  image: 15 * 1024 * 1024, // 15 MB
  audio: 30 * 1024 * 1024, // 30 MB
  video: 75 * 1024 * 1024, // 75 MB
  'cross-modal': 75 * 1024 * 1024,
  text: 5 * 1024 * 1024,
}

export const ALLOWED_MIME_TYPES: Record<MediaType, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  audio: ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac'],
  video: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'],
  'cross-modal': [
    'image/jpeg', 'image/png', 'image/webp',
    'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a',
    'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm',
    'text/plain', 'application/pdf'
  ],
  text: ['text/plain', 'application/pdf', 'application/json']
}

export const MAGIC_NUMBERS = {
  jpeg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  webp: [0x52, 0x49, 0x46, 0x46], // 'RIFF', then WEBP at offset 8
  riff_wav: [0x52, 0x49, 0x46, 0x46], // 'RIFF', then WAVE at offset 8
  mp3_id3: [0x49, 0x44, 0x33], // 'ID3'
  mp4_ftyp: [0x66, 0x74, 0x79, 0x70], // 'ftyp' at offset 4
  avi: [0x52, 0x49, 0x46, 0x46], // 'RIFF', then AVI at offset 8
  pdf: [0x25, 0x50, 0x44, 0x46] // '%PDF'
}

let ffmpegPathCache: string | null | undefined = undefined
let ffprobePathCache: string | null | undefined = undefined

/**
 * Checks for FFmpeg executable in environment or system path
 */
export async function getFFmpegPath(): Promise<string | null> {
  if (ffmpegPathCache !== undefined) return ffmpegPathCache

  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    ffmpegPathCache = process.env.FFMPEG_PATH
    return ffmpegPathCache
  }

  const lookupCmd = process.platform === 'win32' ? 'where.exe' : 'which'
  try {
    const { stdout } = await execFileAsync(lookupCmd, ['ffmpeg'])
    const candidate = stdout.trim().split(/\r?\n/)[0]
    if (candidate && fs.existsSync(candidate)) {
      ffmpegPathCache = candidate
      return ffmpegPathCache
    }
  } catch {
    // not in system PATH
  }

  ffmpegPathCache = null
  return null
}

/**
 * Checks for FFprobe executable in environment or system path
 */
export async function getFFprobePath(): Promise<string | null> {
  if (ffprobePathCache !== undefined) return ffprobePathCache

  if (process.env.FFPROBE_PATH && fs.existsSync(process.env.FFPROBE_PATH)) {
    ffprobePathCache = process.env.FFPROBE_PATH
    return ffprobePathCache
  }

  const lookupCmd = process.platform === 'win32' ? 'where.exe' : 'which'
  try {
    const { stdout } = await execFileAsync(lookupCmd, ['ffprobe'])
    const candidate = stdout.trim().split(/\r?\n/)[0]
    if (candidate && fs.existsSync(candidate)) {
      ffprobePathCache = candidate
      return ffprobePathCache
    }
  } catch {
    // not in system PATH
  }

  ffprobePathCache = null
  return null
}

/**
 * Verifies magic numbers of the buffer to prevent MIME spoofing
 */
export function validateMagicNumber(buffer: Buffer, expectedType: MediaType): { valid: boolean; detectedFormat?: string } {
  if (buffer.length < 12) return { valid: false }

  // Check JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { valid: expectedType === 'image' || expectedType === 'cross-modal', detectedFormat: 'JPEG' }
  }

  // Check PNG
  if (buffer.subarray(0, 8).equals(Buffer.from(MAGIC_NUMBERS.png))) {
    return { valid: expectedType === 'image' || expectedType === 'cross-modal', detectedFormat: 'PNG' }
  }

  // Check WEBP / RIFF
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF') {
    const subType = buffer.subarray(8, 12).toString('ascii')
    if (subType === 'WEBP') {
      return { valid: expectedType === 'image' || expectedType === 'cross-modal', detectedFormat: 'WEBP' }
    }
    if (subType === 'WAVE') {
      return { valid: expectedType === 'audio' || expectedType === 'cross-modal', detectedFormat: 'WAV' }
    }
    if (subType === 'AVI ') {
      return { valid: expectedType === 'video' || expectedType === 'cross-modal', detectedFormat: 'AVI' }
    }
  }

  // Check MP4 / QuickTime (contains 'ftyp' or 'moov' at offset 4)
  const boxType = buffer.subarray(4, 8).toString('ascii')
  if (boxType === 'ftyp' || boxType === 'moov') {
    const brand = buffer.subarray(8, 12).toString('ascii')
    if (brand.startsWith('M4A') || brand.startsWith('M4B')) {
      return { valid: expectedType === 'audio' || expectedType === 'cross-modal', detectedFormat: 'M4A' }
    }
    return { valid: expectedType === 'video' || expectedType === 'audio' || expectedType === 'cross-modal', detectedFormat: 'MP4' }
  }

  // Check MP3 ID3 header
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3') {
    return { valid: expectedType === 'audio' || expectedType === 'cross-modal', detectedFormat: 'MP3' }
  }

  // Check MP3 raw frame sync 0xFFE0
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    return { valid: expectedType === 'audio' || expectedType === 'cross-modal', detectedFormat: 'MP3' }
  }

  // Allow text / PDF for cross-modal
  if (buffer.subarray(0, 4).toString('ascii') === '%PDF') {
    return { valid: expectedType === 'cross-modal' || expectedType === 'text', detectedFormat: 'PDF' }
  }

  // Fallback: UTF-8 plain text test
  const isAsciiText = buffer.subarray(0, Math.min(buffer.length, 512)).every((byte) => (byte >= 32 && byte <= 126) || byte === 10 || byte === 13 || byte === 9)
  if (isAsciiText && (expectedType === 'text' || expectedType === 'cross-modal')) {
    return { valid: true, detectedFormat: 'TXT' }
  }

  return { valid: false }
}

/**
 * Ensures temporary upload storage directory exists and is secured
 */
export async function getTempDir(): Promise<string> {
  const uploadDir = path.join(os.tmpdir(), 'truthlens_evidence_uploads')
  await fsp.mkdir(uploadDir, { recursive: true, mode: 0o700 })
  return uploadDir
}

/**
 * Validates, hashes, and stores an incoming File object safely to disk
 */
export async function processUploadedEvidence(file: File, expectedType: MediaType): Promise<UploadedFileEvidence> {
  const maxSize = MAX_FILE_SIZES[expectedType] ?? MAX_FILE_SIZES.video
  if (file.size > maxSize) {
    throw new Error(`File size (${(file.size / 1024 / 1024).toFixed(2)} MB) exceeds the maximum allowed limit of ${(maxSize / 1024 / 1024).toFixed(0)} MB.`)
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Verify magic numbers
  const magicCheck = validateMagicNumber(buffer, expectedType)
  if (!magicCheck.valid) {
    throw new Error(`File header validation failed: content does not match expected ${expectedType} format (detected: ${magicCheck.detectedFormat ?? 'unknown'}).`)
  }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
  const safeFilename = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, '_')
  const ext = path.extname(safeFilename) || (magicCheck.detectedFormat ? `.${magicCheck.detectedFormat.toLowerCase()}` : '.dat')
  
  const uploadDir = await getTempDir()
  const tempPath = path.join(uploadDir, `ev_${crypto.randomUUID()}_${safeFilename}`)
  await fsp.writeFile(tempPath, buffer, { mode: 0o600 })

  return {
    originalName: file.name,
    mimeType: file.type || `application/${magicCheck.detectedFormat?.toLowerCase() ?? 'octet-stream'}`,
    size: file.size,
    tempPath,
    buffer,
    sha256
  }
}

/**
 * Container-level parser for MP4 box atoms when ffprobe is not installed
 */
export function parseMp4ContainerMetadata(buffer: Buffer): Partial<MediaMetadata> {
  let durationSeconds: number | undefined = undefined
  let width: number | undefined = undefined
  let height: number | undefined = undefined
  let videoCodec: string | undefined = undefined
  let audioCodec: string | undefined = undefined
  const softwareSignatures: string[] = []

  let offset = 0
  const len = buffer.length

  while (offset + 8 <= len) {
    const size = buffer.readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')

    if (size === 0 || offset + size > len + 1024) break // Invalid or eof box

    const boxSize = size === 1 && offset + 16 <= len ? Number(buffer.readBigUInt64BE(offset + 8)) : size

    if (type === 'ftyp') {
      const majorBrand = buffer.subarray(offset + 8, Math.min(offset + 12, len)).toString('ascii')
      softwareSignatures.push(`Brand:${majorBrand.trim()}`)
    } else if (type === 'moov') {
      // Scan inside moov
      const moovEnd = offset + boxSize
      let subOffset = offset + 8

      while (subOffset + 8 <= moovEnd && subOffset < len) {
        const subSize = buffer.readUInt32BE(subOffset)
        const subType = buffer.subarray(subOffset + 4, subOffset + 8).toString('ascii')
        if (subSize <= 0 || subOffset + subSize > moovEnd) break

        if (subType === 'mvhd') {
          // mvhd version 0: timescale at offset 12, duration at offset 16
          const version = buffer[subOffset + 8]
          const headerOffset = subOffset + 8
          if (version === 0 && headerOffset + 24 <= len) {
            const timescale = buffer.readUInt32BE(headerOffset + 12)
            const durationUnits = buffer.readUInt32BE(headerOffset + 16)
            if (timescale > 0) durationSeconds = durationUnits / timescale
          } else if (version === 1 && headerOffset + 36 <= len) {
            const timescale = buffer.readUInt32BE(headerOffset + 20)
            const durationUnits = Number(buffer.readBigUInt64BE(headerOffset + 24))
            if (timescale > 0) durationSeconds = durationUnits / timescale
          }
        } else if (subType === 'trak') {
          // Look for tkhd (dimensions)
          const trakEnd = subOffset + subSize
          let trakSub = subOffset + 8
          while (trakSub + 8 <= trakEnd && trakSub < len) {
            const tSize = buffer.readUInt32BE(trakSub)
            const tType = buffer.subarray(trakSub + 4, trakSub + 8).toString('ascii')
            if (tSize <= 0 || trakSub + tSize > trakEnd) break

            if (tType === 'tkhd') {
              const version = buffer[trakSub + 8]
              const dimOffset = version === 0 ? trakSub + 8 + 76 : trakSub + 8 + 88
              if (dimOffset + 8 <= len) {
                const w = buffer.readUInt32BE(dimOffset) >> 16
                const h = buffer.readUInt32BE(dimOffset + 4) >> 16
                if (w > 0 && h > 0) {
                  width = w
                  height = h
                }
              }
            }
            trakSub += tSize
          }
        }
        subOffset += subSize
      }
    }

    offset += boxSize
  }

  // Look for common metadata strings (e.g. Lavf / HandBrake / QuickTime)
  const previewText = buffer.subarray(0, Math.min(buffer.length, 32768)).toString('binary')
  if (previewText.includes('Lavf')) softwareSignatures.push('FFmpeg/Lavf muxer signature')
  if (previewText.includes('HandBrake')) softwareSignatures.push('HandBrake transcoder')
  if (previewText.includes('Adobe')) softwareSignatures.push('Adobe Premiere/Media Encoder')
  if (previewText.includes('QuickTime')) softwareSignatures.push('Apple QuickTime')

  return {
    format: 'MP4 / QuickTime',
    durationSeconds: durationSeconds ? Math.round(durationSeconds * 100) / 100 : undefined,
    durationFormatted: durationSeconds ? formatTime(durationSeconds) : undefined,
    dimensions: width && height ? { width, height } : undefined,
    videoCodec: videoCodec ?? 'H.264/AVC (Container inferred)',
    audioCodec: audioCodec ?? 'AAC (Container inferred)',
    softwareSignatures: softwareSignatures.length ? softwareSignatures : undefined
  }
}

/**
 * Extracts comprehensive video metadata using ffprobe if available or container parser fallback
 */
export async function extractVideoMetadata(evidence: UploadedFileEvidence): Promise<MediaMetadata> {
  const ffprobePath = await getFFprobePath()
  let metadata: MediaMetadata = {
    filename: evidence.originalName,
    fileSize: evidence.size,
    mimeType: evidence.mimeType,
    sha256: evidence.sha256,
    format: 'video/mp4'
  }

  if (ffprobePath) {
    try {
      const { stdout } = await execFileAsync(ffprobePath, [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        evidence.tempPath
      ])

      const data = JSON.parse(stdout)
      const format = data.format || {}
      const videoStream = data.streams?.find((s: { codec_type?: string }) => s.codec_type === 'video')
      const audioStream = data.streams?.find((s: { codec_type?: string }) => s.codec_type === 'audio')

      const duration = format.duration ? parseFloat(format.duration) : undefined
      const width = videoStream?.width ? parseInt(videoStream.width, 10) : undefined
      const height = videoStream?.height ? parseInt(videoStream.height, 10) : undefined

      // Parse framerate from e.g. "30/1" or "29.97"
      let frameRate: number | undefined = undefined
      if (videoStream?.r_frame_rate) {
        const [num, den] = videoStream.r_frame_rate.split('/').map(Number)
        if (den && den > 0) frameRate = Math.round((num / den) * 100) / 100
      }

      metadata = {
        ...metadata,
        format: format.format_long_name || format.format_name,
        durationSeconds: duration ? Math.round(duration * 100) / 100 : undefined,
        durationFormatted: duration ? formatTime(duration) : undefined,
        dimensions: width && height ? { width, height } : undefined,
        frameRate,
        frameCount: videoStream?.nb_frames ? parseInt(videoStream.nb_frames, 10) : undefined,
        videoCodec: videoStream?.codec_name,
        audioCodec: audioStream?.codec_name,
        sampleRate: audioStream?.sample_rate ? parseInt(audioStream.sample_rate, 10) : undefined,
        audioChannels: audioStream?.channels ? parseInt(audioStream.channels, 10) : undefined,
        bitRate: format.bit_rate ? parseInt(format.bit_rate, 10) : undefined,
        creationDate: format.tags?.creation_time,
        softwareSignatures: format.tags?.encoder ? [format.tags.encoder] : undefined,
        exifTags: format.tags || {}
      }

      return metadata
    } catch {
      // ffprobe failed, fall through to container parser
    }
  }

  // Fallback: parse container directly
  if (evidence.buffer) {
    const containerData = parseMp4ContainerMetadata(evidence.buffer)
    metadata = {
      ...metadata,
      ...containerData
    }
  }

  return metadata
}

/**
 * Extracts video frames at suitable intervals (e.g. 1 frame/sec) using FFmpeg where available
 */
export async function extractVideoFrames(
  videoPath: string,
  maxFrames = 10,
  intervalSeconds = 1
): Promise<{ frames: string[]; extractedWithFFmpeg: boolean; limitations?: string[] }> {
  const ffmpegPath = await getFFmpegPath()
  if (!ffmpegPath) {
    return {
      frames: [],
      extractedWithFFmpeg: false,
      limitations: ['FFmpeg not detected on host system. Frame-by-frame deepfake visual inspection could not be extracted directly from video streams.']
    }
  }

  const framesDir = path.join(path.dirname(videoPath), `frames_${crypto.randomUUID()}`)
  await fsp.mkdir(framesDir, { recursive: true, mode: 0o700 })

  try {
    // Extract frames: 1 frame every intervalSeconds, up to maxFrames
    const outputPattern = path.join(framesDir, 'frame_%03d.jpg')
    await execFileAsync(ffmpegPath, [
      '-i', videoPath,
      '-vf', `fps=1/${intervalSeconds}`,
      '-vframes', String(maxFrames),
      '-q:v', '3',
      outputPattern
    ])

    const files = await fsp.readdir(framesDir)
    const jpgFiles = files.filter(f => f.endsWith('.jpg')).sort()

    const framesBase64: string[] = []
    for (const file of jpgFiles) {
      const fullPath = path.join(framesDir, file)
      const data = await fsp.readFile(fullPath)
      framesBase64.push(`data:image/jpeg;base64,${data.toString('base64')}`)
      await fsp.unlink(fullPath).catch(() => {})
    }
    await fsp.rmdir(framesDir).catch(() => {})

    return {
      frames: framesBase64,
      extractedWithFFmpeg: true
    }
  } catch (err) {
    await fsp.rm(framesDir, { recursive: true, force: true }).catch(() => {})
    return {
      frames: [],
      extractedWithFFmpeg: false,
      limitations: [`Frame extraction via FFmpeg failed: ${err instanceof Error ? err.message : 'Unknown FFmpeg execution error'}`]
    }
  }
}

/**
 * Extracts the audio track from a video file into an uncompressed WAV file using FFmpeg where available
 */
export async function extractAudioFromVideo(videoPath: string): Promise<{ audioPath: string | null; extracted: boolean; limitations?: string[] }> {
  const ffmpegPath = await getFFmpegPath()
  if (!ffmpegPath) {
    return {
      audioPath: null,
      extracted: false,
      limitations: ['FFmpeg is required to extract audio tracks from video containers for acoustic analysis.']
    }
  }

  const outAudioPath = path.join(path.dirname(videoPath), `extracted_audio_${crypto.randomUUID()}.wav`)
  try {
    await execFileAsync(ffmpegPath, [
      '-i', videoPath,
      '-vn', // no video
      '-acodec', 'pcm_s16le',
      '-ar', '16000', // 16kHz mono standard for forensic & speech processing
      '-ac', '1',
      '-y',
      outAudioPath
    ])

    if (fs.existsSync(outAudioPath)) {
      return { audioPath: outAudioPath, extracted: true }
    }
    return { audioPath: null, extracted: false, limitations: ['No audio track found in video stream.'] }
  } catch (err) {
    return {
      audioPath: null,
      extracted: false,
      limitations: [`Audio extraction failed: ${err instanceof Error ? err.message : 'No usable audio stream found in container.'}`]
    }
  }
}

/**
 * Cleans up temporary evidence files and directories
 */
export async function cleanupEvidence(evidencePath: string | string[]): Promise<void> {
  const paths = Array.isArray(evidencePath) ? evidencePath : [evidencePath]
  for (const p of paths) {
    if (!p) continue
    try {
      if (fs.existsSync(p)) {
        await fsp.unlink(p)
      }
    } catch {
      // Ignore cleanup error
    }
  }
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`
}
