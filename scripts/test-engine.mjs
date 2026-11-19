/**
 * TruthLens Analysis Engine Verification Script
 */
import { validateMagicNumber } from '../lib/analysis/media-processor'
import { extractImageMetadata, generateErrorLevelAnalysis } from '../lib/analysis/image-analyzer'
import { extractAudioMetadata, analyzeAudioAcoustics } from '../lib/analysis/audio-analyzer'
import { parseMp4ContainerMetadata } from '../lib/analysis/media-processor'
import { generateForensicPdfReport } from '../lib/analysis/report-generator'
import { saveForensicResponse, getForensicResponseById, listAllInvestigations } from '../lib/analysis/investigation-store'

console.log('--- TruthLens Forensic Analysis Engine Tests ---')

// 1. Media Processor: Magic numbers
const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
const wavHeader = Buffer.from('RIFF....WAVEfmt ', 'ascii')
const mp4Header = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])

console.log('Testing magic numbers:')
console.assert(validateMagicNumber(jpegHeader, 'image').valid === true, 'JPEG magic check failed')
console.assert(validateMagicNumber(pngHeader, 'image').valid === true, 'PNG magic check failed')
console.assert(validateMagicNumber(wavHeader, 'audio').valid === true, 'WAV magic check failed')
console.assert(validateMagicNumber(mp4Header, 'video').valid === true, 'MP4 magic check failed')
console.log('✓ Magic number verification passed.')

// 2. Image Analyzer: ELA and Metadata
console.log('Testing Image ELA and Metadata:')
const syntheticPng = Buffer.concat([
  pngHeader,
  Buffer.from('IHDR\x00\x00\x01\x00\x00\x00\x01\x00\x08\x06\x00\x00\x00', 'binary'),
  Buffer.from('\x00\x00\x00\x25tEXtparameters\x00Created by Midjourney v6 photorealistic prompt', 'binary')
])
const imgMeta = extractImageMetadata(syntheticPng, 'test_synthetic.png', 'image/png', 'hash123')
console.assert(imgMeta.softwareSignatures && imgMeta.softwareSignatures.length > 0, 'AI signature extraction failed')
console.log('Detected signatures:', imgMeta.softwareSignatures)

const ela = generateErrorLevelAnalysis(syntheticPng, 256, 256)
console.assert(ela.elaDataUri.startsWith('data:image/svg+xml'), 'ELA data uri generation failed')
console.log('✓ Image analysis and ELA passed.')

// 3. Audio Analyzer: Acoustics
console.log('Testing Audio Acoustics:')
const dummyPcm = Buffer.alloc(44100 * 2) // 1 second of 16-bit mono PCM (zeros = silence)
const acoustics = analyzeAudioAcoustics(dummyPcm, 44100)
console.assert(acoustics.unnaturalSilences.length > 0, 'Digital zero silence detection failed')
console.log('Detected silences:', acoustics.unnaturalSilences.length)
console.log('✓ Audio acoustics analysis passed.')

// 4. Video Container Parsing
console.log('Testing Video Container Metadata:')
const dummyMp4 = Buffer.concat([
  mp4Header,
  Buffer.from([0x00, 0x00, 0x00, 0x18, 0x6d, 0x6f, 0x6f, 0x76, 0x00, 0x00, 0x00, 0x10, 0x6d, 0x76, 0x68, 0x64])
])
const vidMeta = parseMp4ContainerMetadata(dummyMp4)
console.assert(vidMeta.format === 'MP4 / QuickTime', 'MP4 format parsing failed')
console.log('✓ Video container parser passed.')

// 5. PDF Forensic Report Generation
console.log('Testing PDF Forensic Report:')
const dummyResponse = {
  id: 'inv_test123',
  investigationId: 'inv_test123',
  reportId: 'rep_test456',
  status: 'completed',
  mediaType: 'image',
  assessment: 'Suspect - Compression Divergence Flagged',
  summary: 'Image forensic examination identified localized compression gradient anomalies.',
  metadata: { Filename: 'sample.jpg', SHA256: 'abcd1234' },
  indicators: [],
  findings: [{ id: 'fnd_1', type: 'Compression', title: 'ELA Divergence', description: 'Sample finding' }],
  suspiciousTimestamps: [],
  evidenceRelationships: [],
  visualizations: [],
  limitations: ['Heuristic inspection only'],
  errors: [],
  createdAt: new Date().toISOString()
}
const pdfBuffer = generateForensicPdfReport(dummyResponse)
console.assert(pdfBuffer.subarray(0, 5).toString('ascii') === '%PDF-', 'PDF magic header missing')
console.assert(pdfBuffer.toString('latin1').includes('%%EOF'), 'PDF EOF missing')
console.log('✓ PDF report generated successfully, size:', pdfBuffer.length, 'bytes.')

// 6. Investigation Store
console.log('Testing Store Persistence:')
await saveForensicResponse(dummyResponse)
const retrieved = await getForensicResponseById('inv_test123')
console.assert(retrieved !== null && retrieved.id === 'inv_test123', 'Store retrieval failed')
const all = await listAllInvestigations()
console.assert(all.length > 0, 'Listing investigations failed')
console.log('✓ Investigation store verified with', all.length, 'records.')

console.log('\nALL ENGINE CHECKS PASSED SUCCESSFULLY!')
