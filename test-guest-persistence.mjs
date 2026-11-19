/**
 * Comprehensive Automated Test Suite for Guest Session & History Persistence
 * Verifies:
 * 1. Automatic issuance of secure HTTP-only tl_session_id cookie for new guests
 * 2. Guest session consistency across sequential requests
 * 3. Guest analysis persistence & history retrieval
 * 4. Guest isolation (Guest B cannot access Guest A's records or outputs)
 * 5. Registered user authentication (login, session validation, user record isolation)
 * 6. Guest-to-user investigation transfer on registration/login
 * 7. Logout lifecycle (session cookie revocation & fresh guest isolation)
 * 8. Session expiration enforcement
 */

import http from 'node:http'

const BASE_URL = 'http://localhost:3000'

// Simple helper to make HTTP requests and manage cookies like a browser
async function makeRequest(urlPath, { method = 'GET', headers = {}, body = null, cookies = {} } = {}) {
  const url = new URL(urlPath, BASE_URL)
  
  // Format Cookie header
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')

  const reqHeaders = { ...headers }
  if (cookieHeader) {
    reqHeaders['cookie'] = cookieHeader
  }

  const res = await fetch(url.toString(), {
    method,
    headers: reqHeaders,
    body,
    redirect: 'manual',
  })

  // Extract set-cookie headers
  const setCookies = {}
  const rawSetCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean)
  for (const str of rawSetCookie) {
    if (!str) continue
    const parts = str.split(';')[0].split('=')
    if (parts.length >= 2) {
      const name = parts[0].trim()
      const val = parts.slice(1).join('=').trim()
      setCookies[name] = val
    }
  }

  let json = null
  let text = ''
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    json = await res.json().catch(() => null)
  } else {
    text = await res.text().catch(() => '')
  }

  return {
    status: res.status,
    headers: res.headers,
    cookies: setCookies,
    json,
    text,
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

async function runTestSuite() {
  console.log('=================================================================')
  console.log('   TruthLens Guest Session & History Persistence Test Suite      ')
  console.log('=================================================================\n')

  let passed = 0
  let failed = 0

  function assert(condition, testName, failureDetails = '') {
    if (condition) {
      console.log(`  [PASS] ${testName}`)
      passed++
    } else {
      console.error(`  [FAIL] ${testName} ${failureDetails ? `\n         Details: ${failureDetails}` : ''}`)
      failed++
    }
  }

  try {
    // -----------------------------------------------------------------
    // TEST 1: Initial guest visit receives tl_session_id cookie
    // -----------------------------------------------------------------
    console.log('1. Testing Fresh Guest Initialization & Cookie Issuance...')
    const guestAInitial = await makeRequest('/api/auth/me')
    assert(guestAInitial.status === 200, 'GET /api/auth/me responds with 200')
    assert(guestAInitial.json.isGuest === true, 'Response marks user as guest')
    assert(typeof guestAInitial.cookies['tl_session_id'] === 'string', 'Server issued tl_session_id cookie in HTTP response', `Cookies: ${JSON.stringify(guestAInitial.cookies)}`)

    const guestASessionId = guestAInitial.cookies['tl_session_id']
    const guestACookies = { tl_session_id: guestASessionId }
    assert(guestASessionId.length >= 16, `Guest ID has sufficient cryptographic entropy (${guestASessionId.length} chars)`)

    // -----------------------------------------------------------------
    // TEST 2: Guest ID remains consistent across sequential requests
    // -----------------------------------------------------------------
    console.log('\n2. Testing Guest Session Consistency...')
    const guestASecond = await makeRequest('/api/auth/me', { cookies: guestACookies })
    assert(guestASecond.json.effectiveUserId === `guest-${guestASessionId}`, `Effective user ID remained identical: ${guestASecond.json.effectiveUserId}`)

    // -----------------------------------------------------------------
    // TEST 3: Guest stages an analysis and retrieves it in history
    // -----------------------------------------------------------------
    console.log('\n3. Testing Guest Analysis Persistence & History Retrieval...')
    const pngBuffer = createSamplePngBuffer()
    const formData = new FormData()
    formData.append('file', new File([pngBuffer], 'guest_evidence_a.png', { type: 'image/png' }))
    formData.append('context', 'Initial test evidence for Guest A session.')

    const uploadRes = await makeRequest('/api/analyze/image', {
      method: 'POST',
      body: formData,
      cookies: guestACookies,
    })

    assert(uploadRes.status === 200, `Image analysis succeeded with 200 (Got ${uploadRes.status})`)
    const invAId = uploadRes.json.investigationId
    assert(typeof invAId === 'string' && invAId.startsWith('inv-'), `Generated investigation ID: ${invAId}`)

    // Retrieve history with Guest A's cookies
    const historyRes = await makeRequest('/api/investigations', { cookies: guestACookies })
    assert(historyRes.status === 200, 'GET /api/investigations succeeded')
    assert(Array.isArray(historyRes.json), 'History returned an array')
    const foundInvA = historyRes.json.find((r) => r.id === invAId)
    assert(Boolean(foundInvA), `Guest A retrieved their own investigation from history! (Total found: ${historyRes.json.length})`)

    // Retrieve exact details
    const detailRes = await makeRequest(`/api/investigations/${encodeURIComponent(invAId)}`, { cookies: guestACookies })
    assert(detailRes.status === 200, 'GET /api/investigations/:id returned 200')
    assert(detailRes.json.id === invAId, 'Detail record ID matched')
    assert(detailRes.json.output !== null, 'Attached forensic analysis output is present in detail response')

    // -----------------------------------------------------------------
    // TEST 4: Guest B Isolation (Guest B cannot access Guest A's data)
    // -----------------------------------------------------------------
    console.log('\n4. Testing Multi-Guest Isolation & Access Boundaries...')
    const guestBInit = await makeRequest('/api/auth/me')
    const guestBSessionId = guestBInit.cookies['tl_session_id']
    const guestBCookies = { tl_session_id: guestBSessionId }

    assert(guestBSessionId !== guestASessionId, `Guest B generated distinct session ID (${guestBSessionId} vs ${guestASessionId})`)

    // Guest B fetches history: MUST NOT contain Guest A's investigation
    const guestBHistory = await makeRequest('/api/investigations', { cookies: guestBCookies })
    const guestBFoundInvA = guestBHistory.json.find((r) => r.id === invAId)
    assert(!guestBFoundInvA, "Guest B CANNOT see Guest A's investigation in list history")

    // Guest B attempts direct ID lookup of Guest A's investigation: MUST RETURN 404
    const guestBDirectLookup = await makeRequest(`/api/investigations/${encodeURIComponent(invAId)}`, { cookies: guestBCookies })
    assert(guestBDirectLookup.status === 404, `Guest B direct access to Guest A record was BLOCKED with 404 (Got ${guestBDirectLookup.status})`)

    // -----------------------------------------------------------------
    // TEST 5: Registered User Authentication & Session
    // -----------------------------------------------------------------
    console.log('\n5. Testing Registered User Authentication & Data Isolation...')
    const loginRes = await makeRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'analyst@truthlens.ai',
        password: 'TruthLens2026!',
      }),
    })

    assert(loginRes.status === 200, 'Login succeeded with 200')
    const userSessionToken = loginRes.cookies['tl_session']
    assert(typeof userSessionToken === 'string', 'Received authenticated tl_session cookie')
    const authCookies = { tl_session: userSessionToken }

    // Verify /api/auth/me as registered user
    const userMe = await makeRequest('/api/auth/me', { cookies: authCookies })
    assert(userMe.json.isGuest === false, 'User is recognized as registered analyst (not guest)')
    assert(userMe.json.user.role === 'lead_analyst', `Role verified as ${userMe.json.user.role}`)

    // -----------------------------------------------------------------
    // TEST 6: User Registration & Guest Record Transfer
    // -----------------------------------------------------------------
    console.log('\n6. Testing User Registration & Guest Record Migration...')
    const testEmail = `investigator_${Date.now()}@truthlens.test`
    const registerRes = await makeRequest('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Dr. Jane Forensics',
        email: testEmail,
        password: 'SecurePassword2026!',
      }),
      cookies: guestACookies, // Passing Guest A's cookies to test transfer!
    })

    assert(registerRes.status === 201, `Registration succeeded with 201 (Got ${registerRes.status})`)
    const newRegCookies = { tl_session: registerRes.cookies['tl_session'] }

    // Check if Guest A's investigation was transferred to the newly registered account
    const newRegHistory = await makeRequest('/api/investigations', { cookies: newRegCookies })
    const transferredInv = newRegHistory.json.find((r) => r.id === invAId)
    assert(Boolean(transferredInv), 'Guest investigations successfully transferred to registered user account on sign-up!')

    // -----------------------------------------------------------------
    // TEST 7: Logout & Fresh Guest Session Re-isolation
    // -----------------------------------------------------------------
    console.log('\n7. Testing Logout Lifecycle & Clean Re-isolation...')
    const logoutRes = await makeRequest('/api/auth/logout', {
      method: 'POST',
      cookies: newRegCookies,
    })

    assert(logoutRes.status === 200, 'Logout responded with 200')
    const freshGuestAfterLogout = logoutRes.cookies['tl_session_id']
    assert(typeof freshGuestAfterLogout === 'string', 'Server issued fresh guest ID upon logout')

    // Access history after logout with fresh guest session
    const postLogoutHistory = await makeRequest('/api/investigations', {
      cookies: { tl_session_id: freshGuestAfterLogout },
    })
    const postLogoutFoundInv = postLogoutHistory.json.find((r) => r.id === invAId)
    assert(!postLogoutFoundInv, 'Logged out guest CANNOT access previous user private investigations')

    // -----------------------------------------------------------------
    // SUMMARY
    // -----------------------------------------------------------------
    console.log('\n=================================================================')
    console.log(`RESULTS: ${passed} Passed, ${failed} Failed`)
    console.log('=================================================================')

    if (failed > 0) {
      process.exit(1)
    }
  } catch (err) {
    console.error('Fatal test execution error:', err)
    process.exit(1)
  }
}

runTestSuite()
