import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { NextRequest } from 'next/server'
import { databaseService } from './database'
import { logger } from './logger'

export interface User {
  id: string
  name: string
  email: string
  passwordHash: string
  salt: string
  role: 'lead_analyst' | 'analyst' | 'investigator'
  createdAt: string
}

export interface UserSession {
  token: string
  userId: string
  createdAt: string
  expiresAt: string
}

export interface SafeUser {
  id: string
  name: string
  email: string
  role: 'lead_analyst' | 'analyst' | 'investigator'
  createdAt: string
}

const TEMP_DATA_DIR = path.join(os.tmpdir(), 'truthlens-forensics', 'data')
const TEMP_USERS_FILE = path.join(TEMP_DATA_DIR, 'users_db.json')
const TEMP_SESSIONS_FILE = path.join(TEMP_DATA_DIR, 'sessions_db.json')
const LEGACY_USERS_FILE = path.join(process.cwd(), 'data', 'users_db.json')
const LEGACY_SESSIONS_FILE = path.join(process.cwd(), 'data', 'sessions_db.json')

import { GUEST_COOKIE_NAME, AUTH_COOKIE_NAME, GUEST_COOKIE_MAX_AGE } from './auth-constants'
export { GUEST_COOKIE_NAME, AUTH_COOKIE_NAME, GUEST_COOKIE_MAX_AGE }

export interface AuthContext {
  user: SafeUser | null
  effectiveUserId: string
  isGuest: boolean
  guestSessionId?: string
  isNewGuest: boolean
}

class AuthService {
  private users: Map<string, User> = new Map()
  private sessions: Map<string, UserSession> = new Map()

  constructor() {
    this.ensureDataDir()
    this.loadUsers()
    this.loadSessions()
    this.seedDefaultUser()
  }

  private ensureDataDir() {
    try {
      if (!fs.existsSync(TEMP_DATA_DIR)) {
        fs.mkdirSync(TEMP_DATA_DIR, { recursive: true })
      }
    } catch {
      // In-memory fallback
    }
  }

  private loadUsers() {
    let loaded = false
    try {
      if (fs.existsSync(TEMP_USERS_FILE)) {
        const raw = fs.readFileSync(TEMP_USERS_FILE, 'utf-8')
        const list: User[] = JSON.parse(raw)
        for (const u of list) this.users.set(u.id, u)
        loaded = true
      }
    } catch {
      // Continue
    }

    if (!loaded) {
      try {
        if (fs.existsSync(LEGACY_USERS_FILE)) {
          const raw = fs.readFileSync(LEGACY_USERS_FILE, 'utf-8')
          const list: User[] = JSON.parse(raw)
          for (const u of list) this.users.set(u.id, u)
        }
      } catch {
        // In-memory fallback
      }
    }
  }

  private saveUsers() {
    try {
      this.ensureDataDir()
      const list = Array.from(this.users.values())
      fs.writeFileSync(TEMP_USERS_FILE, JSON.stringify(list, null, 2), 'utf-8')

      try {
        const legacyDir = path.join(process.cwd(), 'data')
        if (fs.existsSync(legacyDir)) {
          fs.writeFileSync(LEGACY_USERS_FILE, JSON.stringify(list, null, 2), 'utf-8')
        }
      } catch {
        // Read-only serverless filesystem expected
      }
    } catch {
      // In-memory fallback
    }
  }

  private loadSessions() {
    let loaded = false
    try {
      if (fs.existsSync(TEMP_SESSIONS_FILE)) {
        const raw = fs.readFileSync(TEMP_SESSIONS_FILE, 'utf-8')
        const list: UserSession[] = JSON.parse(raw)
        const now = Date.now()
        for (const s of list) {
          if (new Date(s.expiresAt).getTime() > now) {
            this.sessions.set(s.token, s)
          }
        }
        loaded = true
      }
    } catch {
      // Continue
    }

    if (!loaded) {
      try {
        if (fs.existsSync(LEGACY_SESSIONS_FILE)) {
          const raw = fs.readFileSync(LEGACY_SESSIONS_FILE, 'utf-8')
          const list: UserSession[] = JSON.parse(raw)
          const now = Date.now()
          for (const s of list) {
            if (new Date(s.expiresAt).getTime() > now) {
              this.sessions.set(s.token, s)
            }
          }
        }
      } catch {
        // In-memory fallback
      }
    }
  }

  private saveSessions() {
    try {
      this.ensureDataDir()
      const list = Array.from(this.sessions.values())
      fs.writeFileSync(TEMP_SESSIONS_FILE, JSON.stringify(list, null, 2), 'utf-8')

      try {
        const legacyDir = path.join(process.cwd(), 'data')
        if (fs.existsSync(legacyDir)) {
          fs.writeFileSync(LEGACY_SESSIONS_FILE, JSON.stringify(list, null, 2), 'utf-8')
        }
      } catch {
        // Read-only serverless filesystem expected
      }
    } catch {
      // In-memory fallback
    }
  }

  private hashPassword(password: string, salt: string): string {
    return crypto.scryptSync(password, salt, 64).toString('hex')
  }

  private seedDefaultUser() {
    const defaultEmail = 'analyst@truthlens.ai'
    const exists = Array.from(this.users.values()).some((u) => u.email.toLowerCase() === defaultEmail)
    if (!exists) {
      const salt = crypto.randomBytes(16).toString('hex')
      const passwordHash = this.hashPassword('TruthLens2026!', salt)
      const defaultUser: User = {
        id: 'usr-lead-analyst',
        name: 'Lead Forensic Analyst',
        email: defaultEmail,
        passwordHash,
        salt,
        role: 'lead_analyst',
        createdAt: new Date().toISOString(),
      }
      this.users.set(defaultUser.id, defaultUser)
      this.saveUsers()
      databaseService.createUser(defaultUser).catch(() => {})
    }
  }

  registerUser(name: string, email: string, password: string): { user: SafeUser; token: string } {
    const cleanEmail = email.trim().toLowerCase()
    const cleanName = name.trim()

    if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      throw new Error('Please provide a valid email address.')
    }
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters long.')
    }
    if (!cleanName) {
      throw new Error('Please provide your full name.')
    }

    const emailTaken = Array.from(this.users.values()).some((u) => u.email.toLowerCase() === cleanEmail)
    if (emailTaken) {
      throw new Error('An account with this email address already exists. Please sign in instead.')
    }

    const salt = crypto.randomBytes(16).toString('hex')
    const passwordHash = this.hashPassword(password, salt)
    const id = `usr-${crypto.randomBytes(6).toString('hex')}`

    const user: User = {
      id,
      name: cleanName,
      email: cleanEmail,
      passwordHash,
      salt,
      role: 'investigator',
      createdAt: new Date().toISOString(),
    }

    this.users.set(id, user)
    this.saveUsers()
    databaseService.createUser(user).catch((err) => {
      logger.warn('Failed to asynchronously persist user to database', err)
    })

    const token = this.createSession(id)
    return {
      user: this.toSafeUser(user),
      token,
    }
  }

  async registerUserAsync(name: string, email: string, password: string): Promise<{ user: SafeUser; token: string }> {
    const cleanEmail = email.trim().toLowerCase()
    const existingDbUser = await databaseService.findUserByEmail(cleanEmail)
    if (existingDbUser) {
      throw new Error('An account with this email address already exists. Please sign in instead.')
    }

    const result = this.registerUser(name, email, password)
    const fullUser = this.users.get(result.user.id)
    if (fullUser) {
      const persisted = await databaseService.createUser(fullUser)
      if (!persisted && process.env.NODE_ENV === 'production' && process.env.ALLOW_LOCAL_PERSISTENCE_FALLBACK !== 'true') {
        this.users.delete(result.user.id)
        this.sessions.delete(result.token)
        throw new Error('Database service unavailable: failed to permanently store user account in production.')
      }
    }
    return result
  }

  loginUser(email: string, password: string): { user: SafeUser; token: string } {
    const cleanEmail = email.trim().toLowerCase()
    const user = Array.from(this.users.values()).find((u) => u.email.toLowerCase() === cleanEmail)

    if (!user) {
      throw new Error('No account found with this email. Please check your email or register.')
    }

    const calculatedHash = this.hashPassword(password, user.salt)
    if (calculatedHash !== user.passwordHash) {
      throw new Error('Incorrect password. Please verify and try again.')
    }

    const token = this.createSession(user.id)
    return {
      user: this.toSafeUser(user),
      token,
    }
  }

  async loginUserAsync(email: string, password: string): Promise<{ user: SafeUser; token: string }> {
    const cleanEmail = email.trim().toLowerCase()
    let user = Array.from(this.users.values()).find((u) => u.email.toLowerCase() === cleanEmail)

    if (!user) {
      const dbUser = await databaseService.findUserByEmail(cleanEmail)
      if (dbUser) {
        user = dbUser
        this.users.set(user.id, user)
      }
    }

    if (!user) {
      throw new Error('No account found with this email. Please check your email or register.')
    }

    const calculatedHash = this.hashPassword(password, user.salt)
    if (calculatedHash !== user.passwordHash) {
      throw new Error('Incorrect password. Please verify and try again.')
    }

    const token = await this.createSessionAsync(user.id)
    return {
      user: this.toSafeUser(user),
      token,
    }
  }

  createSession(userId: string): string {
    const token = crypto.randomBytes(32).toString('hex')
    const createdAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days

    const session: UserSession = {
      token,
      userId,
      createdAt,
      expiresAt,
    }

    this.sessions.set(token, session)
    this.saveSessions()
    databaseService.createSession(session).catch((err) => {
      logger.warn('Failed to asynchronously persist session to database', err)
    })

    return token
  }

  async createSessionAsync(userId: string): Promise<string> {
    const token = this.createSession(userId)
    const session = this.sessions.get(token)
    if (session) {
      const persisted = await databaseService.createSession(session)
      if (!persisted && process.env.NODE_ENV === 'production' && process.env.ALLOW_LOCAL_PERSISTENCE_FALLBACK !== 'true') {
        this.sessions.delete(token)
        throw new Error('Database service unavailable: failed to permanently store session in production.')
      }
    }
    return token
  }

  getUserFromSession(token: string): SafeUser | null {
    if (!token) return null
    const session = this.sessions.get(token)
    if (!session) return null

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      this.sessions.delete(token)
      this.saveSessions()
      databaseService.deleteSession(token).catch(() => {})
      return null
    }

    const user = this.users.get(session.userId)
    if (!user) return null
    return this.toSafeUser(user)
  }

  async getUserFromSessionAsync(token: string): Promise<SafeUser | null> {
    const local = this.getUserFromSession(token)
    if (local) return local

    const dbSession = await databaseService.findSession(token)
    if (!dbSession) return null

    let user = this.users.get(dbSession.userId)
    if (!user) {
      const dbUser = await databaseService.findUserById(dbSession.userId)
      if (dbUser) {
        user = dbUser
        this.users.set(user.id, user)
      }
    }

    if (!user) return null
    this.sessions.set(token, dbSession)
    return this.toSafeUser(user)
  }

  deleteSession(token: string) {
    if (this.sessions.has(token)) {
      this.sessions.delete(token)
      this.saveSessions()
      databaseService.deleteSession(token).catch(() => {})
    }
  }

  getUserById(id: string): SafeUser | null {
    const user = this.users.get(id)
    return user ? this.toSafeUser(user) : null
  }

  toSafeUser(user: User): SafeUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    }
  }

  /**
   * Resolves authentication context from request:
   * 1. Checks `tl_session` cookie
   * 2. Checks `Authorization: Bearer <token>`
   * 3. Checks `x-user-id` header
   * 4. Checks or creates guest session ID for unauthenticated isolation
   */
  getAuthContext(req: NextRequest): AuthContext {
    // 1. Session token
    const cookieToken = req.cookies.get(AUTH_COOKIE_NAME)?.value
    let token = cookieToken

    if (!token) {
      const authHeader = req.headers.get('authorization')
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7).trim()
      }
    }

    if (token) {
      const user = this.getUserFromSession(token)
      if (user) {
        return {
          user,
          effectiveUserId: user.id,
          isGuest: false,
          isNewGuest: false,
        }
      }
    }

    // 2. Direct Header override (for automated tests or internal API calls)
    const headerUserId = req.headers.get('x-user-id')
    if (headerUserId && /^[a-zA-Z0-9_-]{3,64}$/.test(headerUserId)) {
      const user = this.getUserById(headerUserId)
      return {
        user,
        effectiveUserId: headerUserId,
        isGuest: !user,
        isNewGuest: false,
      }
    }

    // 3. Guest session isolation
    const guestCookie = req.cookies.get(GUEST_COOKIE_NAME)?.value
    if (guestCookie && /^[a-zA-Z0-9_-]{8,64}$/.test(guestCookie)) {
      return {
        user: null,
        effectiveUserId: `guest-${guestCookie}`,
        isGuest: true,
        guestSessionId: guestCookie,
        isNewGuest: false,
      }
    }

    // New unique cryptographically secure guest ID (32 hex characters)
    const newGuestId = crypto.randomBytes(16).toString('hex')
    return {
      user: null,
      effectiveUserId: `guest-${newGuestId}`,
      isGuest: true,
      guestSessionId: newGuestId,
      isNewGuest: true,
    }
  }

  async getAuthContextAsync(req: NextRequest): Promise<AuthContext> {
    const cookieToken = req.cookies.get(AUTH_COOKIE_NAME)?.value
    let token = cookieToken

    if (!token) {
      const authHeader = req.headers.get('authorization')
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7).trim()
      }
    }

    if (token) {
      const user = await this.getUserFromSessionAsync(token)
      if (user) {
        return {
          user,
          effectiveUserId: user.id,
          isGuest: false,
          isNewGuest: false,
        }
      }
    }

    return this.getAuthContext(req)
  }

  /**
   * Ensures the persistent HTTP-only secure guest cookie is attached to a response.
   */
  attachGuestCookie<T extends { cookies: { set: (...args: any[]) => any } }>(
    response: T,
    authContextOrGuestId?: AuthContext | string | null
  ): T {
    let guestId: string | undefined
    if (typeof authContextOrGuestId === 'string') {
      guestId = authContextOrGuestId
    } else if (authContextOrGuestId && typeof authContextOrGuestId === 'object') {
      if (authContextOrGuestId.isGuest && authContextOrGuestId.guestSessionId) {
        guestId = authContextOrGuestId.guestSessionId
      }
    }

    if (!guestId) return response

    response.cookies.set(GUEST_COOKIE_NAME, guestId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: GUEST_COOKIE_MAX_AGE,
    })

    return response
  }
}

// Singleton instance
export const authService = new AuthService()
