'use client'

import { useEffect, useState } from 'react'
import { AudioLines, FileText, FileVideo, Image as ImageIcon } from 'lucide-react'

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function useMediaPreviewUrl(file?: File) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!file || !/^(image|video|audio)\//.test(file.type)) {
      setPreviewUrl(null)
      return
    }

    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  return previewUrl
}

export default function MediaPreview({ files }: { files: File[] }) {
  const file = files[0]
  const previewUrl = useMediaPreviewUrl(file)

  if (!file) return null

  const isImage = file.type.startsWith('image/')
  const isVideo = file.type.startsWith('video/')
  const isAudio = file.type.startsWith('audio/')
  const Icon = isImage ? ImageIcon : isVideo ? FileVideo : isAudio ? AudioLines : FileText

  return (
    <section className="media-preview-card" aria-label="Selected media preview">
      <div className="media-preview-heading">
        <div><p className="eyebrow">SOURCE PREVIEW</p><strong title={file.name}>{file.name}</strong></div>
        <Icon aria-hidden="true" />
      </div>
      <div className="media-preview-visual">
        {previewUrl && isImage && <img src={previewUrl} alt={`Preview of ${file.name}`} />}
        {previewUrl && isVideo && <video src={previewUrl} controls preload="metadata" aria-label={`Preview of ${file.name}`} />}
        {previewUrl && isAudio && <div className="audio-preview"><AudioLines aria-hidden="true" /><audio src={previewUrl} controls preload="metadata" aria-label={`Preview of ${file.name}`} /></div>}
        {!previewUrl && <div className="nonvisual-preview"><Icon aria-hidden="true" /><span>Preview is available after the source format is supported by this browser.</span></div>}
      </div>
      <dl className="media-file-metadata">
        <div><dt>File type</dt><dd>{file.type || 'Not provided'}</dd></div>
        <div><dt>Size</dt><dd>{formatBytes(file.size)}</dd></div>
        <div><dt>Selected files</dt><dd>{files.length}</dd></div>
      </dl>
    </section>
  )
}
