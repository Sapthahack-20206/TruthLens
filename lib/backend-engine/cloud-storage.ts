import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { databaseService } from './database'
import { logger } from './logger'
import { sanitizeFilename } from './security-utils'

const DEFAULT_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'truthlens-forensic-artifacts'

// Strictly temporary writable directory on all hosting environments (including Vercel /tmp)
export const ARTIFACTS_TEMP_DIR = path.join(os.tmpdir(), 'truthlens-forensics', 'artifacts')

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

export class CloudStorageService {
  private bucketName: string

  constructor() {
    this.bucketName = DEFAULT_BUCKET
    ensureArtifactsDir()
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
    const supabase = databaseService.getSupabase()
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
          
          // Also buffer in /tmp for fast local cache
          try {
            ensureArtifactsDir()
            await fsp.writeFile(path.join(ARTIFACTS_TEMP_DIR, safeName), buffer)
          } catch {
            // Buffer write is best-effort
          }

          return {
            url: publicUrl,
            storagePath: objectPath,
            isRemote: true,
          }
        } else if (error) {
          logger.warn(`Supabase Storage upload warning (falling back to /tmp): ${error.message}`)
        }
      } catch (err) {
        logger.warn('Failed cloud storage upload attempt, falling back to local /tmp', err)
      }
    }

    // 2. Local /tmp fallback
    ensureArtifactsDir()
    const localFilePath = path.join(ARTIFACTS_TEMP_DIR, safeName)
    await fsp.writeFile(localFilePath, buffer)

    // Also attempt to write to public/forensic-output if writable (local dev environment)
    try {
      const publicForensicDir = path.join(process.cwd(), 'public', 'forensic-output')
      if (fs.existsSync(publicForensicDir) || fs.existsSync(path.join(process.cwd(), 'public'))) {
        if (!fs.existsSync(publicForensicDir)) {
          fs.mkdirSync(publicForensicDir, { recursive: true })
        }
        await fsp.writeFile(path.join(publicForensicDir, safeName), buffer)
      }
    } catch {
      // Expected to fail on read-only serverless filesystems (e.g. Vercel)
    }

    return {
      url: `/forensic-output/${safeName}`,
      storagePath: localFilePath,
      isRemote: false,
    }
  }

  /**
   * Retrieves an artifact by filename.
   * Checks local `/tmp` cache, `public/forensic-output`, and cloud Supabase Storage.
   */
  async getArtifact(
    filename: string
  ): Promise<{ data: Buffer; contentType: string } | null> {
    const safeName = sanitizeFilename(filename)
    const mime = getMimeType(safeName)

    // 1. Check /tmp artifacts directory
    const tempPath = path.join(ARTIFACTS_TEMP_DIR, safeName)
    try {
      if (fs.existsSync(tempPath)) {
        const data = await fsp.readFile(tempPath)
        return { data, contentType: mime }
      }
    } catch {
      // Continue search
    }

    // 2. Check public/forensic-output if running in local dev
    try {
      const publicPath = path.join(process.cwd(), 'public', 'forensic-output', safeName)
      if (fs.existsSync(publicPath)) {
        const data = await fsp.readFile(publicPath)
        return { data, contentType: mime }
      }
    } catch {
      // Continue search
    }

    // 3. Check Supabase Storage
    const supabase = databaseService.getSupabase()
    if (supabase) {
      try {
        const { data, error } = await supabase.storage
          .from(this.bucketName)
          .download(`artifacts/${safeName}`)

        if (!error && data) {
          const arrayBuffer = await data.arrayBuffer()
          return {
            data: Buffer.from(arrayBuffer),
            contentType: data.type || mime,
          }
        }
      } catch (err) {
        logger.warn(`Could not download artifact ${safeName} from Supabase:`, err)
      }
    }

    return null
  }
}

export const cloudStorage = new CloudStorageService()
