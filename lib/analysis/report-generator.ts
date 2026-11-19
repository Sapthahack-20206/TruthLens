import type { ForensicResponse } from './types'

function escapePdfText(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

/**
 * Generates a valid standard PDF 1.4 document from forensic investigation results.
 * Pure Node.js implementation without external binary dependencies.
 */
export function generateForensicPdfReport(response: ForensicResponse): Buffer {
  const lines: string[] = []
  
  // Format report lines
  lines.push('TRUTHLENS DIGITAL FORENSIC EXAMINATION REPORT')
  lines.push('======================================================================')
  lines.push(`Report ID:          ${response.reportId || response.id}`)
  lines.push(`Investigation ID:   ${response.investigationId || response.id}`)
  lines.push(`Media Type:         ${response.mediaType.toUpperCase()}`)
  lines.push(`Generated:          ${new Date().toUTCString()}`)
  lines.push(`Analysis Status:    ${response.status.toUpperCase()}`)
  lines.push('----------------------------------------------------------------------')
  lines.push('')
  lines.push('EXECUTIVE ASSESSMENT:')
  lines.push(`  ${response.assessment}`)
  lines.push('')
  lines.push('SUMMARY:')
  lines.push(`  ${response.summary}`)
  lines.push('')
  lines.push('MEDIA & PROVENANCE METADATA:')
  for (const [key, val] of Object.entries(response.metadata || {})) {
    lines.push(`  - ${key}: ${val === null ? 'Not provided' : String(val)}`)
  }
  lines.push('')

  if (response.videoMetrics) {
    lines.push('VIDEO FRAME EXTRACTION & DETECTION METRICS:')
    lines.push(`  - Total Frames Sampled:     ${response.videoMetrics.totalFramesSampled}`)
    lines.push(`  - Faces Tracked:            ${response.videoMetrics.facesDetectedCount}`)
    lines.push(`  - Average Inter-frame Diff: ${response.videoMetrics.averageInterframeDiff}`)
    lines.push(`  - Compression Variance:     ${response.videoMetrics.compressionVariance}`)
    if (response.videoMetrics.neuralModelName) {
      lines.push(`  - Deepfake Model Engine:    ${response.videoMetrics.neuralModelName} (${response.videoMetrics.neuralModelVersion || 'quantized'})`)
      lines.push(`  - Peak Deepfake Score:      ${Math.round((response.videoMetrics.maxDeepfakeScore || 0) * 100)}%`)
      lines.push(`  - Mean Deepfake Score:      ${Math.round((response.videoMetrics.meanDeepfakeScore || 0) * 100)}%`)
    }
    lines.push('')
  }

  const anyResponse = response as any
  if (anyResponse.transcription && anyResponse.transcription.length > 0) {
    lines.push('SPOKEN DIALOGUE TRANSCRIPT & SPEAKER BREAKDOWN:')
    if (anyResponse.speakerMetrics?.speakers) {
      lines.push(`  - Distinct Speakers:        ${anyResponse.speakerMetrics.totalSpeakers || anyResponse.speakerMetrics.speakers.length}`)
      for (const spk of anyResponse.speakerMetrics.speakers) {
        lines.push(`    * ${spk.label}: ${spk.segmentCount} segments, ${spk.totalSpokenSeconds}s spoken${spk.avgPitchHz ? `, F0: ${spk.avgPitchHz} Hz` : ''}`)
      }
    }
    if (anyResponse.transcriptMetrics) {
      lines.push(`  - Total Words Transcribed:  ${anyResponse.transcriptMetrics.totalWords}`)
      lines.push(`  - Active Speech Duration:   ${anyResponse.transcriptMetrics.spokenDurationSec}s (${Math.round((anyResponse.transcriptMetrics.speechRatio || 0) * 100)}% speech ratio)`)
      if (anyResponse.transcriptMetrics.wer !== null && anyResponse.transcriptMetrics.wer !== undefined) {
        lines.push(`  - Word Error Rate (WER):    ${anyResponse.transcriptMetrics.wer}%`)
      }
      if (anyResponse.transcriptMetrics.cer !== null && anyResponse.transcriptMetrics.cer !== undefined) {
        lines.push(`  - Character Error Rate(CER):${anyResponse.transcriptMetrics.cer}%`)
      }
    }
    lines.push('  - Timestamped Dialogue Segments:')
    for (const seg of anyResponse.transcription.slice(0, 20)) {
      const timeStr = `${Math.floor(seg.start / 60).toString().padStart(2, '0')}:${(seg.start % 60).toFixed(2).padStart(5, '0')}`
      lines.push(`    [${timeStr}] ${seg.speaker || 'Speaker'}: "${seg.text}"${seg.confidence ? ` (Conf: ${seg.confidence}%)` : ''}`)
    }
    if (anyResponse.transcription.length > 20) {
      lines.push(`    ... (${anyResponse.transcription.length - 20} additional dialogue segments omitted for brevity)`)
    }
    lines.push('')
  }

  if (response.findings && response.findings.length > 0) {
    lines.push('FORENSIC FINDINGS:')
    for (const f of response.findings) {
      lines.push(`  [${f.type || 'Finding'}] ${f.title}`)
      if (f.description) lines.push(`    Details: ${f.description}`)
      if (f.timestamp) lines.push(`    Timestamp: ${f.timestamp}`)
      if (f.confidence !== undefined && f.confidence !== null) lines.push(`    Confidence: ${f.confidence}`)
      if (f.evidenceRef) lines.push(`    Reference: ${f.evidenceRef}`)
    }
    lines.push('')
  }

  if (response.suspiciousTimestamps && response.suspiciousTimestamps.length > 0) {
    lines.push('SUSPICIOUS TIMESTAMPS / ANOMALIES:')
    for (const st of response.suspiciousTimestamps) {
      lines.push(`  * ${st.timestamp} - ${st.label || 'Anomaly'}: ${st.description || ''}`)
    }
    lines.push('')
  }

  if (response.limitations && response.limitations.length > 0) {
    lines.push('TECHNICAL & METHODOLOGICAL LIMITATIONS:')
    for (const lim of response.limitations) {
      lines.push(`  - ${lim}`)
    }
    lines.push('')
  }

  lines.push('----------------------------------------------------------------------')
  lines.push('DISCLAIMER: TruthLens findings represent forensic and heuristic signal')
  lines.push('analyses. Absence or presence of indicators does not constitute absolute')
  lines.push('legal proof of authenticity or synthetic manipulation.')
  lines.push('======================================================================')

  // Chunk lines into pages (up to 48 lines per page)
  const LINES_PER_PAGE = 48
  const pageChunks: string[][] = []
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    pageChunks.push(lines.slice(i, i + LINES_PER_PAGE))
  }
  if (pageChunks.length === 0) pageChunks.push([''])

  // PDF objects
  const objects: string[] = []
  const offsets: number[] = []

  let currentOffset = 0
  const header = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
  currentOffset += Buffer.byteLength(header, 'latin1')

  function addObject(content: string): number {
    const objNum = objects.length + 1
    offsets.push(currentOffset)
    const objStr = `${objNum} 0 obj\n${content}\nendobj\n`
    objects.push(objStr)
    currentOffset += Buffer.byteLength(objStr, 'latin1')
    return objNum
  }

  // 1: Catalog
  addObject('<< /Type /Catalog /Pages 2 0 R >>')

  // Build page object references (e.g. 4 0 R, 6 0 R, ...)
  const pageObjectRefs: string[] = []
  for (let p = 0; p < pageChunks.length; p++) {
    const pageObjNum = 4 + p * 2
    pageObjectRefs.push(`${pageObjNum} 0 R`)
  }

  // 2: Pages container
  addObject(`<< /Type /Pages /Kids [${pageObjectRefs.join(' ')}] /Count ${pageChunks.length} >>`)

  // 3: Font (Courier standard Type1 font)
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>')

  // Add each Page and Content Stream pair
  for (let p = 0; p < pageChunks.length; p++) {
    const chunk = pageChunks[p]
    let streamText = 'BT\n/F1 9 Tf\n36 750 Td\n13 TL\n'
    for (const line of chunk) {
      const safeLine = escapePdfText(line.length > 95 ? line.slice(0, 92) + '...' : line)
      streamText += `(${safeLine}) '\n`
    }
    streamText += 'ET\n'

    const streamBuffer = Buffer.from(streamText, 'utf-8')
    const streamObjNum = 4 + p * 2 + 1

    // Page object
    addObject(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${streamObjNum} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`)

    // Content stream object
    addObject(`<< /Length ${streamBuffer.length} >>\nstream\n${streamText}endstream`)
  }

  // xref table
  const xrefOffset = currentOffset
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`
  }

  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  const fullPdf = header + objects.join('') + xref + trailer
  return Buffer.from(fullPdf, 'latin1')
}
