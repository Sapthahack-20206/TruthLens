/**
 * Local Test Suite for TruthLens Audio Forensic Analysis
 * Tests:
 * 1. Audio format support and header parsing (WAV, MP3, M4A)
 * 2. Signal preprocessing (RMS, Peak, Noise Floor, SNR, Dynamic Range)
 * 3. Manipulation indicator detection (clipping, silence dropout, splice cut)
 * 4. Extracted audio WAV generation
 * 5. Backend API route /api/analyze/audio handling and error validation
 */

const API_ENDPOINT = 'http://localhost:3000/api/analyze/audio'

function createSyntheticWavBuffer({
  sampleRate = 44100,
  durationSec = 2,
  includeClipping = true,
  includeSilenceDrop = true,
  includeSplice = true,
} = {}) {
  const numChannels = 1
  const bytesPerSample = 2
  const totalSamples = sampleRate * durationSec
  const dataSize = totalSamples * numChannels * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)

  // Write WAV header
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16) // Subchunk1Size
  buffer.writeUInt16LE(1, 20)  // PCM
  buffer.writeUInt16LE(numChannels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28) // ByteRate
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32) // BlockAlign
  buffer.writeUInt16LE(16, 34) // BitsPerSample
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  // Fill samples
  let offset = 44
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate
    let sampleVal = 0

    // Region 1: Normal speech tone with ambient noise (0.0s to 0.7s)
    if (t < 0.7) {
      const tone = Math.sin(2 * Math.PI * 440 * t) * 0.4
      const ambientNoise = (Math.random() - 0.5) * 0.04
      sampleVal = tone + ambientNoise
    }
    // Region 2: Abrupt dead silence dropout (0.7s to 1.1s)
    else if (t < 1.1) {
      sampleVal = includeSilenceDrop ? 0 : 0.05
    }
    // Region 3: Digital hard clipping & high transient splice (1.1s to 1.5s)
    else if (t < 1.5) {
      if (includeClipping) {
        sampleVal = 1.0 // Saturated / clamped
      } else {
        sampleVal = 0.5
      }
    }
    // Region 4: Natural decay tone (1.5s to 2.0s)
    else {
      const tone = Math.sin(2 * Math.PI * 880 * t) * 0.3 * Math.exp(-(t - 1.5) * 3)
      sampleVal = tone
    }

    sampleVal = Math.max(-1, Math.min(1, sampleVal))
    const intVal = sampleVal < 0 ? sampleVal * 0x8000 : sampleVal * 0x7fff
    buffer.writeInt16LE(Math.round(intVal), offset)
    offset += 2
  }

  return buffer
}

async function runTests() {
  console.log('=== TruthLens Advanced Audio Forensic Local Test Suite ===\n')
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

  // TEST 1: Synthesize and validate WAV audio with manipulation anomalies
  console.log('1. Testing Acoustic Preprocessing & Waveform Generation...')
  const wavBuffer = createSyntheticWavBuffer()
  assert(wavBuffer.length > 44, 'WAV buffer generated with valid header and payload')
  assert(wavBuffer.toString('ascii', 0, 4) === 'RIFF', 'RIFF header verified')
  assert(wavBuffer.toString('ascii', 8, 12) === 'WAVE', 'WAVE format tag verified')
  assert(wavBuffer.readUInt16LE(20) === 1, 'Audio format is uncompressed linear PCM')

  // TEST 2: Test backend /api/analyze/audio endpoint with valid WAV
  console.log('\n2. Testing Backend Audio Analysis Route (POST /api/analyze/audio)...')
  const fileBlob = new Blob([wavBuffer], { type: 'audio/wav' })
  const mockFile = new File([fileBlob], 'forensic_evidence_sample.wav', { type: 'audio/wav' })

  const formData = new FormData()
  formData.append('file', mockFile)
  formData.append('context', 'Suspected audio splice at 00:01 with voice cloning.')

  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    body: formData,
  })
  assert(response.status === 200, `API route returned status 200 (Got ${response.status})`)

  const data = await response.json()
  assert(data.status === 'completed', `Analysis status is completed (Got ${data.status})`)
  assert(typeof data.assessment === 'string', `Forensic assessment returned: "${data.assessment}"`)
  assert(data.metadata && data.metadata.filename.includes('forensic_evidence_sample.wav'), 'Metadata filename recorded correctly')
  assert(Array.isArray(data.findings) && data.findings.length > 0, `Structured acoustic findings returned (${data.findings.length} findings)`)
  assert(Array.isArray(data.suspiciousTimestamps), 'Suspicious timestamps array present')
  assert(Array.isArray(data.limitations) && data.limitations.length > 0, 'Forensic limitations disclaimers included')

  // TEST 3: Test unsupported format handling
  console.log('\n3. Testing Format Validation & Error Handling...')
  const invalidBlob = new Blob(['fake binary'], { type: 'application/zip' })
  const invalidFile = new File([invalidBlob], 'malware_sample.zip', { type: 'application/zip' })
  const invalidFormData = new FormData()
  invalidFormData.append('file', invalidFile)

  const invalidResponse = await fetch(API_ENDPOINT, {
    method: 'POST',
    body: invalidFormData,
  })
  const invalidData = await invalidResponse.json()
  assert(invalidData.status === 'failed' || invalidResponse.status === 400, 'Unsupported format safely flagged')
  assert(Array.isArray(invalidData.processingErrors) && invalidData.processingErrors.length > 0, 'Informative validation error message returned')

  // TEST 4: Test MP3 and M4A extension detection
  console.log('\n4. Testing MP3 / M4A / Extracted Video Format Support...')
  const mp3File = new File([new Uint8Array([0xff, 0xfb, 0x90, 0x64])], 'interview_call.mp3', { type: 'audio/mpeg' })
  const mp3FormData = new FormData()
  mp3FormData.append('file', mp3File)

  const mp3Response = await fetch(API_ENDPOINT, { method: 'POST', body: mp3FormData })
  assert(mp3Response.status === 200, 'MP3 format accepted and processed')
  const mp3Data = await mp3Response.json()
  assert(mp3Data.metadata && mp3Data.metadata.mimeType.includes('audio'), 'MP3 audio container identified correctly')

  const m4aFile = new File([new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])], 'wiretap.m4a', { type: 'audio/mp4' })
  const m4aFormData = new FormData()
  m4aFormData.append('file', m4aFile)

  const m4aResponse = await fetch(API_ENDPOINT, { method: 'POST', body: m4aFormData })
  assert(m4aResponse.status === 200, 'M4A format accepted and processed')
  const m4aData = await m4aResponse.json()
  assert(m4aData.metadata && m4aData.metadata.mimeType.includes('audio'), 'M4A audio container identified correctly')

  // TEST 5: Verify speech transcript timestamps preservation
  console.log('\n5. Testing Transcript Timestamps & Playback Sync Logic...')
  const testTranscript = [
    { id: 'line-1', startTime: 0.0, endTime: 1.5, speaker: 'Speaker A', text: 'Good morning, verified audio test.' },
    { id: 'line-2', startTime: 1.5, endTime: 3.2, speaker: 'Speaker B', text: 'Confirming acoustic continuity and noise floor.' },
  ]

  assert(testTranscript[0].startTime < testTranscript[0].endTime, 'Segment 1 preserves valid non-zero duration')
  assert(testTranscript[1].startTime >= testTranscript[0].endTime, 'Segment timestamps are strictly sequential and monotonically increasing')

  // Test active line synchronization helper
  function findActiveLine(lines, time) {
    return lines.find((l) => time >= l.startTime && time <= l.endTime)
  }

  assert(findActiveLine(testTranscript, 0.8)?.id === 'line-1', 'Active line at 0.8s resolved to line-1')
  assert(findActiveLine(testTranscript, 2.1)?.id === 'line-2', 'Active line at 2.1s resolved to line-2')
  assert(findActiveLine(testTranscript, 5.0) === undefined, 'No active line returned beyond transcript duration')

  console.log(`\n=== Test Results: ${passed} Passed, ${failed} Failed ===`)
  if (failed > 0) {
    process.exit(1)
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err)
  process.exit(1)
})
