import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import crypto from 'node:crypto'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { databaseService } from './database'
import { logger } from './logger'
import {
  MAX_FILE_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
  MAX_AUDIO_SIZE_BYTES,
  MAX_IMAGE_SIZE_BYTES,
  ALLOWED_EXTENSIONS,
  validateFileSignature,
  sanitizeFilename,
} from './security-utils'

const DEFAULT_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || process.env.STORAGE_BUCKET || 'truthlens-forensic-artifacts'
export const STORAGE_BUCKET = DEFAULT_BUCKET

// Strictly temporary writable directory on all hosting environments (including Vercel /tmp)
export const ARTIFACTS_TEMP_DIR = path.join(os.tmpdir(), 'truthlens-forensics', 'artifacts')
export const TEMP_BASE_DIR = path.join(os.tmpdir(), 'truthlens-forensics')

function ensureArtifactsDir() {
  try {
    if (!fs.existsSync(ARTIFACTS_TEMP_DIR)) {
      fs.mkdirSync(ARTIFACTS_TEMP_DIR, { recursive: true })
    }
  } catch {
    // Ignore read-only / concurrency race
  }
}

export function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.pdf':
      return 'application/pdf'
    case '.mp4':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.wav':
      return 'audio/wav'
    case '.mp3':
      return 'audio/mpeg'
    case '.json':
      return 'application/json'
    default:
      return 'application/octet-stream'
  }
}

export interface PresignedUploadOptions {
  filename: string
  mimeType: string
  fileSize: number
  userId: string
  category?: 'video' | 'audio' | 'image' | 'multimodal'
  expiresInSeconds?: number
}

export interface PresignedUploadResult {
  uploadUrl: string
  storageKey: string
  method: 'PUT' | 'POST'
  headers: Record<string, string>
  expiresAt: string
  maxSizeBytes: number
}

export class CloudStorageService {
  private bucketName: string
  private supabase: SupabaseClient | null = null
  private signingSecret: string
  private isCloudConfigured = false
  private localStagingDir = path.join(TEMP_BASE_DIR, 'staged-uploads')

  constructor() {
    this.bucketName = DEFAULT_BUCKET
    this.signingSecret = process.env.STORAGE_SIGNING_SECRET || crypto.randomBytes(32).toString('hex')
    this.ensureDirs()
    this.initSupabase()
  }

  private ensureDirs() {
    try {
      ensureArtifactsDir()
      if (!fs.existsSync(TEMP_BASE_DIR)) {
        fs.mkdirSync(TEMP_BASE_DIR, { recursive: true })
      }
      if (!fs.existsSync(this.localStagingDir)) {
        fs.mkdirSync(this.localStagingDir, { recursive: true })
      }
    } catch {
      // Ignore directory creation errors in constrained environments
    }
  }

  private initSupabase() {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY

    if (supabaseUrl && supabaseKey && supabaseUrl.startsWith('http')) {
      try {
        this.supabase = createClient(supabaseUrl, supabaseKey, {
          auth: { persistSession: false },
        })
        this.isCloudConfigured = true
        logger.info('Cloud storage initialized with Supabase Storage provider.')
      } catch (err) {
        logger.warn('Failed to initialize Supabase Storage client. Using signed local staging fallback.', err)
        this.supabase = null
        this.isCloudConfigured = false
      }
    } else {
      logger.info('No external cloud storage configured. Using secure signed local staging provider.')
      this.supabase = null
      this.isCloudConfigured = false
    }
  }

  /**
   * Uploads an artifact (image, spectrogram, PDF, report) to cloud object storage (Supabase Storage)
   * or safely buffers it to the local /tmp artifacts directory.
   */
  async uploadArtifact(
    filename: string,
    content: Buffer | Uint8Array | string,
    contentType?: string
  ): Promise<{ url: string; storagePath: string; isRemote: boolean }> {
    const safeName = sanitizeFilename(filename)
    const mime = contentType || getMimeType(safeName)
    const buffer = Buffer.isBuffer(content)
      ? content
      : typeof content === 'string'
      ? Buffer.from(content)
      : Buffer.from(content)

    // 1. Try Supabase Storage if configured
    const supabase = databaseService?.getSupabase?.() || this.supabase
    if (supabase) {
      try {
        const objectPath = `artifacts/${Date.now()}-${safeName}`
        const { data, error } = await supabase.storage
          .from(this.bucketName)
          .upload(objectPath, buffer, {
            contentType: mime,
            upsert: true,
          })

        if (!error && data) {
          const { data: pubData } = supabase.storage
            .from(this.bucketName)
            .getPublicUrl(objectPath)

          const publicUrl = pubData?.publicUrl || `/api/artifacts/${safeName}`
          logger.info(`Artifact successfully uploaded to Supabase Storage: ${objectPath}`)
          
          try {
            ensureArtifactsDir()
            await fsp.writeFile(path.join(ARTIFACTS_TEMP_DIR, safeName), buffer)
          } catch {
            // best-effort
          }

          return {
            url: publicUrl,
            storagePath: objectPath,
            isRemote: true,
          }
        }
      } catch (err) {
        logger.warn('Failed cloud storage upload attempt, falling back to local /tmp', err)
      }
    }

    // 2. Local /tmp fallback
    ensureArtifactsDir()
    const localFilePath = path.join(ARTIFACTS_TEMP_DIR, safeName)
    await fsp.writeFile(localFilePath, buffer)

    return {
      url: `/forensic-output/${safeName}`,
      storagePath: localFilePath,
      isRemote: false,
    }
  }

  /**
   * Reads an artifact file stream or buffer from Supabase Storage or /tmp.
   */
  async getArtifactReadStream(storagePath: string): Promise<{
    stream: NodeJS.ReadableStream | null
    buffer?: Buffer
    contentType: string
    contentLength?: number
  } | null> {
    const safeBase = path.basename(storagePath)
    const contentType = getMimeType(safeBase)

    const supabase = databaseService?.getSupabase?.() || this.supabase
    if (supabase && storagePath.startsWith('artifacts/')) {
      try {
        const { data, error } = await supabase.storage.from(this.bucketName).download(storagePath)
        if (!error && data) {
          const ab = await data.arrayBuffer()
          const buf = Buffer.from(ab)
          return {
            stream: null,
            buffer: buf,
            contentType,
            contentLength: buf.length,
          }
        }
      } catch (err) {
        logger.warn(`Error downloading artifact ${storagePath} from Supabase`, err)
      }
    }

    const localCandidates = [
      storagePath,
      path.join(ARTIFACTS_TEMP_DIR, safeBase),
      path.join(process.cwd(), 'public', 'forensic-output', safeBase),
    ]

    for (const candidate of localCandidates) {
      if (fs.existsSync(candidate)) {
        const stats = fs.statSync(candidate)
        return {
          stream: fs.createReadStream(candidate),
          contentType,
          contentLength: stats.size,
        }
      }
    }

    return null
  }

  /**
   * Validates pre-upload metadata before signing an upload URL.
   */
  public validateUploadRequest(
    filename: string,
    mimeType: string,
    fileSize: number,
    category?: string
  ): { isValid: boolean; error?: string; safeFilename: string; ext: string } {
    if (!filename || typeof filename !== 'string') {
      return { isValid: false, error: 'A valid filename is required.', safeFilename: '', ext: '' }
    }

    const safeFilename = sanitizeFilename(filename)
    const ext = path.extname(safeFilename).toLowerCase()

    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return {
        isValid: false,
        error: `File extension "${ext}" is not permitted. Permitted formats: MP4, MOV, AVI, WEBM, WAV, MP3, M4A, JPG, PNG, WEBP, TXT.`,
        safeFilename,
        ext,
      }
    }

    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      return { isValid: false, error: 'File size must be a positive number of bytes.', safeFilename, ext }
    }

    let limit = MAX_FILE_SIZE_BYTES
    if (category === 'video' || ['.mp4', '.mov', '.avi', '.webm'].includes(ext)) {
      limit = MAX_VIDEO_SIZE_BYTES
    } else if (category === 'audio' || ['.wav', '.mp3', '.m4a'].includes(ext)) {
      limit = MAX_AUDIO_SIZE_BYTES
    } else if (category === 'image' || ['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      limit = MAX_IMAGE_SIZE_BYTES
    }

    if (fileSize > limit) {
      const maxMb = Math.round(limit / (1024 * 1024))
      return {
        isValid: false,
        error: `File exceeds the maximum allowed size of ${maxMb}MB for this media category.`,
        safeFilename,
        ext,
      }
    }

    return { isValid: true, safeFilename, ext }
  }

  /**
   * Generates a secure, scoped, time-limited presigned upload URL.
   */
  public async generatePresignedUploadUrl(
    options: PresignedUploadOptions
  ): Promise<PresignedUploadResult> {
    const { filename, mimeType, fileSize, userId, category } = options
    const expiresInSeconds = options.expiresInSeconds || 900 // 15 minutes default

    const validation = this.validateUploadRequest(filename, mimeType, fileSize, category)
    if (!validation.isValid) {
      throw new Error(validation.error || 'Invalid upload parameters.')
    }

    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_')
    const randomId = crypto.randomBytes(8).toString('hex')
    const timestamp = Date.now()
    const storageKey = `uploads/${safeUserId}/${timestamp}_${randomId}${validation.ext}`
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString()

    const supabase = databaseService?.getSupabase?.() || this.supabase
    if (supabase && this.isCloudConfigured) {
      try {
        const { data, error } = await supabase.storage
          .from(this.bucketName)
          .createSignedUploadUrl(storageKey)

        if (!error && data?.signedUrl) {
          return {
            uploadUrl: data.signedUrl,
            storageKey,
            method: 'PUT',
            headers: {
              'Content-Type': mimeType || 'application/octet-stream',
            },
            expiresAt,
            maxSizeBytes: fileSize,
          }
        }
      } catch (err) {
        logger.warn('Failed to generate Supabase signed upload URL, using signed local provider', err)
      }
    }

    // Direct Signed Local Provider (HMAC-tokenized)
    const tokenPayload = `${storageKey}:${expiresAt}:${fileSize}`
    const hmac = crypto.createHmac('sha256', this.signingSecret).update(tokenPayload).digest('hex')
    const uploadUrl = `/api/upload/direct?key=${encodeURIComponent(storageKey)}&exp=${encodeURIComponent(expiresAt)}&sig=${hmac}`

    return {
      uploadUrl,
      storageKey,
      method: 'PUT',
      headers: {
        'Content-Type': mimeType || 'application/octet-stream',
      },
      expiresAt,
      maxSizeBytes: fileSize,
    }
  }

  /**
   * Validates HMAC signature for direct uploads.
   */
  public verifyDirectUploadSignature(key: string, exp: string, sig: string, fileSize: number): boolean {
    if (!key || !exp || !sig) return false
    if (new Date(exp).getTime() < Date.now()) return false

    const tokenPayload = `${key}:${exp}:${fileSize}`
    const expected = crypto.createHmac('sha256', this.signingSecret).update(tokenPayload).digest('hex')

    const bufSig = Buffer.from(sig)
    const bufExpected = Buffer.from(expected)
    if (bufSig.length !== bufExpected.length) {
      return false
    }

    return crypto.timingSafeEqual(bufSig, bufExpected)
  }

  public verifyStorageKeyOwnership(storageKey: string, userId: string): boolean {
    if (!storageKey || !userId) return false
    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_')
    const expectedPrefix = `uploads/${safeUserId}/`
    return storageKey.startsWith(expectedPrefix)
  }

  public async saveStagedObject(storageKey: string, buffer: Buffer): Promise<void> {
    const targetPath = path.join(this.localStagingDir, path.basename(storageKey))
    fs.writeFileSync(targetPath, buffer)
  }

  public async downloadToTempFile(
    storageKey: string,
    originalFilename: string,
    expectedMime?: string
  ): Promise<{ tempPath: string; buffer: Buffer; sha256: string }> {
    this.ensureDirs()
    let buffer: Buffer | null = null

    const supabase = databaseService?.getSupabase?.() || this.supabase
    if (supabase && this.isCloudConfigured) {
      try {
        const { data, error } = await supabase.storage
          .from(this.bucketName)
          .download(storageKey)

        if (!error && data) {
          const ab = await data.arrayBuffer()
          buffer = Buffer.from(ab)
        }
      } catch (err) {
        logger.warn(`Failed to download ${storageKey} from Supabase Storage`, err)
      }
    }

    if (!buffer) {
      const localFile = path.join(this.localStagingDir, path.basename(storageKey))
      if (fs.existsSync(localFile)) {
        buffer = fs.readFileSync(localFile)
      }
    }

    if (!buffer) {
      throw new Error(`Media object "${storageKey}" was not found in cloud storage or upload staging.`)
    }

    const sigResult = validateFileSignature(buffer, originalFilename, expectedMime)
    if (!sigResult.isValid) {
      throw new Error(sigResult.error || 'Binary magic byte inspection failed for uploaded object.')
    }

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
    const ext = sigResult.normalizedExt || path.extname(originalFilename) || '.bin'
    const tempFilename = `evidence_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`
    const tempPath = path.join(TEMP_BASE_DIR, tempFilename)

    fs.writeFileSync(tempPath, buffer)
    return { tempPath, buffer, sha256 }
  }

  public async deleteObject(storageKey: string): Promise<void> {
    const supabase = databaseService?.getSupabase?.() || this.supabase
    if (supabase && this.isCloudConfigured) {
      try {
        await supabase.storage.from(this.bucketName).remove([storageKey])
      } catch (err) {
        logger.warn(`Error deleting ${storageKey} from Supabase Storage`, err)
      }
    }

    const localFile = path.join(this.localStagingDir, path.basename(storageKey))
    if (fs.existsSync(localFile)) {
      try {
        fs.unlinkSync(localFile)
      } catch {
        // ignore
      }
    }
  }

  public purgeStaleUploads(maxAgeMs = 60 * 60 * 1000) {
    try {
      if (!fs.existsSync(this.localStagingDir)) return
      const now = Date.now()
      const files = fs.readdirSync(this.localStagingDir)
      for (const file of files) {
        const full = path.join(this.localStagingDir, file)
        try {
          const stats = fs.statSync(full)
          if (now - stats.mtimeMs > maxAgeMs) {
            fs.unlinkSync(full)
          }
        } catch {
          // ignore
        }
      }
    } catch (err) {
      logger.warn('Failed to purge stale uploads', err)
    }
  }
}

// Global Singleton instance
const globalStorageKey = Symbol.for('truthlens.cloudStorageService')
const globalObj = globalThis as unknown as { [key: symbol]: CloudStorageService }

if (!globalObj[globalStorageKey]) {
  globalObj[globalStorageKey] = new CloudStorageService()
}

export const cloudStorage = globalObj[globalStorageKey]
