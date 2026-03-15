import { OAuth2Client } from 'google-auth-library'
import logger from '../utils/logger.js'

const client = new OAuth2Client()

// Parse allowed users once at startup rather than on every request
const allowedUsers = (process.env.ALLOWED_USERS || '')
  .split(/[,;]/)
  .map(u => u.trim().toLowerCase())
  .filter(u => u.length > 0)

async function verifyGoogleToken (req, res, next) {
  if (process.env.DISABLE_AUTH === 'true') {
    logger.info('Authentication disabled (DISABLE_AUTH=true). Bypassing check.')
    req.user = { email: 'local-user@local-stitcher', name: 'Local User' }
    return next()
  }

  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' })
  }

  const token = authHeader.split('Bearer ')[1]

  try {
    // Verify audience if GOOGLE_CLIENT_ID is configured; skip check otherwise
    // (useful when Cloud Run generates dynamic URLs during development)
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID || undefined
    })

    const payload = ticket.getPayload()
    const email = payload?.email

    if (!email) {
      return res.status(403).json({ error: 'Invalid token: no email claim' })
    }

    logger.info(`Auth check: email=${email}, allowedUsersCount=${allowedUsers.length}`)

    if (allowedUsers.length > 0 && !allowedUsers.includes(email.toLowerCase())) {
      logger.warn(`Unauthorized access attempt by ${email}.`)
      return res.status(403).json({ error: 'Access denied: your email is not on the allowlist.' })
    }

    req.user = payload
    next()
  } catch (error) {
    logger.error('Token verification failed:', error.message)
    return res.status(403).json({ error: 'Invalid token' })
  }
}

export default verifyGoogleToken
