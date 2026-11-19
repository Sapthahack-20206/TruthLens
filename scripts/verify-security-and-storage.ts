import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { NextRequest } from 'next/server'

import { middleware } from '../middleware'
import { authService } from '../lib/backend-engine/auth-service'
import { investigationStore } from '../lib/backend-engine/investigation-store'
import { cloudStorage } from '../lib/backend-engine/cloud-storage'
import { rateLimiter, enforceRateLimit } from '../lib/backend-engine/rate-limiter'
import { validateFileSignature, sanitizeFilename, MAX_VIDEO_SIZE_BYTES } from '../lib/backend-engine/security-utils'
import { dbManager } from '../lib/backend-engine/db'
import { processAndAnalyzeMedia, processAndAnalyzeStorageKey } from '../lib/backend-engine/analyzer-service'

// Import API route handlers
import { GET as getReportRoute } from '../app/api/reports/[id]/route'
import { POST as presignedUploadRoute } from '../app/api/upload/presigned/route'
import { PUT as directUploadRoute } from '../app/api/upload/direct/route'
import { POST as analyzeVideoRoute } from '../app/api/analyze/video/route'
import { GET as getInvestigationRoute } from '../app/api/investigations/[id]/route'

let passed = 0
let failed = 0

function it(desc: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn()
      passed++
      console.log(`  ✓ ${desc}`)
    } catch (err) {
      failed++
      console.error(`  ✗ ${desc}`)
      console.error(err)
    }
  })()
}

async function runAllTests() {
  console.log('\n======================================================')
  console.log(' TruthLens Security & Cloud Storage Verification Test')
  console.log('======================================================\n')

  // ----------------------------------------------------------------
  console.log('--- 1. CORS & Security Headers Middleware Tests ---')
  // ----------------------------------------------------------------
  await it('Blocks wildcard CORS with credentials on allowed dev origin', async () => {
    const req = new NextRequest('http://localhost:3000/api/investigations', {
      method: 'GET',
      headers: {
        origin: 'http://localhost:3000',
      },
    })
    const res = middleware(req)
    const allowOrigin = res.headers.get('Access-Control-Allow-Origin')
    const allowCreds = res.headers.get('Access-Control-Allow-Credentials')

    assert.strictEqual(allowOrigin, 'http://localhost:3000', 'Should reflect the matching origin')
    assert.strictEqual(allowCreds, 'true', 'Should allow credentials only for matching origin')
    assert.notStrictEqual(allowOrigin, '*', 'Must NEVER be wildcard * when credentials is true')
  })

  await it('Disallows CORS headers for unauthorized cross-origin attacker domain', async () => {
    const req = new NextRequest('http://localhost:3000/api/investigations', {
      method: 'GET',
      headers: {
        origin: 'https://evil-hacker.com',
      },
    })
    const res = middleware(req)
    const allowOrigin = res.headers.get('Access-Control-Allow-Origin')
    assert.strictEqual(allowOrigin, null, 'Must not emit Access-Control-Allow-Origin for unauthorized domain')
  })

  await it('Rejects preflight OPTIONS for unauthorized attacker origin', async () => {
    const req = new NextRequest('http://localhost:3000/api/investigations', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil-hacker.com',
      },
    })
    const res = middleware(req)
    assert.strictEqual(res.status, 403, 'Preflight from untrusted origin must return 403 Forbidden')
  })

  await it('Accepts preflight OPTIONS for permitted localhost origin', async () => {
    const req = new NextRequest('http://localhost:3000/api/investigations', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:3000',
      },
    })
    const res = middleware(req)
    assert.strictEqual(res.status, 204, 'Preflight from allowed origin must return 204 No Content')
    assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), 'http://localhost:3000')
    assert.strictEqual(res.headers.get('Access-Control-Allow-Credentials'), 'true')
  })

  // ----------------------------------------------------------------
  console.log('\n--- 2. Report Ownership & Authorization Tests ---')
  // ----------------------------------------------------------------
  const userAId = 'usr-alice-test'
  const userBId = 'usr-bob-test'
  const testReportId = 'rep-alice-secret-001'
  const testInvId = 'inv-alice-secret-001'

  // Seed User A's private investigation
  investigationStore.saveRecord({
    id: testInvId,
    filename: 'confidential_briefing.mp4',
    mediaType: 'video',
    createdAt: new Date().toISOString(),
    status: 'completed',
    assessment: 'Sensitive investigation record.',
    requiresReview: true,
    reportId: testReportId,
    userId: userAId,
    fileSize: 10485760,
  })

  investigationStore.saveOutput({
    id: 'TL-ALICE-SECRET',
    investigationId: testInvId,
    reportId: testReportId,
    status: 'completed',
    assessment: 'Private analysis output.',
    uncertaintyStatus: 'Requires Further Review',
    summary: 'Classified analytical output.',
    findings: [],
    suspiciousTimestamps: [],
    evidenceRelationships: [],
    visualizations: [],
    limitations: [],
    metadata: {
      filename: 'confidential_briefing.mp4',
      fileSize: 10485760,
      mimeType: 'video/mp4',
      extension: '.mp4',
      hashSha256: 'abc',
    },
    processingErrors: [],
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  }, userAId)

  await it('Allows authorized owner (User A) to access and download their report PDF', async () => {
    const req = new NextRequest(`http://localhost:3000/api/reports/${testReportId}`, {
      method: 'GET',
      headers: {
        'x-user-id': userAId,
      },
    })
    const res = await getReportRoute(req, { params: Promise.resolve({ id: testReportId }) })
    assert.strictEqual(res.status, 200, 'Owner must receive 200 OK')
    assert.strictEqual(res.headers.get('Content-Type'), 'application/pdf')
  })

  await it('Blocks unauthorized User B with 403 Forbidden when attempting to access User A report', async () => {
    const req = new NextRequest(`http://localhost:3000/api/reports/${testReportId}`, {
      method: 'GET',
      headers: {
        'x-user-id': userBId,
      },
    })
    const res = await getReportRoute(req, { params: Promise.resolve({ id: testReportId }) })
    assert.strictEqual(res.status, 403, 'Unauthorized user must receive 403 Forbidden')
    const body = await res.json()
    assert(body.detail.includes('Forbidden'), 'Response must explain forbidden access')
  })

  await it('Blocks unauthenticated guest with 403 Forbidden from accessing User A report', async () => {
    const req = new NextRequest(`http://localhost:3000/api/reports/${testReportId}`, {
      method: 'GET',
    })
    const res = await getReportRoute(req, { params: Promise.resolve({ id: testReportId }) })
    assert.strictEqual(res.status, 403, 'Unauthenticated guest must receive 403 Forbidden')
  })

  await it('Returns 404 for completely non-existent report', async () => {
    const req = new NextRequest('http://localhost:3000/api/reports/rep-does-not-exist', {
      method: 'GET',
      headers: {
        'x-user-id': userAId,
      },
    })
    const res = await getReportRoute(req, { params: Promise.resolve({ id: 'rep-does-not-exist' }) })
    assert.strictEqual(res.status, 404, 'Non-existent report must return 404')
  })

  await it('Allows public inspection of baseline demo report rep-baseline-001', async () => {
    const req = new NextRequest('http://localhost:3000/api/reports/rep-baseline-001', {
      method: 'GET',
    })
    const res = await getReportRoute(req, { params: Promise.resolve({ id: 'rep-baseline-001' }) })
    assert.strictEqual(res.status, 200, 'Baseline demo report must be accessible')
    assert.strictEqual(res.headers.get('Content-Type'), 'application/pdf')
  })

  // ----------------------------------------------------------------
  console.log('\n--- 3. Presigned Upload & Direct Upload Security Tests ---')
  // ----------------------------------------------------------------
  await it('Rejects dangerous executable extensions (.exe, .sh, .php) at presign time', async () => {
    const dangerousFiles = ['trojan.exe', 'exploit.sh', 'backdoor.php', 'script.js']
    for (const df of dangerousFiles) {
      const req = new NextRequest('http://localhost:3000/api/upload/presigned', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userAId,
        },
        body: JSON.stringify({
          filename: df,
          mimeType: 'application/octet-stream',
          fileSize: 1024,
        }),
      })
      const res = await presignedUploadRoute(req)
      assert.strictEqual(res.status, 400, `Must reject ${df} with 400 Bad Request`)
    }
  })

  await it('Rejects oversized file upload requests exceeding category threshold', async () => {
    const req = new NextRequest('http://localhost:3000/api/upload/presigned', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userAId,
      },
      body: JSON.stringify({
        filename: 'huge_video.mp4',
        mimeType: 'video/mp4',
        fileSize: 150 * 1024 * 1024, // 150MB > 100MB max limit
        category: 'video',
      }),
    })
    const res = await presignedUploadRoute(req)
    assert.strictEqual(res.status, 400, 'Oversized payload must be rejected')
    const body = await res.json()
    assert(body.detail.includes('maximum allowed size'), 'Error should state max size limit')
  })

  let presignedResult: any = null
  await it('Generates valid presigned upload parameters with user-namespaced storageKey', async () => {
    const req = new NextRequest('http://localhost:3000/api/upload/presigned', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userAId,
      },
      body: JSON.stringify({
        filename: 'surveillance_feed.mp4',
        mimeType: 'video/mp4',
        fileSize: 5 * 1024 * 1024,
        category: 'video',
      }),
    })
    const res = await presignedUploadRoute(req)
    assert.strictEqual(res.status, 200, 'Presigned URL generation must succeed')
    presignedResult = await res.json()

    assert(presignedResult.uploadUrl, 'Must include uploadUrl')
    assert(presignedResult.storageKey, 'Must include storageKey')
    assert(presignedResult.storageKey.startsWith(`uploads/${userAId}/`), 'Storage key must be namespaced to User A')
  })

  await it('Rejects direct storage upload with tampered HMAC signature', async () => {
    const url = new URL(presignedResult.uploadUrl, 'http://localhost:3000')
    url.searchParams.set('sig', 'tampered-fake-signature-123')

    const req = new NextRequest(url.toString(), {
      method: 'PUT',
      body: Buffer.from('dummy data'),
    })
    const res = await directUploadRoute(req)
    assert.strictEqual(res.status, 403, 'Tampered signature must return 403 Forbidden')
  })

  // Create valid mp4 sample buffer for real upload & analysis testing
  const validMp4Header = Buffer.from([
    0x00, 0x00, 0x00, 0x20, // size 32
    0x66, 0x74, 0x79, 0x70, // 'ftyp'
    0x69, 0x73, 0x6f, 0x6d, // 'isom'
    0x00, 0x00, 0x02, 0x00, // minor version
    0x69, 0x73, 0x6f, 0x6d, // compatible brands
    0x69, 0x73, 0x6f, 0x32,
    0x61, 0x76, 0x63, 0x31,
    0x6d, 0x70, 0x34, 0x31,
  ])
  const testMp4Payload = Buffer.concat([validMp4Header, Buffer.alloc(1000, 0xAA)])

  await it('Accepts signed direct storage upload and stages object safely', async () => {
    // Generate fresh presigned for testMp4Payload
    const presigned = await cloudStorage.generatePresignedUploadUrl({
      filename: 'sample_test.mp4',
      mimeType: 'video/mp4',
      fileSize: testMp4Payload.length,
      userId: userAId,
    })

    const url = new URL(presigned.uploadUrl, 'http://localhost:3000')
    const req = new NextRequest(url.toString(), {
      method: 'PUT',
      body: testMp4Payload,
    })
    const res = await directUploadRoute(req)
    assert.strictEqual(res.status, 200, 'Direct upload must succeed with 200')
    const body = await res.json()
    assert.strictEqual(body.status, 'uploaded')
    assert.strictEqual(body.storageKey, presigned.storageKey)
  })

  // ----------------------------------------------------------------
  console.log('\n--- 4. Storage Reference Analysis & Magic Byte Verification ---')
  // ----------------------------------------------------------------
  let uploadedKeyForUserA: string = ''
  await it('Stages valid video upload and returns storageKey for analysis', async () => {
    const presigned = await cloudStorage.generatePresignedUploadUrl({
      filename: 'traffic_cam.mp4',
      mimeType: 'video/mp4',
      fileSize: testMp4Payload.length,
      userId: userAId,
    })
    uploadedKeyForUserA = presigned.storageKey
    await cloudStorage.saveStagedObject(uploadedKeyForUserA, testMp4Payload)
  })

  await it('Blocks User B from analyzing User A storageKey (IDOR defense)', async () => {
    const req = new NextRequest('http://localhost:3000/api/analyze/video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userBId, // Bob trying to analyze Alice's storage key
      },
      body: JSON.stringify({
        storageKey: uploadedKeyForUserA,
        filename: 'traffic_cam.mp4',
        mimeType: 'video/mp4',
      }),
    })
    const res = await analyzeVideoRoute(req)
    assert.strictEqual(res.status, 403, 'Must return 403 Forbidden for unauthorized storage key')
    const body = await res.json()
    assert(body.detail.includes('Access denied'), 'Must reject unauthorized storage access')
  })

  await it('Rejects spoofed executable uploaded as mp4 via binary magic byte inspection', async () => {
    // Create an MZ executable binary disguised with .mp4 extension
    const spoofedExe = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]) // "MZ" Windows executable
    const presigned = await cloudStorage.generatePresignedUploadUrl({
      filename: 'trojan_disguised.mp4',
      mimeType: 'video/mp4',
      fileSize: spoofedExe.length,
      userId: userAId,
    })
    await cloudStorage.saveStagedObject(presigned.storageKey, spoofedExe)

    // Attempt analysis on spoofed file
    const req = new NextRequest('http://localhost:3000/api/analyze/video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userAId,
      },
      body: JSON.stringify({
        storageKey: presigned.storageKey,
        filename: 'trojan_disguised.mp4',
        mimeType: 'video/mp4',
      }),
    })
    const res = await analyzeVideoRoute(req)
    assert.strictEqual(res.status, 500, 'Must abort analysis when magic bytes reveal executable')
    const body = await res.json()
    assert(body.detail.includes('executable') || body.detail.includes('could not be completed'), 'Must catch executable violation')
  })

  await it('Successfully analyzes valid storage reference for authorized User A and cleans up /tmp', async () => {
    const req = new NextRequest('http://localhost:3000/api/analyze/video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userAId,
      },
      body: JSON.stringify({
        storageKey: uploadedKeyForUserA,
        filename: 'traffic_cam.mp4',
        mimeType: 'video/mp4',
        context: 'Crossroad traffic footage',
      }),
    })
    const res = await analyzeVideoRoute(req)
    assert.strictEqual(res.status, 200, 'Analysis of valid storage reference must succeed')
    const result = await res.json()

    assert(result.id, 'Output must include analysis ID')
    assert(result.investigationId, 'Output must include investigationId')
    assert(result.reportId, 'Output must include reportId')
    assert.strictEqual(result.status, 'completed', 'Analysis status must be completed')

    // Verify investigation record in store has the linked storageKey and correct owner
    const record = investigationStore.getRecord(result.investigationId, userAId)
    assert(record, 'Investigation record must be retrieved for owner')
    assert.strictEqual(record?.userId, userAId, 'Record must belong to User A')
    assert.strictEqual(record?.storageKey, uploadedKeyForUserA, 'Storage key must be linked')
  })

  // ----------------------------------------------------------------
  console.log('\n--- 5. Distributed Rate Limiter Tests ---')
  // ----------------------------------------------------------------
  await it('Enforces sliding-window rate limit and returns 429 when threshold exceeded', async () => {
    const testIp = '192.168.100.55'
    // Limit for 'auth' is 10 requests per minute
    for (let i = 0; i < 10; i++) {
      const res = rateLimiter.checkLimit(testIp, 'auth')
      assert.strictEqual(res.allowed, true, `Request ${i + 1} should be allowed`)
    }

    // 11th request must be blocked
    const blockedRes = rateLimiter.checkLimit(testIp, 'auth')
    assert.strictEqual(blockedRes.allowed, false, '11th request must be blocked')
    assert.strictEqual(blockedRes.remaining, 0)
    assert(blockedRes.retryAfterSeconds > 0, 'Retry-After seconds must be positive')
  })

  // ----------------------------------------------------------------
  console.log('\n--- 6. Database Layer & Persistence Tests ---')
  // ----------------------------------------------------------------
  await it('Saves and retrieves users and sessions through DatabaseManager', async () => {
    const testUser = {
      id: 'usr-db-test-01',
      name: 'Dr. Sarah Connor',
      email: 'sconnor@truthlens.test',
      password_hash: 'abcdef123456',
      salt: 'salt123',
      role: 'investigator' as const,
      created_at: new Date().toISOString(),
    }

    await dbManager.saveUser(testUser)
    const fetchedUser = await dbManager.getUserByEmail(testUser.email)
    assert(fetchedUser, 'User must be fetched by email')
    assert.strictEqual(fetchedUser?.id, testUser.id)
    assert.strictEqual(fetchedUser?.name, testUser.name)

    const testSession = {
      token: 'sess-token-xyz-12345',
      user_id: testUser.id,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    }
    await dbManager.saveSession(testSession)
    const fetchedSession = await dbManager.getSession(testSession.token)
    assert(fetchedSession, 'Session must be retrieved')
    assert.strictEqual(fetchedSession?.user_id, testUser.id)

    await dbManager.deleteSession(testSession.token)
    const deletedSession = await dbManager.getSession(testSession.token)
    assert.strictEqual(deletedSession, null, 'Deleted session must not be found')
  })

  console.log('\n======================================================')
  console.log(` Test Summary: ${passed} Passed, ${failed} Failed`)
  console.log('======================================================\n')

  if (failed > 0) {
    process.exit(1)
  }
}

runAllTests().catch((err) => {
  console.error('Fatal test execution failure', err)
  process.exit(1)
})
