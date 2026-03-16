// Copyright 2026 shaztechio
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import express from 'express'
import multer from 'multer'
import path, { dirname } from 'path'
import { fileURLToPath } from 'url'
import { promises as fsPromises } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import logger from '../utils/logger.js'
import { stitchFiles } from '../services/ffmpegService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const router = express.Router()

const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500MB per file
const MAX_FILES = 50
const JOB_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours

const ALLOWED_MIMETYPES = new Set([
  'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska',
  'video/webm', 'video/mpeg', 'video/ogg', 'video/3gpp',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav',
  'audio/x-wav', 'audio/aac', 'audio/flac', 'audio/webm'
])

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname)
    cb(null, `${uuidv4()}${ext}`)
  }
})

function fileFilter (req, file, cb) {
  if (ALLOWED_MIMETYPES.has(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}`))
  }
}

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter
})

// Store active jobs (in-memory)
const jobs = {}

// Periodically evict expired jobs to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now()
  for (const [jobId, job] of Object.entries(jobs)) {
    if (now - job.createdAt > JOB_TTL_MS) {
      delete jobs[jobId]
      logger.info(`Evicted expired job ${jobId}`)
    }
  }
}, JOB_TTL_MS)

function parseDuration (value, fallback) {
  const n = parseFloat(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

router.post('/stitch', upload.fields([
  { name: 'files', maxCount: MAX_FILES },
  { name: 'bgAudio', maxCount: 1 }
]), async (req, res) => {
  const mediaFiles = (req.files.files || [])
  if (mediaFiles.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' })
  }

  const jobId = uuidv4()
  const outputFilename = `stitched-${jobId}.mp4`
  const outputPath = path.join(__dirname, '../output', outputFilename)

  let imageDurations = {}
  try {
    if (req.body.imageDurations) {
      imageDurations = JSON.parse(req.body.imageDurations)
    }
  } catch (e) {
    logger.error('Error parsing image durations', e)
  }

  const defaultDuration = parseDuration(req.body.defaultImageDuration, 1)
  const filesToProcess = mediaFiles.map((f, index) => ({
    path: f.path,
    mimetype: f.mimetype,
    duration: imageDurations[index] !== undefined
      ? parseDuration(imageDurations[index], defaultDuration)
      : defaultDuration
  }))

  const bgAudioFile = (req.files.bgAudio || [])[0] || null
  const bgAudioPath = bgAudioFile ? bgAudioFile.path : null
  const rawVolume = parseFloat(req.body.bgAudioVolume)
  const bgAudioVolume = Number.isFinite(rawVolume) && rawVolume >= 0 && rawVolume <= 2
    ? rawVolume
    : 1.0

  jobs[jobId] = { status: 'processing', progress: 0, createdAt: Date.now() }

  stitchFiles(filesToProcess, outputPath, {
    jobId,
    imageDuration: defaultDuration,
    bgAudio: bgAudioPath,
    bgAudioVolume,
    onProgress: (progress) => {
      if (progress.percent) {
        jobs[jobId].progress = Math.round(progress.percent)
      }
    }
  })
    .then(() => {
      jobs[jobId].status = 'completed'
      jobs[jobId].progress = 100
      jobs[jobId].downloadUrl = `/download/${outputFilename}`

      const filesToDelete = filesToProcess.map(f => f.path)
      if (bgAudioPath) {
        filesToDelete.push(bgAudioPath)
      }
      Promise.all(filesToDelete.map(f => fsPromises.unlink(f).catch(() => {})))
        .then(() => logger.info(`Cleaned up uploads for job ${jobId}`))
    })
    .catch(err => {
      logger.error('Stitching failed', err)
      jobs[jobId].status = 'failed'
      jobs[jobId].error = err.message ?? 'Unknown error'
    })

  res.json({ jobId, message: 'Processing started' })
})

router.get('/status/:jobId', (req, res) => {
  const { jobId } = req.params
  const job = jobs[jobId]

  if (!job) {
    return res.status(404).json({ error: 'Job not found' })
  }

  res.json(job)
})

export { jobs, parseDuration, fileFilter, storage }
export default router
