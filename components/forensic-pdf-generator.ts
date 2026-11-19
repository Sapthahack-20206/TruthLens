export interface ForensicReportData {
  reportId: string
  investigationId: string
  title: string
  date: string
  mediaFilename: string
  mediaType: string
  fileSize?: string
  duration?: string
  overallStatus: 'Potentially Manipulated' | 'No Significant Indicators Detected' | 'Requires Further Review'
  confidenceScore?: number | string
  summary: string
  videoFindings: Array<{ title: string; timestamp?: string; severity: string; confidence?: number | string; explanation: string; humanReview?: string }>
  audioFindings: Array<{ title: string; timestamp?: string; severity: string; confidence?: number | string; explanation: string; humanReview?: string }>
  transcriptFindings: Array<{ title: string; timestamp?: string; severity: string; confidence?: number | string; explanation: string; humanReview?: string }>
  imageFindings?: Array<{ title: string; timestamp?: string; severity: string; confidence?: number | string; explanation: string; humanReview?: string }>
  correlations: Array<{ source: string; target: string; relationship: string; explanation?: string; inconsistencyType?: string }>
  limitations: string[]
  humanReviewRecommendations: string[]
}

function escapePdfText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ')
}

function wrapText(text: string, maxCharsPerLine = 85): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    if ((currentLine + (currentLine ? ' ' : '') + word).length <= maxCharsPerLine) {
      currentLine += (currentLine ? ' ' : '') + word
    } else {
      if (currentLine) lines.push(currentLine)
      currentLine = word
    }
  }
  if (currentLine) lines.push(currentLine)
  return lines.length > 0 ? lines : ['']
}

export function generateForensicPdfBlob(data: ForensicReportData): Blob {
  const pages: string[] = []
  let currentCommands: string[] = []
  let currentY = 780
  const margin = 50
  const pageWidth = 595.28
  const pageHeight = 841.89

  const startNewPage = () => {
    if (currentCommands.length > 0) {
      pages.push(currentCommands.join('\n'))
      currentCommands = []
    }
    currentY = 780
    // Header for sub-pages
    currentCommands.push(
      '0.2 0.2 0.25 rg',
      `BT /F1 8 Tf ${margin} 810 Td (TRUTHLENS FORENSIC INVESTIGATION REPORT | CASE #${escapePdfText(data.reportId)}) Tj ET`,
      `0.8 0.8 0.8 RG 1 w ${margin} 802 m ${pageWidth - margin} 802 l S`
    )
  }

  const checkSpace = (needed: number) => {
    if (currentY - needed < 60) {
      startNewPage()
    }
  }

  // --- PAGE 1: COVER & EXECUTIVE SUMMARY ---
  // Header Banner
  currentCommands.push(
    // Top border line
    '0.05 0.5 0.7 RG 3 w 50 805 m 545 805 l S',
    // TruthLens Logo / Brand Title
    'BT /F1 18 Tf 0.05 0.08 0.15 rg 50 782 Td (TRUTHLENS DIGITAL FORENSICS) Tj ET',
    'BT /F1 10 Tf 0.4 0.45 0.5 rg 50 768 Td (EVIDENCE-LED FORENSIC ANALYSIS REPORT) Tj ET',
    // Date & Report ID (right aligned approx)
    `BT /F1 9 Tf 0.3 0.3 0.3 rg 380 782 Td (Report ID: ${escapePdfText(data.reportId)}) Tj ET`,
    `BT /F1 9 Tf 0.4 0.4 0.4 rg 380 768 Td (Date: ${escapePdfText(data.date)}) Tj ET`,
    '0.85 0.85 0.85 RG 1 w 50 755 m 545 755 l S'
  )
  currentY = 740

  // Overall Assessment Status Box
  let statusBg = '0.96 0.94 0.94'
  let statusStroke = '0.85 0.25 0.25'
  let statusTextRg = '0.7 0.1 0.1'

  if (data.overallStatus === 'No Significant Indicators Detected') {
    statusBg = '0.94 0.96 0.98'
    statusStroke = '0.2 0.5 0.7'
    statusTextRg = '0.1 0.35 0.55'
  } else if (data.overallStatus === 'Requires Further Review') {
    statusBg = '0.98 0.96 0.92'
    statusStroke = '0.8 0.55 0.15'
    statusTextRg = '0.65 0.4 0.05'
  }

  currentCommands.push(
    `${statusBg} rg ${statusStroke} RG 1.5 w ${margin} ${currentY - 45} 495 50 re B`,
    `BT /F1 8 Tf ${statusTextRg} rg ${margin + 12} ${currentY - 12} Td (OVERALL FORENSIC VERACITY ASSESSMENT) Tj ET`,
    `BT /F1 14 Tf ${statusTextRg} rg ${margin + 12} ${currentY - 32} Td (${escapePdfText(data.overallStatus.toUpperCase())}) Tj ET`
  )
  if (data.confidenceScore) {
    currentCommands.push(
      `BT /F1 9 Tf 0.3 0.3 0.3 rg 380 ${currentY - 30} Td (Confidence: ${escapePdfText(String(data.confidenceScore))}%) Tj ET`
    )
  }
  currentY -= 65

  // Mandatory Uncertainty Notice (TruthLens Forensic Integrity)
  currentCommands.push(
    '0.95 0.95 0.96 rg 0.75 0.75 0.8 RG 1 w 50 ' + (currentY - 32) + ' 495 34 re B',
    'BT /F1 8 Tf 0.3 0.35 0.4 rg 60 ' + (currentY - 14) + ' Td (FORENSIC INTEGRITY & UNCERTAINTY MANDATE:) Tj ET',
    'BT /F1 7.5 Tf 0.35 0.4 0.45 rg 60 ' + (currentY - 26) + ' Td (Absence of detected manipulation indicators is NOT proof of authenticity. Novel or advanced techniques may leave no trace.) Tj ET'
  )
  currentY -= 48

  // Evidence Metadata Box
  currentCommands.push(
    '0.97 0.98 0.99 rg 0.8 0.85 0.9 RG 1 w 50 ' + (currentY - 60) + ' 495 62 re B',
    'BT /F1 8.5 Tf 0.1 0.4 0.6 rg 60 ' + (currentY - 16) + ' Td (SUBMITTED MEDIA METADATA) Tj ET',
    `BT /F1 8 Tf 0.25 0.25 0.25 rg 60 ${currentY - 32} Td (File Name: ${escapePdfText(data.mediaFilename)}) Tj ET`,
    `BT /F1 8 Tf 0.25 0.25 0.25 rg 60 ${currentY - 48} Td (Media Type: ${escapePdfText(data.mediaType)}) Tj ET`,
    `BT /F1 8 Tf 0.25 0.25 0.25 rg 320 ${currentY - 32} Td (Investigation ID: ${escapePdfText(data.investigationId)}) Tj ET`
  )
  if (data.fileSize) {
    currentCommands.push(`BT /F1 8 Tf 0.25 0.25 0.25 rg 320 ${currentY - 48} Td (Size: ${escapePdfText(data.fileSize)}) Tj ET`)
  }
  currentY -= 75

  // Analysis Summary
  currentCommands.push(
    'BT /F1 11 Tf 0.1 0.15 0.2 rg 50 ' + currentY + ' Td (Executive Analysis Summary) Tj ET',
    '0.8 0.8 0.8 RG 0.5 w 50 ' + (currentY - 4) + ' 545 ' + (currentY - 4) + ' l S'
  )
  currentY -= 18

  const summaryLines = wrapText(data.summary || 'Analysis completed with no extended summary narrative returned.')
  for (const line of summaryLines) {
    checkSpace(14)
    currentCommands.push(`BT /F1 8.5 Tf 0.2 0.2 0.25 rg 50 ${currentY} Td (${escapePdfText(line)}) Tj ET`)
    currentY -= 13
  }
  currentY -= 12

  // --- FINDINGS BY MODALITY ---
  const printFindingsCategory = (categoryTitle: string, items: Array<{ title: string; timestamp?: string; severity: string; confidence?: number | string; explanation: string; humanReview?: string }>) => {
    checkSpace(40)
    currentCommands.push(
      `BT /F1 11 Tf 0.08 0.35 0.55 rg 50 ${currentY} Td (${escapePdfText(categoryTitle)} Findings (${items.length})) Tj ET`,
      `0.8 0.8 0.8 RG 0.5 w 50 ${currentY - 4} 545 ${currentY - 4} l S`
    )
    currentY -= 18

    if (items.length === 0) {
      checkSpace(20)
      currentCommands.push(`BT /F1 8 Tf 0.5 0.5 0.5 rg 50 ${currentY} Td (No specific ${escapePdfText(categoryTitle.toLowerCase())} anomalies flagged by automated models.) Tj ET`)
      currentY -= 16
      return
    }

    for (const f of items) {
      checkSpace(55)
      // Card background
      currentCommands.push(
        `0.98 0.98 0.99 rg 0.85 0.88 0.92 RG 0.8 w 50 ${currentY - 42} 495 44 re B`,
        `BT /F1 9 Tf 0.1 0.1 0.15 rg 60 ${currentY - 14} Td (${escapePdfText(f.title)}) Tj ET`,
        `BT /F1 8 Tf 0.6 0.2 0.2 rg 380 ${currentY - 14} Td (Severity: ${escapePdfText(f.severity.toUpperCase())}) Tj ET`
      )
      if (f.timestamp) {
        currentCommands.push(`BT /F1 8 Tf 0.1 0.45 0.6 rg 60 ${currentY - 26} Td (Timestamp: ${escapePdfText(f.timestamp)}) Tj ET`)
      }
      if (f.confidence) {
        currentCommands.push(`BT /F1 8 Tf 0.4 0.4 0.4 rg 220 ${currentY - 26} Td (Confidence: ${escapePdfText(String(f.confidence))}%) Tj ET`)
      }
      currentY -= 48

      // Explanation lines
      const explLines = wrapText(f.explanation, 90)
      for (const line of explLines) {
        checkSpace(12)
        currentCommands.push(`BT /F1 8 Tf 0.25 0.25 0.3 rg 60 ${currentY} Td (${escapePdfText(line)}) Tj ET`)
        currentY -= 11
      }
      if (f.humanReview) {
        checkSpace(14)
        currentCommands.push(`BT /F1 7.5 Tf 0.5 0.35 0.1 rg 60 ${currentY} Td (Recommended Action: ${escapePdfText(f.humanReview)}) Tj ET`)
        currentY -= 12
      }
      currentY -= 6
    }
    currentY -= 10
  }

  printFindingsCategory('Video Analysis', data.videoFindings)
  printFindingsCategory('Audio Analysis', data.audioFindings)
  printFindingsCategory('Transcript & Dialogue', data.transcriptFindings)
  if (data.imageFindings && data.imageFindings.length > 0) {
    printFindingsCategory('Image Analysis', data.imageFindings)
  }

  // --- CROSS-MODAL CORRELATION ---
  checkSpace(50)
  currentCommands.push(
    `BT /F1 11 Tf 0.1 0.15 0.2 rg 50 ${currentY} Td (Cross-Modal Evidence Correlation & Inconsistencies) Tj ET`,
    `0.8 0.8 0.8 RG 0.5 w 50 ${currentY - 4} 545 ${currentY - 4} l S`
  )
  currentY -= 18

  if (data.correlations.length === 0) {
    checkSpace(20)
    currentCommands.push('BT /F1 8 Tf 0.5 0.5 0.5 rg 50 ' + currentY + ' Td (No cross-modal discrepancies detected across analyzed audio, video, and transcript tracks.) Tj ET')
    currentY -= 18
  } else {
    for (const c of data.correlations) {
      checkSpace(38)
      currentCommands.push(
        `0.96 0.97 0.99 rg 0.8 0.85 0.9 RG 0.8 w 50 ${currentY - 26} 495 28 re B`,
        `BT /F1 8.5 Tf 0.15 0.2 0.3 rg 60 ${currentY - 12} Td (${escapePdfText(c.source)}  <--->  ${escapePdfText(c.target)}) Tj ET`,
        `BT /F1 8 Tf 0.2 0.5 0.7 rg 320 ${currentY - 12} Td (Relation: ${escapePdfText(c.relationship)}) Tj ET`
      )
      if (c.explanation) {
        currentCommands.push(`BT /F1 7.5 Tf 0.35 0.35 0.4 rg 60 ${currentY - 22} Td (${escapePdfText(c.explanation)}) Tj ET`)
      }
      currentY -= 32
    }
  }
  currentY -= 10

  // --- LIMITATIONS & HUMAN REVIEW RECOMMENDATIONS ---
  checkSpace(55)
  currentCommands.push(
    `BT /F1 11 Tf 0.1 0.15 0.2 rg 50 ${currentY} Td (Technical Limitations & Review Protocols) Tj ET`,
    `0.8 0.8 0.8 RG 0.5 w 50 ${currentY - 4} 545 ${currentY - 4} l S`
  )
  currentY -= 18

  const limItems = data.limitations.length > 0 ? data.limitations : [
    'Automated deep learning detectors possess probabilistic error bounds and may produce false positives/negatives.',
    'Heavy compression, downscaling, or acoustic background clutter reduces detector sensitivity.',
    'Human forensic examination of original raw source material is required for evidentiary certification.'
  ]

  for (const lim of limItems) {
    checkSpace(14)
    currentCommands.push(`BT /F1 7.5 Tf 0.35 0.35 0.4 rg 55 ${currentY} Td (* ${escapePdfText(lim)}) Tj ET`)
    currentY -= 12
  }
  currentY -= 8

  // Investigator Sign-off section
  checkSpace(65)
  currentCommands.push(
    '0.98 0.98 0.98 rg 0.8 0.8 0.8 RG 0.8 w 50 ' + (currentY - 50) + ' 495 52 re B',
    `BT /F1 8 Tf 0.2 0.2 0.2 rg 60 ${currentY - 16} Td (EXAMINER SIGN-OFF & CERTIFICATION) Tj ET`,
    `BT /F1 7.5 Tf 0.4 0.4 0.4 rg 60 ${currentY - 32} Td (Forensic Examiner: _______________________________    Review Date: _____________________) Tj ET`,
    `BT /F1 7.5 Tf 0.4 0.4 0.4 rg 60 ${currentY - 44} Td (Official Signature: _______________________________    Status: [   ] Certified  [   ] Rejected) Tj ET`
  )

  // Push final page
  pages.push(currentCommands.join('\n'))

  // --- ASSEMBLE FULL PDF DOCUMENT ---
  const objects: string[] = []
  const pageObjIds: number[] = []

  // Object 1: Catalog
  // Object 2: Pages tree
  // Object 3: Font
  // Then each page gets a Page object and a Contents object
  let nextId = 4

  for (let i = 0; i < pages.length; i++) {
    const pageId = nextId++
    const contentId = nextId++
    pageObjIds.push(pageId)

    const stream = pages[i]
    objects.push(
      // Page obj
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>\nendobj`,
      // Content obj
      `${contentId} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj`
    )
  }

  // Header and root objs
  const catalog = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj'
  const pagesTree = `2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj`
  const font = '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj'

  const allObjs = [catalog, pagesTree, font, ...objects]

  let pdfBody = '%PDF-1.4\n'
  const offsets: number[] = []

  for (const obj of allObjs) {
    offsets.push(pdfBody.length)
    pdfBody += `${obj}\n`
  }

  const xrefOffset = pdfBody.length
  pdfBody += `xref\n0 ${allObjs.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    pdfBody += `${offset.toString().padStart(10, '0')} 00000 n \n`
  }
  pdfBody += `trailer\n<< /Size ${allObjs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

  return new Blob([pdfBody], { type: 'application/pdf' })
}
