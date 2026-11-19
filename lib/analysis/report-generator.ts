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

  // Build PDF text stream
  let streamText = 'BT\n/F1 9 Tf\n36 750 Td\n13 TL\n'
  for (const line of lines) {
    // Truncate overly long lines to fit page width
    const safeLine = escapePdfText(line.length > 95 ? line.slice(0, 92) + '...' : line)
    streamText += `(${safeLine}) '\n`
  }
  streamText += 'ET\n'

  const streamBuffer = Buffer.from(streamText, 'utf-8')

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

  // 2: Pages
  addObject('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')

  // 3: Page
  addObject('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>')

  // 4: Content stream
  addObject(`<< /Length ${streamBuffer.length} >>\nstream\n${streamText}endstream`)

  // 5: Font (Courier standard 14 font)
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>')

  // xref
  const xrefOffset = currentOffset
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`
  }

  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  const fullPdf = header + objects.join('') + xref + trailer
  return Buffer.from(fullPdf, 'latin1')
}
