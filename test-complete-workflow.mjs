/**
 * TruthLens Complete End-to-End Workflow & Integration Test
 * Verifies:
 * 1. Image analysis pipeline (POST /api/analyze/image)
 * 2. Audio analysis pipeline (POST /api/analyze/audio)
 * 3. Video analysis pipeline (POST /api/analyze/video)
 * 4. Cross-Modal analysis pipeline (POST /api/analyze/cross-modal) with multi-stream bundle
 * 5. Unified investigations retrieval (GET /api/investigations & /api/investigations/:id)
 * 6. PDF report retrieval (GET /api/reports/:id)
 * 7. Error handling & validation failures (empty file, unsupported mime)
 * 8. API response structure consistency
 */

import fs from 'node:fs'
import path from 'node:path'

const BASE_URL = 'http://localhost:3000'

async function runEndToEndIntegrationTests() {
  console.log('=== TruthLens Complete Workflow & Integration Test Suite ===\n')

  let passed = 0
  let failed = 0

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`)
      passed++
    } else {
      console.error(`  [FAIL] ${message}`)
      failed++
    }
  }

  // Helper to create synthetic 1x1 PNG image
  function createSamplePngBuffer() {
    return Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82
    ])
  }

  // Helper to create synthetic WAV buffer
  function createSampleWavBuffer() {
    const sampleRate = 44100
    const duration = 1.0
    const totalSamples = Math.floor(sampleRate * duration)
    const dataSize = totalSamples * 2
    const buf = Buffer.alloc(44 + dataSize)
    buf.write('RIFF', 0)
    buf.writeUInt32LE(36 + dataSize, 4)
    buf.write('WAVE', 8)
    buf.write('fmt ', 12)
    buf.writeUInt32LE(16, 16)
    buf.writeUInt16LE(1, 20)
    buf.writeUInt16LE(1, 22)
    buf.writeUInt32LE(sampleRate, 24)
    buf.writeUInt32LE(sampleRate * 2, 28)
    buf.writeUInt16LE(2, 32)
    buf.writeUInt16LE(16, 34)
    buf.write('data', 36)
    buf.writeUInt32LE(dataSize, 40)
    for (let i = 0; i < totalSamples; i++) {
      const val = Math.round(Math.sin(2 * Math.PI * 440 * (i / sampleRate)) * 10000)
      buf.writeInt16LE(val, 44 + i * 2)
    }
    return buf
  }

  // ==========================================
  // STAGE 1: Image Analysis Workflow
  // ==========================================
  console.log('1. Testing Image Analysis Workflow (POST /api/analyze/image)...')
  const pngBuf = createSamplePngBuffer()
  const imgFile = new File([pngBuf], 'surveillance_capture.png', { type: 'image/png' })
  const imgFormData = new FormData()
  imgFormData.append('file', imgFile)
  imgFormData.append('context', 'Examine compression boundary and color quantization.')

  const imgRes = await fetch(`${BASE_URL}/api/analyze/image`, {
    method: 'POST',
    body: imgFormData,
  })
  assert(imgRes.status === 200, `Image analysis responded with 200 (Got ${imgRes.status})`)
  const imgData = await imgRes.json()
  assert(imgData.status === 'completed', `Image analysis status is completed (Got ${imgData.status})`)
  assert(typeof imgData.assessment === 'string', `Image assessment returned: "${imgData.assessment}"`)
  assert(Array.isArray(imgData.findings) && imgData.findings.length > 0, `Image findings generated (${imgData.findings.length} findings)`)
  assert(imgData.metadata.mimeType === 'image/png', 'Metadata correctly detected image/png')
  assert(typeof imgData.investigationId === 'string', `Generated investigation ID: ${imgData.investigationId}`)

  // ==========================================
  // STAGE 2: Audio Analysis Workflow
  // ==========================================
  console.log('\n2. Testing Audio Analysis Workflow (POST /api/analyze/audio)...')
  const wavBuf = createSampleWavBuffer()
  const audFile = new File([wavBuf], 'recorded_interview.wav', { type: 'audio/wav' })
  const audFormData = new FormData()
  audFormData.append('file', audFile)
  audFormData.append('context', 'Suspected audio splice at 0.5s.')

  const audRes = await fetch(`${BASE_URL}/api/analyze/audio`, {
    method: 'POST',
    body: audFormData,
  })
  assert(audRes.status === 200, `Audio analysis responded with 200 (Got ${audRes.status})`)
  const audData = await audRes.json()
  assert(audData.status === 'completed', `Audio analysis status is completed (Got ${audData.status})`)
  assert(Array.isArray(audData.findings) && audData.findings.length > 0, `Audio acoustic findings generated (${audData.findings.length} findings)`)
  assert(Array.isArray(audData.suspiciousTimestamps), 'Suspicious timestamps array returned')
  assert(Array.isArray(audData.limitations) && audData.limitations.length > 0, 'Forensic limitations included')

  // ==========================================
  // STAGE 3: Video Analysis Workflow
  // ==========================================
  console.log('\n3. Testing Video Analysis Workflow (POST /api/analyze/video)...')
  // Check if sample video exists in public/videos
  const sampleVideoPath = path.resolve('public/videos/gemini_generated_video_a5be6a4a.mp4')
  let sampleVideoBuf
  if (fs.existsSync(sampleVideoPath)) {
    sampleVideoBuf = fs.readFileSync(sampleVideoPath)
  } else {
    sampleVideoBuf = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])
  }

  const vidFile = new File([sampleVideoBuf], 'incident_footage.mp4', { type: 'video/mp4' })
  const vidFormData = new FormData()
  vidFormData.append('file', vidFile)
  vidFormData.append('context', 'Deepfake face swap suspicion during televised speech.')

  const vidRes = await fetch(`${BASE_URL}/api/analyze/video`, {
    method: 'POST',
    body: vidFormData,
  })
  assert(vidRes.status === 200, `Video analysis responded with 200 (Got ${vidRes.status})`)
  const vidData = await vidRes.json()
  assert(vidData.status === 'completed', `Video analysis status is completed (Got ${vidData.status})`)
  assert(Array.isArray(vidData.findings) && vidData.findings.length > 0, `Video findings generated (${vidData.findings.length} findings)`)
  assert(vidData.metadata.mimeType === 'video/mp4', 'Metadata detected video/mp4 container')

  // ==========================================
  // STAGE 4: Cross-Modal Multi-Stream Bundle Analysis
  // ==========================================
  console.log('\n4. Testing Cross-Modal Multi-Stream Bundle Analysis (POST /api/analyze/cross-modal)...')
  const transcriptText = `[00:00.00 - 00:02.00] Good morning. We are reviewing forensic evidence.
[00:02.00 - 00:04.50] Confirming acoustic tone continuity and visual frame integrity.`
  const txtFile = new File([Buffer.from(transcriptText)], 'witness_transcript.txt', { type: 'text/plain' })

  const crossFormData = new FormData()
  crossFormData.append('files', vidFile)
  crossFormData.append('files', audFile)
  crossFormData.append('files', txtFile)
  crossFormData.append('context', 'Tri-modal verification: align speech timestamps with visual facial movement.')

  const crossRes = await fetch(`${BASE_URL}/api/analyze/cross-modal`, {
    method: 'POST',
    body: crossFormData,
  })
  assert(crossRes.status === 200, `Cross-modal analysis responded with 200 (Got ${crossRes.status})`)
  const crossData = await crossRes.json()
  assert(crossData.status === 'completed', `Cross-modal status is completed (Got ${crossData.status})`)
  assert(Array.isArray(crossData.evidenceRelationships) && crossData.evidenceRelationships.length > 0, `Cross-modal evidence relationships generated (${crossData.evidenceRelationships.length} relationships)`)
  
  // Verify transcript was linked
  const hasTranscriptRelationship = crossData.evidenceRelationships.some(
    (r) => r.relationship.includes('Transcript') || r.inconsistencyType === 'transcript-mismatch'
  )
  assert(hasTranscriptRelationship, 'Transcript document successfully correlated with visual/audio streams')

  // ==========================================
  // STAGE 5: Investigations Retrieval & History
  // ==========================================
  console.log('\n5. Testing Investigations Retrieval & History...')
  const listRes = await fetch(`${BASE_URL}/api/investigations`)
  assert(listRes.status === 200, `GET /api/investigations returned status 200 (Got ${listRes.status})`)
  const records = await listRes.json()
  assert(Array.isArray(records) && records.length > 0, `Investigation records retrieved (${records.length} records in store)`)

  const testId = records[0].id
  const detailRes = await fetch(`${BASE_URL}/api/investigations/${encodeURIComponent(testId)}`)
  assert(detailRes.status === 200, `GET /api/investigations/${testId} returned status 200`)
  const detailRecord = await detailRes.json()
  assert(detailRecord.id === testId, `Retrieved exact record match: ${detailRecord.id}`)
  assert(typeof detailRecord.filename === 'string', `Recorded filename: "${detailRecord.filename}"`)

  // ==========================================
  // STAGE 6: PDF Report Retrieval
  // ==========================================
  console.log('\n6. Testing Forensic Report Endpoint (GET /api/reports/:id)...')
  const reportId = crossData.reportId || records[0].reportId
  if (reportId) {
    const repRes = await fetch(`${BASE_URL}/api/reports/${encodeURIComponent(reportId)}`)
    assert(repRes.status === 200, `Report endpoint returned status 200 (Got ${repRes.status})`)
    const contentType = repRes.headers.get('content-type') || ''
    assert(contentType.includes('application/pdf'), `Report returned PDF MIME type (Got "${contentType}")`)
    const pdfBuf = await repRes.arrayBuffer()
    assert(pdfBuf.byteLength > 100, `Valid PDF payload downloaded (${pdfBuf.byteLength} bytes)`)
  }

  // ==========================================
  // STAGE 7: Validation Failures & Error Handling
  // ==========================================
  console.log('\n7. Testing Input Validation & Error Handling...')
  // Empty file upload
  const emptyFormData = new FormData()
  emptyFormData.append('file', new File([], 'empty.wav', { type: 'audio/wav' }))
  const emptyRes = await fetch(`${BASE_URL}/api/analyze/audio`, { method: 'POST', body: emptyFormData })
  const emptyData = await emptyRes.json()
  assert(emptyData.status === 'failed' || emptyRes.status === 400, 'Empty file safely rejected')

  // Unsupported format upload
  const zipFormData = new FormData()
  zipFormData.append('file', new File([Buffer.from('not an image')], 'malicious.zip', { type: 'application/zip' }))
  const zipRes = await fetch(`${BASE_URL}/api/analyze/image`, { method: 'POST', body: zipFormData })
  const zipData = await zipRes.json()
  assert(zipData.status === 'failed' || zipRes.status === 400, 'Unsupported ZIP archive safely rejected')

  // No file upload
  const noFileRes = await fetch(`${BASE_URL}/api/analyze/image`, { method: 'POST', body: new FormData() })
  assert(noFileRes.status === 400, `Missing file rejected with 400 (Got ${noFileRes.status})`)

  console.log(`\n=== Workflow Verification Results: ${passed} Passed, ${failed} Failed ===`)
}

runEndToEndIntegrationTests().catch((err) => {
  console.error('Fatal error during integration tests:', err)
  process.exit(1)
})
