import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// fluent-ffmpeg mock factory
// ---------------------------------------------------------------------------
// We need full control over the command builder chain and event emission.
// The mock is created fresh per test via a factory so state never leaks.

let ffprobeImpl = null
let commandImpl = null

vi.mock('fluent-ffmpeg', () => {
  // The default export is the ffmpeg() constructor AND carries static methods.
  const ffmpegMock = vi.fn(() => commandImpl())
  ffmpegMock.ffprobe = vi.fn((filePath, cb) => ffprobeImpl(filePath, cb))
  return { default: ffmpegMock }
})

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a chainable ffmpeg command mock that emits events when .save() is called.
 * `events` is an array like:
 *   [{ name: 'end' }]
 *   [{ name: 'error', args: [new Error('oops')] }]
 *   [{ name: 'start', args: ['ffmpeg -i ...'] }, { name: 'progress', args: [{ percent: 50 }] }, { name: 'end' }]
 *
 * `onComplexFilter` is an optional callback receiving the filterComplex array for inspection.
 */
function buildCommandMock (events, { onComplexFilter } = {}) {
  const handlers = {}
  const cmd = {
    input: vi.fn().mockReturnThis(),
    inputOptions: vi.fn().mockReturnThis(),
    complexFilter: vi.fn((fc) => {
      if (onComplexFilter) {
        onComplexFilter(fc)
      }
      return cmd
    }),
    outputOptions: vi.fn().mockReturnThis(),
    on: vi.fn((event, handler) => {
      handlers[event] = handler
      return cmd
    }),
    save: vi.fn(() => {
      // Emit events asynchronously in order via microtasks
      let chain = Promise.resolve()
      for (const evt of events) {
        const args = evt.args || []
        chain = chain.then(() => {
          if (handlers[evt.name]) {
            handlers[evt.name](...args)
          }
        })
      }
      return cmd
    })
  }
  return cmd
}

/**
 * Build a simple probe metadata object.
 */
function makeVideoMeta ({ width = 1920, height = 1080, duration = '10.0', hasAudio = true } = {}) {
  const streams = [{ codec_type: 'video', width, height }]
  if (hasAudio) {
    streams.push({ codec_type: 'audio' })
  }
  return { format: { duration }, streams }
}

function makeImageMeta () {
  return { format: {}, streams: [{ codec_type: 'video', width: 800, height: 600 }] }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ffmpegService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -----------------------------------------------------------------------
  // probeFile
  // -----------------------------------------------------------------------
  describe('probeFile', () => {
    it('resolves with metadata on success', async () => {
      const meta = makeVideoMeta()
      ffprobeImpl = (_path, cb) => cb(null, meta)

      const { probeFile } = await import('../services/ffmpegService.js')
      const result = await probeFile('/tmp/video.mp4')
      expect(result).toEqual(meta)
    })

    it('rejects with error on ffprobe failure', async () => {
      const probeError = new Error('probe failed')
      ffprobeImpl = (_path, cb) => cb(probeError, null)

      const { probeFile } = await import('../services/ffmpegService.js')
      await expect(probeFile('/tmp/video.mp4')).rejects.toThrow('probe failed')
    })
  })

  // -----------------------------------------------------------------------
  // stitchFiles — basic happy paths
  // -----------------------------------------------------------------------
  describe('stitchFiles', () => {
    it('stitches a single image file (no audio, silence injected)', async () => {
      const meta = makeImageMeta()
      ffprobeImpl = (_path, cb) => cb(null, meta)
      commandImpl = () => buildCommandMock([{ name: 'end' }])

      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/img.jpg', mimetype: 'image/jpeg', duration: 3 }]
      const result = await stitchFiles(files, '/tmp/out.mp4', { jobId: 'job1' })
      expect(result).toBe('/tmp/out.mp4')
    })

    it('stitches a single video with audio (aresample path)', async () => {
      const meta = makeVideoMeta({ hasAudio: true, duration: '5.0' })
      ffprobeImpl = (_path, cb) => cb(null, meta)
      commandImpl = () => buildCommandMock([{ name: 'end' }])

      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/vid.mp4', mimetype: 'video/mp4', duration: 5 }]
      const result = await stitchFiles(files, '/tmp/out.mp4', { jobId: 'job2' })
      expect(result).toBe('/tmp/out.mp4')
    })

    it('stitches a single video without audio (silence injected)', async () => {
      const meta = makeVideoMeta({ hasAudio: false, duration: '4.0' })
      ffprobeImpl = (_path, cb) => cb(null, meta)
      commandImpl = () => buildCommandMock([{ name: 'end' }])

      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/silent.mp4', mimetype: 'video/mp4', duration: 4 }]
      const result = await stitchFiles(files, '/tmp/out.mp4', { jobId: 'job3' })
      expect(result).toBe('/tmp/out.mp4')
    })

    it('rejects when ffmpeg emits error event', async () => {
      const meta = makeVideoMeta()
      ffprobeImpl = (_path, cb) => cb(null, meta)
      const ffmpegError = new Error('ffmpeg crashed')
      commandImpl = () => buildCommandMock([{ name: 'error', args: [ffmpegError] }])

      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/vid.mp4', mimetype: 'video/mp4', duration: 5 }]
      await expect(stitchFiles(files, '/tmp/out.mp4', { jobId: 'job4' })).rejects.toThrow('ffmpeg crashed')
    })

    it('rejects when probeFile fails', async () => {
      ffprobeImpl = (_path, cb) => cb(new Error('probe error'), null)

      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/vid.mp4', mimetype: 'video/mp4', duration: 5 }]
      await expect(stitchFiles(files, '/tmp/out.mp4', {})).rejects.toThrow('probe error')
    })

    it('uses portrait resolution when first video is portrait', async () => {
      // width < height → portrait
      const meta = makeVideoMeta({ width: 1080, height: 1920, hasAudio: true, duration: '3.0' })
      ffprobeImpl = (_path, cb) => cb(null, meta)

      let capturedFilterComplex = null
      commandImpl = () => buildCommandMock([{ name: 'end' }], {
        onComplexFilter: (fc) => {
          capturedFilterComplex = fc
        }
      })

      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/portrait.mp4', mimetype: 'video/mp4', duration: 3 }]
      await stitchFiles(files, '/tmp/out.mp4', { jobId: 'job5' })

      const scaleFilter = capturedFilterComplex.find(f => f.filter === 'scale')
      expect(scaleFilter.options.w).toBe(1080)
      expect(scaleFilter.options.h).toBe(1920)
    })

    it('uses landscape resolution when first video is landscape', async () => {
      const meta = makeVideoMeta({ width: 1920, height: 1080, hasAudio: true, duration: '3.0' })
      ffprobeImpl = (_path, cb) => cb(null, meta)

      let capturedFilterComplex = null
      commandImpl = () => buildCommandMock([{ name: 'end' }], {
        onComplexFilter: (fc) => {
          capturedFilterComplex = fc
        }
      })

      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/land.mp4', mimetype: 'video/mp4', duration: 3 }]
      await stitchFiles(files, '/tmp/out.mp4', { jobId: 'job6' })

      const scaleFilter = capturedFilterComplex.find(f => f.filter === 'scale')
      expect(scaleFilter.options.w).toBe(1920)
      expect(scaleFilter.options.h).toBe(1080)
    })

    it('uses default resolution when no video files present (images only)', async () => {
      const meta = makeImageMeta()
      ffprobeImpl = (_path, cb) => cb(null, meta)

      let capturedFilterComplex = null
      commandImpl = () => buildCommandMock([{ name: 'end' }], {
        onComplexFilter: (fc) => {
          capturedFilterComplex = fc
        }
      })

      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/img.png', mimetype: 'image/png', duration: 2 }]
      await stitchFiles(files, '/tmp/out.mp4', { jobId: 'job7' })

      const scaleFilter = capturedFilterComplex.find(f => f.filter === 'scale')
      expect(scaleFilter.options.w).toBe(1920)
      expect(scaleFilter.options.h).toBe(1080)
    })

    it('falls back to vStream duration when format.duration is missing', async () => {
      const meta = {
        format: {},
        streams: [
          { codec_type: 'video', width: 1920, height: 1080, duration: '7.5' },
          { codec_type: 'audio' }
        ]
      }
      ffprobeImpl = (_path, cb) => cb(null, meta)
      commandImpl = () => buildCommandMock([{ name: 'end' }])

      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/vid.mp4', mimetype: 'video/mp4' }]
      const result = await stitchFiles(files, '/tmp/out.mp4', { jobId: 'job8' })
      expect(result).toBe('/tmp/out.mp4')
    })

    it('uses zero duration when format.duration and vStream.duration are both missing', async () => {
      const meta = {
        format: {},
        streams: [{ codec_type: 'video', width: 1920, height: 1080 }]
      }
      ffprobeImpl = (_path, cb) => cb(null, meta)
      commandImpl = () => buildCommandMock([{ name: 'end' }])

      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/vid.mp4', mimetype: 'video/mp4' }]
      const result = await stitchFiles(files, '/tmp/out.mp4', { jobId: 'job9' })
      expect(result).toBe('/tmp/out.mp4')
    })

    it('uses defaultImageDuration when image duration is not finite or <= 0', async () => {
      const meta = makeImageMeta()
      ffprobeImpl = (_path, cb) => cb(null, meta)
      commandImpl = () => buildCommandMock([{ name: 'end' }])

      const { stitchFiles } = await import('../services/ffmpegService.js')
      // duration = 0 → should fall back to defaultImageDuration = 2
      const files = [{ path: '/tmp/img.jpg', mimetype: 'image/jpeg', duration: 0 }]
      const result = await stitchFiles(files, '/tmp/out.mp4', { imageDuration: 2, jobId: 'job10' })
      expect(result).toBe('/tmp/out.mp4')
    })

    it('uses imageDuration = 1 when options.imageDuration is falsy', async () => {
      const meta = makeImageMeta()
      ffprobeImpl = (_path, cb) => cb(null, meta)
      commandImpl = () => buildCommandMock([{ name: 'end' }])

      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/img.jpg', mimetype: 'image/jpeg', duration: 0 }]
      // imageDuration not set → defaultImageDuration = 1
      const result = await stitchFiles(files, '/tmp/out.mp4', { jobId: 'job11' })
      expect(result).toBe('/tmp/out.mp4')
    })

    it('emits progress with calculated percent from timemark when percent is missing', async () => {
      const meta = makeVideoMeta({ hasAudio: true, duration: '100.0' })
      ffprobeImpl = (_path, cb) => cb(null, meta)

      const progressEvents = [
        { name: 'start', args: ['ffmpeg ...'] },
        { name: 'progress', args: [{ timemark: '00:00:50.00' }] }, // no percent
        { name: 'end' }
      ]
      commandImpl = () => buildCommandMock(progressEvents)

      const onProgress = vi.fn()
      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/vid.mp4', mimetype: 'video/mp4', duration: 100 }]
      await stitchFiles(files, '/tmp/out.mp4', { jobId: 'job12', onProgress })

      expect(onProgress).toHaveBeenCalled()
      const call = onProgress.mock.calls[0][0]
      expect(call.percent).toBeCloseTo(50, 0)
    })

    it('caps percent at 99.9 when calculated percent exceeds it', async () => {
      const meta = makeVideoMeta({ hasAudio: true, duration: '100.0' })
      ffprobeImpl = (_path, cb) => cb(null, meta)

      const progressEvents = [
        { name: 'progress', args: [{ percent: 150 }] },
        { name: 'end' }
      ]
      commandImpl = () => buildCommandMock(progressEvents)

      const onProgress = vi.fn()
      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/vid.mp4', mimetype: 'video/mp4', duration: 100 }]
      await stitchFiles(files, '/tmp/out.mp4', { jobId: 'job13', onProgress })

      const call = onProgress.mock.calls[0][0]
      expect(call.percent).toBe(99.9)
    })

    it('does not call onProgress when onProgress is not provided', async () => {
      const meta = makeVideoMeta({ hasAudio: true, duration: '10.0' })
      ffprobeImpl = (_path, cb) => cb(null, meta)

      const progressEvents = [
        { name: 'progress', args: [{ percent: 50 }] },
        { name: 'end' }
      ]
      commandImpl = () => buildCommandMock(progressEvents)

      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/vid.mp4', mimetype: 'video/mp4', duration: 10 }]
      // No onProgress option — should not throw
      const result = await stitchFiles(files, '/tmp/out.mp4', { jobId: 'job14' })
      expect(result).toBe('/tmp/out.mp4')
    })

    it('does not recalculate percent when percent is already positive', async () => {
      const meta = makeVideoMeta({ hasAudio: true, duration: '100.0' })
      ffprobeImpl = (_path, cb) => cb(null, meta)

      const progressEvents = [
        { name: 'progress', args: [{ percent: 42 }] },
        { name: 'end' }
      ]
      commandImpl = () => buildCommandMock(progressEvents)

      const onProgress = vi.fn()
      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/vid.mp4', mimetype: 'video/mp4', duration: 100 }]
      await stitchFiles(files, '/tmp/out.mp4', { jobId: 'job15', onProgress })

      const call = onProgress.mock.calls[0][0]
      expect(call.percent).toBe(42)
    })

    it('does not compute timemark percent when totalDuration is 0', async () => {
      // video with no duration info → totalDuration stays 0
      const meta = { format: {}, streams: [{ codec_type: 'video', width: 1920, height: 1080 }] }
      ffprobeImpl = (_path, cb) => cb(null, meta)

      const progressEvents = [
        { name: 'progress', args: [{ timemark: '00:00:05.00' }] },
        { name: 'end' }
      ]
      commandImpl = () => buildCommandMock(progressEvents)

      const onProgress = vi.fn()
      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/vid.mp4', mimetype: 'video/mp4' }]
      await stitchFiles(files, '/tmp/out.mp4', { jobId: 'job16', onProgress })

      // percent should not be set (undefined from progress event with no percent and totalDuration=0)
      const call = onProgress.mock.calls[0][0]
      expect(call.percent).toBeUndefined()
    })

    it('adds bgAudio input and mixes audio when bgAudio is provided', async () => {
      const meta = makeVideoMeta({ hasAudio: true, duration: '5.0' })
      ffprobeImpl = (_path, cb) => cb(null, meta)

      let capturedFilterComplex = null
      commandImpl = () => buildCommandMock([{ name: 'end' }], {
        onComplexFilter: (fc) => {
          capturedFilterComplex = fc
        }
      })

      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/vid.mp4', mimetype: 'video/mp4', duration: 5 }]
      await stitchFiles(files, '/tmp/out.mp4', {
        jobId: 'job17',
        bgAudio: '/tmp/music.mp3',
        bgAudioVolume: 0.5
      })

      const volumeFilter = capturedFilterComplex.find(f => f.filter === 'volume')
      const amixFilter = capturedFilterComplex.find(f => f.filter === 'amix')
      expect(volumeFilter).toBeDefined()
      expect(volumeFilter.options.volume).toBe(0.5)
      expect(amixFilter).toBeDefined()
    })

    it('uses concat_outa output label when bgAudio is present', async () => {
      const meta = makeVideoMeta({ hasAudio: true, duration: '5.0' })
      ffprobeImpl = (_path, cb) => cb(null, meta)

      let capturedFilterComplex = null
      commandImpl = () => buildCommandMock([{ name: 'end' }], {
        onComplexFilter: (fc) => {
          capturedFilterComplex = fc
        }
      })

      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/vid.mp4', mimetype: 'video/mp4', duration: 5 }]
      await stitchFiles(files, '/tmp/out.mp4', {
        jobId: 'job18',
        bgAudio: '/tmp/music.mp3'
      })

      const concatFilter = capturedFilterComplex.find(f => f.filter === 'concat')
      expect(concatFilter.outputs).toContain('concat_outa')
    })

    it('uses outa output label when no bgAudio', async () => {
      const meta = makeVideoMeta({ hasAudio: true, duration: '5.0' })
      ffprobeImpl = (_path, cb) => cb(null, meta)

      let capturedFilterComplex = null
      commandImpl = () => buildCommandMock([{ name: 'end' }], {
        onComplexFilter: (fc) => {
          capturedFilterComplex = fc
        }
      })

      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/vid.mp4', mimetype: 'video/mp4', duration: 5 }]
      await stitchFiles(files, '/tmp/out.mp4', { jobId: 'job19' })

      const concatFilter = capturedFilterComplex.find(f => f.filter === 'concat')
      expect(concatFilter.outputs).toContain('outa')
    })

    it('uses default options when options object is omitted', async () => {
      const meta = makeImageMeta()
      ffprobeImpl = (_path, cb) => cb(null, meta)
      commandImpl = () => buildCommandMock([{ name: 'end' }])

      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/img.jpg', mimetype: 'image/jpeg', duration: 3 }]
      // no options argument at all
      const result = await stitchFiles(files, '/tmp/out.mp4')
      expect(result).toBe('/tmp/out.mp4')
    })

    it('handles multiple files (video + image) in a single stitch', async () => {
      let callCount = 0
      ffprobeImpl = (_path, cb) => {
        callCount++
        if (callCount === 1) {
          // video with audio
          cb(null, makeVideoMeta({ hasAudio: true, duration: '3.0' }))
        } else {
          // image
          cb(null, makeImageMeta())
        }
      }
      commandImpl = () => buildCommandMock([{ name: 'end' }])

      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [
        { path: '/tmp/vid.mp4', mimetype: 'video/mp4', duration: 3 },
        { path: '/tmp/img.jpg', mimetype: 'image/jpeg', duration: 2 }
      ]
      const result = await stitchFiles(files, '/tmp/out.mp4', { jobId: 'job20' })
      expect(result).toBe('/tmp/out.mp4')
    })

    it('handles silent video with zero duration — silence uses defaultImageDuration', async () => {
      // video with no duration in format or streams
      const meta = {
        format: {},
        streams: [{ codec_type: 'video', width: 1920, height: 1080 }]
      }
      ffprobeImpl = (_path, cb) => cb(null, meta)
      commandImpl = () => buildCommandMock([{ name: 'end' }])

      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/vid.mp4', mimetype: 'video/mp4' }]
      // fileDuration = 0, so silenceDuration should fall back to defaultImageDuration (1)
      const result = await stitchFiles(files, '/tmp/out.mp4', { imageDuration: 2 })
      expect(result).toBe('/tmp/out.mp4')
    })

    it('uses negative percent path: percent < 0 triggers timemark calculation', async () => {
      const meta = makeVideoMeta({ hasAudio: true, duration: '200.0' })
      ffprobeImpl = (_path, cb) => cb(null, meta)

      const progressEvents = [
        { name: 'progress', args: [{ percent: -5, timemark: '00:01:40.00' }] },
        { name: 'end' }
      ]
      commandImpl = () => buildCommandMock(progressEvents)

      const onProgress = vi.fn()
      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/vid.mp4', mimetype: 'video/mp4', duration: 200 }]
      await stitchFiles(files, '/tmp/out.mp4', { jobId: 'job21', onProgress })

      // 100 seconds / 200 seconds * 100 = 50%
      const call = onProgress.mock.calls[0][0]
      expect(call.percent).toBeCloseTo(50, 0)
    })
  })

  // -----------------------------------------------------------------------
  // parseTimemark (exported indirectly — tested via stitchFiles progress)
  // The function is not exported, but we can trigger all its branches via
  // progress events that go through the internal parseTimemark call.
  // -----------------------------------------------------------------------
  describe('parseTimemark edge cases (via progress event)', () => {
    it('returns 0 when timemark is null/undefined — percent stays falsy', async () => {
      const meta = makeVideoMeta({ hasAudio: true, duration: '10.0' })
      ffprobeImpl = (_path, cb) => cb(null, meta)

      const progressEvents = [
        // percent is 0 (falsy) and no timemark → percent stays 0
        { name: 'progress', args: [{ percent: 0, timemark: null }] },
        { name: 'end' }
      ]
      commandImpl = () => buildCommandMock(progressEvents)

      const onProgress = vi.fn()
      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/vid.mp4', mimetype: 'video/mp4', duration: 10 }]
      await stitchFiles(files, '/tmp/out.mp4', { jobId: 'tmk1', onProgress })

      const call = onProgress.mock.calls[0][0]
      // no timemark → parseTimemark not invoked → percent stays 0 (falsy, but not recalculated)
      expect(call.percent).toBe(0)
    })

    it('returns 0 when timemark has wrong part count (not 3 parts)', async () => {
      const meta = makeVideoMeta({ hasAudio: true, duration: '10.0' })
      ffprobeImpl = (_path, cb) => cb(null, meta)

      const progressEvents = [
        { name: 'progress', args: [{ percent: 0, timemark: '00:30' }] }, // only 2 parts
        { name: 'end' }
      ]
      commandImpl = () => buildCommandMock(progressEvents)

      const onProgress = vi.fn()
      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/vid.mp4', mimetype: 'video/mp4', duration: 10 }]
      await stitchFiles(files, '/tmp/out.mp4', { jobId: 'tmk2', onProgress })

      // parseTimemark returns 0 → 0/10*100 = 0% still falsy → no capping
      const call = onProgress.mock.calls[0][0]
      expect(call.percent).toBe(0)
    })

    it('returns 0 when timemark parts are non-numeric', async () => {
      const meta = makeVideoMeta({ hasAudio: true, duration: '10.0' })
      ffprobeImpl = (_path, cb) => cb(null, meta)

      const progressEvents = [
        { name: 'progress', args: [{ percent: 0, timemark: 'AA:BB:CC' }] },
        { name: 'end' }
      ]
      commandImpl = () => buildCommandMock(progressEvents)

      const onProgress = vi.fn()
      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/vid.mp4', mimetype: 'video/mp4', duration: 10 }]
      await stitchFiles(files, '/tmp/out.mp4', { jobId: 'tmk3', onProgress })

      const call = onProgress.mock.calls[0][0]
      // NaN parts → parseTimemark returns 0 → 0% still falsy
      expect(call.percent).toBe(0)
    })

    it('returns 0 when timemark is a non-string truthy value (typeof !== string branch)', async () => {
      // Pass a number as timemark — truthy but not a string
      const meta = makeVideoMeta({ hasAudio: true, duration: '10.0' })
      ffprobeImpl = (_path, cb) => cb(null, meta)

      const progressEvents = [
        { name: 'progress', args: [{ percent: 0, timemark: 12345 }] },
        { name: 'end' }
      ]
      commandImpl = () => buildCommandMock(progressEvents)

      const onProgress = vi.fn()
      const { stitchFiles } = await import('../services/ffmpegService.js')
      const files = [{ path: '/tmp/vid.mp4', mimetype: 'video/mp4', duration: 10 }]
      await stitchFiles(files, '/tmp/out.mp4', { jobId: 'tmk4', onProgress })

      // parseTimemark returns 0 for non-string timemark → 0/10*100=0 → no capping
      const call = onProgress.mock.calls[0][0]
      expect(call.percent).toBe(0)
    })
  })
})
