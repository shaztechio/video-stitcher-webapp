/*
 * Copyright 2026 shaztechio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import express from 'express'
import cors from 'cors'
import multer from 'multer'
import uploadRoute from './routes/upload.js'
import path, { dirname } from 'path'
import { fileURLToPath } from 'url'
import fs, { promises as fsPromises } from 'fs'
import logger from './utils/logger.js'
import verifyGoogleToken from './middleware/googleAuth.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Root route for health check
app.get('/', (req, res) => {
  res.send('Video Stitcher API is running')
})

// Serve static files from output directory (for downloading result)
app.use('/download', express.static(path.join(__dirname, 'output')))

// Apply authentication to all /api routes
app.use('/api', verifyGoogleToken)

app.use('/api', uploadRoute)
app.get('/api/config', (req, res) => {
  res.json({ retentionMinutes: Math.round(FILE_AGE_LIMIT / 60000) })
})

// Error handling middleware
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'File too large. Maximum size is 500MB per file.'
      : err.message
    return res.status(400).json({ error: message })
  }
  // File type rejection from fileFilter
  if (err?.message?.startsWith('Unsupported file type')) {
    return res.status(400).json({ error: err.message })
  }
  logger.error(err.stack)
  res.status(500).json({ error: 'Something went wrong!' })
})

// Ensure directories exist
const uploadDir = path.join(__dirname, 'uploads')
const outputDir = path.join(__dirname, 'output')

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir)
}
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir)
}

// Periodic cleanup of output directory
const MIN_RETENTION_MS = 5 * 60 * 1000 // 5 minutes
const DEFAULT_RETENTION_MS = MIN_RETENTION_MS

let fileAgeLimit = DEFAULT_RETENTION_MS
if (process.env.OUTPUT_RETENTION_MINUTES) {
  fileAgeLimit = parseInt(process.env.OUTPUT_RETENTION_MINUTES) * 60 * 1000
}

if (fileAgeLimit < MIN_RETENTION_MS) {
  logger.warn(`Configured retention too short (${fileAgeLimit}ms). Enforcing minimum ${MIN_RETENTION_MS}ms.`)
  fileAgeLimit = MIN_RETENTION_MS
}

const FILE_AGE_LIMIT = fileAgeLimit

// Run cleanup 24 times within the retention period, min 1 minute
const CLEANUP_INTERVAL = Math.max(Math.floor(FILE_AGE_LIMIT / 24), 60 * 1000)

logger.info(`Cleanup policy: Retain files for ${FILE_AGE_LIMIT}ms, scan every ${CLEANUP_INTERVAL}ms`)

setInterval(async () => {
  logger.info('Running cleanup task for output directory...')
  try {
    const files = await fsPromises.readdir(outputDir)
    const now = Date.now()
    await Promise.all(files.map(async (file) => {
      const filePath = path.join(outputDir, file)
      try {
        const stats = await fsPromises.stat(filePath)
        if (now - stats.mtimeMs > FILE_AGE_LIMIT) {
          await fsPromises.unlink(filePath)
          logger.info('Deleted expired file:', filePath)
        }
      } catch (err) {
        // ENOENT means file was already deleted (e.g. by concurrent cleanup), ignore it
        if (err.code !== 'ENOENT') {
          logger.error('Error processing file during cleanup:', file, err)
        }
      }
    }))
  } catch (err) {
    logger.error('Error reading output dir for cleanup:', err)
  }
}, CLEANUP_INTERVAL)

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`)
})

export { app, FILE_AGE_LIMIT, CLEANUP_INTERVAL }
export default app
