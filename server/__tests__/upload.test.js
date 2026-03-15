import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — declared before any import of the module under test
// ---------------------------------------------------------------------------

// We capture the stitchFiles mock so tests can control it
let stitchFilesImpl = vi.fn()

vi.mock('../services/ffmpegService.js', () => ({
  stitchFiles: (...args) => stitchFilesImpl(...args)
}))

// Mock uuid to produce deterministic job IDs
let uuidCounter = 0
vi.mock('uuid', () => ({
  v4: () => `test-uuid-${++uuidCounter}`
}))

// Mock fs/promises unlink so we don't touch the real filesystem
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    promises: {
      ...actual.promises,
      unlink: vi.fn().mockResolvedValue(undefined)
    }
  }
})

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Directly invoke the route handler by reaching into the router's stack.
 * This avoids needing multer to process real multipart uploads.
 *
 * We build a fake req/res and call the handler manually — but we need the
 * router to be already set up. We use a lightweight express app for integration.
 */

/**
 * Build a minimal fake request for the /stitch route.
 * Files are pre-populated as if multer already ran.
 */
function makeStitchReq ({
  files = { files: [{ path: 'uploads/f1.mp4', mimetype: 'video/mp4', originalname: 'f1.mp4' }] },
  body = {}
} = {}) {
  return { files, body, headers: {} }
}

function makeRes () {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis()
  }
  return res
}

// ---------------------------------------------------------------------------
// We test the router by mounting it in a tiny express app and simulating
// requests at the handler level (bypassing multer which needs real file I/O).
// ---------------------------------------------------------------------------

describe('parseDuration', () => {
  beforeEach(() => {
    vi.resetModules()
    uuidCounter = 0
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns the numeric value when finite and positive', async () => {
    const { parseDuration } = await import('../routes/upload.js')
    expect(parseDuration('5.5', 1)).toBe(5.5)
    expect(parseDuration(3, 1)).toBe(3)
  })

  it('returns fallback when value is not finite', async () => {
    const { parseDuration } = await import('../routes/upload.js')
    expect(parseDuration('abc', 7)).toBe(7)
    expect(parseDuration(NaN, 7)).toBe(7)
    expect(parseDuration(Infinity, 7)).toBe(7)
  })

  it('returns fallback when value is zero or negative', async () => {
    const { parseDuration } = await import('../routes/upload.js')
    expect(parseDuration(0, 2)).toBe(2)
    expect(parseDuration(-1, 2)).toBe(2)
  })

  it('returns fallback when value is undefined', async () => {
    const { parseDuration } = await import('../routes/upload.js')
    expect(parseDuration(undefined, 3)).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Route handler tests — we extract the actual handler functions from the
// router stack and call them directly.
// ---------------------------------------------------------------------------

describe('upload routes', () => {
  // Helper: get the stitch handler (third layer in stack after two upload middleware)
  async function getHandlers () {
    vi.resetModules()
    uuidCounter = 0
    const mod = await import('../routes/upload.js')
    const router = mod.default
    // The stitch route has middleware (multer fields) + async handler
    // Router stack contains route objects
    const stitchRoute = router.stack.find(
      layer => layer.route && layer.route.path === '/stitch'
    )
    const statusRoute = router.stack.find(
      layer => layer.route && layer.route.path === '/status/:jobId'
    )
    // Last handler in stack is the route handler
    const stitchHandlers = stitchRoute.route.stack.map(l => l.handle)
    const statusHandler = statusRoute.route.stack[0].handle
    return { stitchHandlers, statusHandler, jobs: mod.jobs }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    uuidCounter = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 400 when no files are uploaded', async () => {
    const { stitchHandlers, jobs } = await getHandlers()
    const handler = stitchHandlers[stitchHandlers.length - 1]

    const req = makeStitchReq({ files: { files: [] } })
    const res = makeRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'No files uploaded' })
    expect(Object.keys(jobs)).toHaveLength(0)
  })

  it('returns 400 when files key is missing entirely', async () => {
    const { stitchHandlers } = await getHandlers()
    const handler = stitchHandlers[stitchHandlers.length - 1]

    const req = makeStitchReq({ files: {} })
    const res = makeRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'No files uploaded' })
  })

  it('creates a job and responds with jobId on success', async () => {
    stitchFilesImpl = vi.fn().mockResolvedValue('/tmp/out.mp4')
    const { stitchHandlers, jobs } = await getHandlers()
    const handler = stitchHandlers[stitchHandlers.length - 1]

    const req = makeStitchReq()
    const res = makeRes()

    await handler(req, res)

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Processing started' })
    )
    const jobId = res.json.mock.calls[0][0].jobId
    expect(jobId).toBeDefined()
    expect(jobs[jobId]).toBeDefined()
  })

  it('sets job status to completed after stitchFiles resolves', async () => {
    let resolveStitch
    stitchFilesImpl = vi.fn().mockImplementation(
      () => new Promise(resolve => {
        resolveStitch = resolve
      })
    )

    const { stitchHandlers, jobs } = await getHandlers()
    const handler = stitchHandlers[stitchHandlers.length - 1]

    const req = makeStitchReq()
    const res = makeRes()

    await handler(req, res)

    const jobId = res.json.mock.calls[0][0].jobId
    expect(jobs[jobId].status).toBe('processing')

    resolveStitch('/tmp/out.mp4')
    // Wait for microtasks to settle
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(jobs[jobId].status).toBe('completed')
    expect(jobs[jobId].progress).toBe(100)
    expect(jobs[jobId].downloadUrl).toMatch(/\/download\/stitched-.+\.mp4/)
  })

  it('sets job status to failed after stitchFiles rejects', async () => {
    stitchFilesImpl = vi.fn().mockRejectedValue(new Error('ffmpeg failed'))

    const { stitchHandlers, jobs } = await getHandlers()
    const handler = stitchHandlers[stitchHandlers.length - 1]

    const req = makeStitchReq()
    const res = makeRes()

    await handler(req, res)
    const jobId = res.json.mock.calls[0][0].jobId

    await new Promise(resolve => setTimeout(resolve, 10))

    expect(jobs[jobId].status).toBe('failed')
    expect(jobs[jobId].error).toBe('ffmpeg failed')
  })

  it('uses "Unknown error" when rejected error has no message', async () => {
    // Simulate rejection with an object that has no message property
    const errWithNoMessage = {}
    stitchFilesImpl = vi.fn().mockRejectedValue(errWithNoMessage)

    const { stitchHandlers, jobs } = await getHandlers()
    const handler = stitchHandlers[stitchHandlers.length - 1]

    const req = makeStitchReq()
    const res = makeRes()

    await handler(req, res)
    const jobId = res.json.mock.calls[0][0].jobId

    await new Promise(resolve => setTimeout(resolve, 10))

    expect(jobs[jobId].status).toBe('failed')
    expect(jobs[jobId].error).toBe('Unknown error')
  })

  it('parses imageDurations from request body', async () => {
    stitchFilesImpl = vi.fn().mockResolvedValue('/tmp/out.mp4')
    const { stitchHandlers } = await getHandlers()
    const handler = stitchHandlers[stitchHandlers.length - 1]

    const req = makeStitchReq({
      files: {
        files: [
          { path: 'uploads/f1.mp4', mimetype: 'video/mp4', originalname: 'f1.mp4' },
          { path: 'uploads/f2.jpg', mimetype: 'image/jpeg', originalname: 'f2.jpg' }
        ]
      },
      body: {
        imageDurations: JSON.stringify({ 1: 5 }),
        defaultImageDuration: '3'
      }
    })
    const res = makeRes()

    await handler(req, res)

    expect(stitchFilesImpl).toHaveBeenCalled()
    const [filesToProcess] = stitchFilesImpl.mock.calls[0]
    // index 0 has no custom duration → uses default (3)
    expect(filesToProcess[0].duration).toBe(3)
    // index 1 has custom duration 5
    expect(filesToProcess[1].duration).toBe(5)
  })

  it('handles invalid JSON in imageDurations gracefully', async () => {
    stitchFilesImpl = vi.fn().mockResolvedValue('/tmp/out.mp4')
    const { stitchHandlers } = await getHandlers()
    const handler = stitchHandlers[stitchHandlers.length - 1]

    const req = makeStitchReq({
      body: { imageDurations: 'not-valid-json' }
    })
    const res = makeRes()

    // Should not throw — falls back to empty imageDurations
    await handler(req, res)

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Processing started' })
    )
  })

  it('includes bgAudio path in options when bgAudio file is provided', async () => {
    stitchFilesImpl = vi.fn().mockResolvedValue('/tmp/out.mp4')
    const { stitchHandlers } = await getHandlers()
    const handler = stitchHandlers[stitchHandlers.length - 1]

    const req = makeStitchReq({
      files: {
        files: [{ path: 'uploads/f1.mp4', mimetype: 'video/mp4', originalname: 'f1.mp4' }],
        bgAudio: [{ path: 'uploads/bg.mp3' }]
      },
      body: { bgAudioVolume: '0.8' }
    })
    const res = makeRes()

    await handler(req, res)

    expect(stitchFilesImpl).toHaveBeenCalled()
    const [, , options] = stitchFilesImpl.mock.calls[0]
    expect(options.bgAudio).toBe('uploads/bg.mp3')
    expect(options.bgAudioVolume).toBeCloseTo(0.8)
  })

  it('defaults bgAudioVolume to 1.0 when value is out of range', async () => {
    stitchFilesImpl = vi.fn().mockResolvedValue('/tmp/out.mp4')
    const { stitchHandlers } = await getHandlers()
    const handler = stitchHandlers[stitchHandlers.length - 1]

    const req = makeStitchReq({
      body: { bgAudioVolume: '5' } // out of [0, 2] range
    })
    const res = makeRes()

    await handler(req, res)

    const [, , options] = stitchFilesImpl.mock.calls[0]
    expect(options.bgAudioVolume).toBe(1.0)
  })

  it('defaults bgAudioVolume to 1.0 when value is NaN', async () => {
    stitchFilesImpl = vi.fn().mockResolvedValue('/tmp/out.mp4')
    const { stitchHandlers } = await getHandlers()
    const handler = stitchHandlers[stitchHandlers.length - 1]

    const req = makeStitchReq({
      body: { bgAudioVolume: 'not-a-number' }
    })
    const res = makeRes()

    await handler(req, res)

    const [, , options] = stitchFilesImpl.mock.calls[0]
    expect(options.bgAudioVolume).toBe(1.0)
  })

  it('accepts bgAudioVolume = 0 (boundary: minimum)', async () => {
    stitchFilesImpl = vi.fn().mockResolvedValue('/tmp/out.mp4')
    const { stitchHandlers } = await getHandlers()
    const handler = stitchHandlers[stitchHandlers.length - 1]

    const req = makeStitchReq({ body: { bgAudioVolume: '0' } })
    const res = makeRes()

    await handler(req, res)

    const [, , options] = stitchFilesImpl.mock.calls[0]
    expect(options.bgAudioVolume).toBe(0)
  })

  it('accepts bgAudioVolume = 2 (boundary: maximum)', async () => {
    stitchFilesImpl = vi.fn().mockResolvedValue('/tmp/out.mp4')
    const { stitchHandlers } = await getHandlers()
    const handler = stitchHandlers[stitchHandlers.length - 1]

    const req = makeStitchReq({ body: { bgAudioVolume: '2' } })
    const res = makeRes()

    await handler(req, res)

    const [, , options] = stitchFilesImpl.mock.calls[0]
    expect(options.bgAudioVolume).toBe(2)
  })

  it('calls onProgress and updates job progress', async () => {
    let capturedOnProgress = null
    stitchFilesImpl = vi.fn().mockImplementation((_files, _out, opts) => {
      capturedOnProgress = opts.onProgress
      return Promise.resolve('/tmp/out.mp4')
    })

    const { stitchHandlers, jobs } = await getHandlers()
    const handler = stitchHandlers[stitchHandlers.length - 1]

    const req = makeStitchReq()
    const res = makeRes()

    await handler(req, res)
    const jobId = res.json.mock.calls[0][0].jobId

    // Manually call onProgress with a percent value
    if (capturedOnProgress) {
      capturedOnProgress({ percent: 55 })
      expect(jobs[jobId].progress).toBe(55)
    }
  })

  it('onProgress does not update when percent is falsy', async () => {
    let capturedOnProgress = null
    stitchFilesImpl = vi.fn().mockImplementation((_files, _out, opts) => {
      capturedOnProgress = opts.onProgress
      return new Promise((_resolve) => {}) // never resolves
    })

    const { stitchHandlers, jobs } = await getHandlers()
    const handler = stitchHandlers[stitchHandlers.length - 1]

    const req = makeStitchReq()
    const res = makeRes()

    await handler(req, res)
    const jobId = res.json.mock.calls[0][0].jobId

    jobs[jobId].progress = 0
    if (capturedOnProgress) {
      capturedOnProgress({ percent: 0 }) // falsy
      expect(jobs[jobId].progress).toBe(0)
    }
  })

  it('deletes bgAudio file from uploads after completion', async () => {
    const { promises: fsPromises } = await import('fs')

    stitchFilesImpl = vi.fn().mockResolvedValue('/tmp/out.mp4')
    const { stitchHandlers } = await getHandlers()
    const handler = stitchHandlers[stitchHandlers.length - 1]

    const req = makeStitchReq({
      files: {
        files: [{ path: 'uploads/f1.mp4', mimetype: 'video/mp4', originalname: 'f1.mp4' }],
        bgAudio: [{ path: 'uploads/bg.mp3' }]
      }
    })
    const res = makeRes()

    await handler(req, res)
    await new Promise(resolve => setTimeout(resolve, 10))

    const unlinkedPaths = fsPromises.unlink.mock.calls.map(c => c[0])
    expect(unlinkedPaths).toContain('uploads/bg.mp3')
  })

  it('silently swallows unlink errors via .catch(() => {}) after completion', async () => {
    const { promises: fsPromises } = await import('fs')

    // Make unlink reject to trigger the .catch(() => {}) branch
    fsPromises.unlink.mockRejectedValueOnce(new Error('ENOENT: file not found'))

    stitchFilesImpl = vi.fn().mockResolvedValue('/tmp/out.mp4')
    const { stitchHandlers } = await getHandlers()
    const handler = stitchHandlers[stitchHandlers.length - 1]

    const req = makeStitchReq()
    const res = makeRes()

    // Should not throw even when unlink rejects
    await handler(req, res)
    await new Promise(resolve => setTimeout(resolve, 10))

    // Job should still be marked completed despite unlink failure
    const jobId = res.json.mock.calls[0][0].jobId
    const { jobs } = await import('../routes/upload.js')
    expect(jobs[jobId].status).toBe('completed')
  })

  // ---------------------------------------------------------------------------
  // GET /status/:jobId
  // ---------------------------------------------------------------------------
  describe('GET /status/:jobId', () => {
    it('returns 404 when jobId does not exist', async () => {
      const { statusHandler } = await getHandlers()
      const req = { params: { jobId: 'nonexistent-id' } }
      const res = makeRes()

      statusHandler(req, res)

      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({ error: 'Job not found' })
    })

    it('returns job data when jobId exists', async () => {
      stitchFilesImpl = vi.fn().mockImplementation(() => new Promise((_resolve) => {}))
      const { stitchHandlers, statusHandler, jobs } = await getHandlers()
      const handler = stitchHandlers[stitchHandlers.length - 1]

      const req = makeStitchReq()
      const res = makeRes()
      await handler(req, res)

      const jobId = res.json.mock.calls[0][0].jobId

      const statusReq = { params: { jobId } }
      const statusRes = makeRes()
      statusHandler(statusReq, statusRes)

      expect(statusRes.json).toHaveBeenCalledWith(jobs[jobId])
    })
  })
})

// ---------------------------------------------------------------------------
// fileFilter — call the exported function directly
// ---------------------------------------------------------------------------
describe('fileFilter', () => {
  beforeEach(() => {
    vi.resetModules()
    uuidCounter = 0
    vi.clearAllMocks()
  })

  it('calls cb(null, true) for an allowed mimetype', async () => {
    const { fileFilter } = await import('../routes/upload.js')
    const cb = vi.fn()
    fileFilter({}, { mimetype: 'video/mp4' }, cb)
    expect(cb).toHaveBeenCalledWith(null, true)
  })

  it('calls cb with an error for a disallowed mimetype', async () => {
    const { fileFilter } = await import('../routes/upload.js')
    const cb = vi.fn()
    fileFilter({}, { mimetype: 'application/exe' }, cb)
    expect(cb).toHaveBeenCalledWith(expect.any(Error))
    expect(cb.mock.calls[0][0].message).toBe('Unsupported file type: application/exe')
  })

  it('calls cb(null, true) for image/jpeg', async () => {
    const { fileFilter } = await import('../routes/upload.js')
    const cb = vi.fn()
    fileFilter({}, { mimetype: 'image/jpeg' }, cb)
    expect(cb).toHaveBeenCalledWith(null, true)
  })
})

// ---------------------------------------------------------------------------
// multer diskStorage callbacks — call the exported storage object's internals
// ---------------------------------------------------------------------------
describe('multer diskStorage callbacks', () => {
  beforeEach(() => {
    vi.resetModules()
    uuidCounter = 0
    vi.clearAllMocks()
  })

  it('destination callback calls cb with "uploads/"', async () => {
    const { storage } = await import('../routes/upload.js')
    const cb = vi.fn()
    // multer v2 stores the destination function as _getDestination
    storage.getDestination({}, {}, cb)
    expect(cb).toHaveBeenCalledWith(null, 'uploads/')
  })

  it('filename callback calls cb with uuid + extension', async () => {
    const { storage } = await import('../routes/upload.js')
    const cb = vi.fn()
    storage.getFilename({}, { originalname: 'video.mp4' }, cb)
    expect(cb).toHaveBeenCalledOnce()
    const [err, filename] = cb.mock.calls[0]
    expect(err).toBeNull()
    expect(filename).toMatch(/^test-uuid-\d+\.mp4$/)
  })

  it('filename callback preserves the file extension', async () => {
    const { storage } = await import('../routes/upload.js')
    const cb = vi.fn()
    storage.getFilename({}, { originalname: 'photo.JPEG' }, cb)
    const [, filename] = cb.mock.calls[0]
    expect(filename).toMatch(/\.JPEG$/)
  })
})

// ---------------------------------------------------------------------------
// setInterval job eviction — use fake timers
// ---------------------------------------------------------------------------
describe('job eviction via setInterval', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    uuidCounter = 0
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('evicts expired jobs when the interval fires', async () => {
    stitchFilesImpl = vi.fn().mockImplementation(() => new Promise((_resolve) => {}))
    const { jobs } = await import('../routes/upload.js')

    const JOB_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours

    // Manually insert an expired job (createdAt way in the past)
    jobs['expired-job'] = { status: 'completed', progress: 100, createdAt: Date.now() - JOB_TTL_MS - 1 }
    // Insert a fresh job that should NOT be evicted
    jobs['fresh-job'] = { status: 'processing', progress: 0, createdAt: Date.now() }

    expect(jobs['expired-job']).toBeDefined()
    expect(jobs['fresh-job']).toBeDefined()

    // Advance time by JOB_TTL_MS to trigger the setInterval
    vi.advanceTimersByTime(JOB_TTL_MS)

    expect(jobs['expired-job']).toBeUndefined()
    expect(jobs['fresh-job']).toBeDefined()
  })

  it('does not evict jobs that are still fresh', async () => {
    const { jobs } = await import('../routes/upload.js')
    const JOB_TTL_MS = 2 * 60 * 60 * 1000

    jobs['still-fresh'] = { status: 'processing', progress: 0, createdAt: Date.now() }

    // Advance by half the TTL — should NOT evict
    vi.advanceTimersByTime(JOB_TTL_MS / 2)

    expect(jobs['still-fresh']).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// router basic sanity
// ---------------------------------------------------------------------------
describe('router sanity', () => {
  it('the router is an express Router function with a stack', async () => {
    vi.resetModules()
    const mod = await import('../routes/upload.js')
    const router = mod.default
    expect(typeof router).toBe('function')
    expect(router.stack).toBeDefined()
  })
})
