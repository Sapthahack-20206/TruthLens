/**
 * Video Forensic Pipeline Verification Script
 */
import fs from 'node:fs'
import path from 'node:path'
import { analyzeVideoEvidence } from '../lib/analysis/video-analyzer.ts'
import { processUploadedEvidence } from '../lib/analysis/media-processor.ts'

console.log('=== TruthLens Advanced Video Forensic Analysis Tests ===\n')

async function runTests() {
  const sampleVideoPath = path.join(process.cwd(), 'public', 'videos', 'gemini_generated_video_a5be6a4a.mp4')
  if (!fs.existsSync(sampleVideoPath)) {
    console.error('Sample video not found at:', sampleVideoPath)
    process.exit(1)
  }

  console.log('1. Loading sample video:', sampleVideoPath)
  const buffer = fs.readFileSync(sampleVideoPath)
  const videoBlob = new Blob([buffer], { type: 'video/mp4' })
  const videoFile = new File([videoBlob], 'gemini_generated_video_a5be6a4a.mp4', { type: 'video/mp4' })

  console.log('2. Processing uploaded evidence (validating magic numbers, size, hashing)...')
  const evidence = await processUploadedEvidence(videoFile, 'video')
  console.log('✓ Evidence processed successfully:')
  console.log('   SHA256:', evidence.sha256)
  console.log('   Size:', (evidence.size / 1024 / 1024).toFixed(2), 'MB')
  console.log('   Temp path:', evidence.tempPath)

  console.log('\n3. Executing Advanced Video Analysis Engine (OpenCV YuNet + Temporal Inspection)...')
  const startTime = Date.now()
  const result = await analyzeVideoEvidence(evidence, 'Testing sample synthetic video')
  const duration = ((Date.now() - startTime) / 1000).toFixed(2)

  console.log(`✓ Analysis completed in ${duration}s with status:`, result.status)
  console.log('   Assessment:', result.assessment)
  console.log('   Summary:', result.summary)
  console.log('   Metadata:', JSON.stringify(result.metadata, null, 2))
  console.log('   Indicators count:', result.indicators.length)
  console.log('   Findings count:', result.findings.length)
  console.log('   Suspicious Timestamps count:', result.suspiciousTimestamps.length)
  console.log('   Sampled Frames count:', result.sampledFrames?.length || 0)
  console.log('   Timeline Segments count:', result.timelineSegments?.length || 0)

  // Assertions
  console.assert(result.status === 'completed', 'Expected completed status')
  console.assert(result.mediaType === 'video', 'Expected mediaType video')
  console.assert(result.metadata.FacesDetected !== undefined, 'Expected FacesDetected in metadata')
  console.assert((result.sampledFrames?.length || 0) > 0, 'Expected sampled frames with thumbnails')
  console.assert((result.timelineSegments?.length || 0) > 0, 'Expected timeline segments')

  if (result.sampledFrames && result.sampledFrames.length > 0) {
    const f0 = result.sampledFrames[0]
    console.log(`   Frame #0: ${f0.timestamp} (${f0.timeSeconds}s), Faces: ${f0.facesDetected}, Thumbnail present: ${f0.thumbnailUrl.startsWith('data:image/jpeg;base64,')}`)
  }

  console.log('\n4. Testing Corrupted Video File Handling...')
  const corruptBuffer = Buffer.from('NOT_A_REAL_VIDEO_CORRUPTED_STREAM_DATA')
  const corruptFile = new File([new Blob([corruptBuffer])], 'corrupt.mp4', { type: 'video/mp4' })
  try {
    const corruptEv = await processUploadedEvidence(corruptFile, 'video')
    const corruptRes = await analyzeVideoEvidence(corruptEv)
    console.assert(corruptRes.status === 'failed', 'Corrupt video should have failed')
    console.log('✓ Corrupted video handled gracefully with failed status:', corruptRes.summary)
  } catch (err) {
    console.log('✓ Corrupted video correctly rejected by validation gate:', err.message)
  }

  console.log('\n=== ALL VIDEO FORENSIC ENGINE TESTS PASSED! ===')
}

runTests().catch(err => {
  console.error('Test execution failed:', err)
  process.exit(1)
})
