import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'

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

const DATA_DIR = path.join(process.cwd(), 'data')
const USERS_FILE = path.join(DATA_DIR, 'users_db.json')
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions_db.json')

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
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true })
      }
    } catch {
      // Ignore if dir cannot be created synchronously in serverless
    }
  }

  private loadUsers() {
    try {
      if (fs.existsSync(USERS_FILE)) {
        const raw = fs.readFileSync(USERS_FILE, 'utf-8')
        const list: User[] = JSON.parse(raw)
        for (const u of list) {
          this.users.set(u.id, u)
        }
      }
    } catch {
      // In-memory fallback
    }
  }

  private saveUsers() {
    try {
      this.ensureDataDir()
      const list = Array.from(this.users.values())
      fs.writeFileSync(USERS_FILE, JSON.stringify(list, null, 2), 'utf-8')
    } catch {
      // In-memory fallback
    }
  }

  private loadSessions() {
    try {
      if (fs.existsSync(SESSIONS_FILE)) {
        const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8')
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

  private saveSessions() {
    try {
      this.ensureDataDir()
      const list = Array.from(this.sessions.values())
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(list, null, 2), 'utf-8')
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

    const token = this.createSession(id)
    return {
      user: this.toSafeUser(user),
      token,
    }
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
    return token
  }

  getUserFromSession(token: string): SafeUser | null {
    if (!token) return null
    const session = this.sessions.get(token)
    if (!session) return null

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      this.sessions.delete(token)
      this.saveSessions()
      return null
    }

    const user = this.users.get(session.userId)
    if (!user) return null
    return this.toSafeUser(user)
  }

  deleteSession(token: string) {
    if (this.sessions.has(token)) {
      this.sessions.delete(token)
      this.saveSessions()
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
  getAuthContext(req: NextRequest): {
    user: SafeUser | null
    effectiveUserId: string
    isGuest: boolean
    guestSessionId?: string
  } {
    // 1. Session token
    const cookieToken = req.cookies.get('tl_session')?.value
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
      }
    }

    // 3. Guest session isolation
    const guestCookie = req.cookies.get('tl_session_id')?.value
    if (guestCookie && /^[a-zA-Z0-9_-]{8,64}$/.test(guestCookie)) {
      return {
        user: null,
        effectiveUserId: `guest-${guestCookie}`,
        isGuest: true,
        guestSessionId: guestCookie,
      }
    }

    // New unique guest ID
    const newGuestId = crypto.randomBytes(16).toString('hex')
    return {
      user: null,
      effectiveUserId: `guest-${newGuestId}`,
      isGuest: true,
      guestSessionId: newGuestId,
    }
  }
}

// Global singleton instance
const globalAuthKey = Symbol.for('truthlens.authService')
const globalObj = globalThis as unknown as { [key: symbol]: AuthService }

if (!globalObj[globalAuthKey]) {
  globalObj[globalAuthKey] = new AuthService()
}

export const authService = globalObj[globalAuthKey]
