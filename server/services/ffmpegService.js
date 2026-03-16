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

import ffmpeg from 'fluent-ffmpeg'
import logger from '../utils/logger.js'

/**
 * Parse timemark string "HH:MM:SS.mm" to seconds.
 */
const parseTimemark = (timemark) => {
  if (!timemark || typeof timemark !== 'string') {
    return 0
  }
  const parts = timemark.split(':')
  if (parts.length !== 3) {
    return 0
  }
  const hours = parseFloat(parts[0])
  const minutes = parseFloat(parts[1])
  const seconds = parseFloat(parts[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return 0
  }
  return (hours * 3600) + (minutes * 60) + seconds
}

/**
 * Stitch files together using FFmpeg.
 * @param {Array} files - Array of { path, mimetype, duration }
 * @param {String} outputPath - Path to save the output file
 * @param {Object} options - { jobId, imageDuration, onProgress }
 * @returns {Promise<string>} Resolves with outputPath
 */
const stitchFiles = async (files, outputPath, options = {}) => {
  const { imageDuration, jobId, onProgress, bgAudio, bgAudioVolume = 1.0 } = options
  const defaultImageDuration = imageDuration || 1

  const fileMetadatas = await Promise.all(files.map(f => probeFile(f.path)))

  let totalDuration = 0
  let width = 1920
  let height = 1080

  // Use first video's orientation to set target resolution
  const firstVideoIndex = files.findIndex(f => f.mimetype.startsWith('video/'))
  if (firstVideoIndex !== -1) {
    const meta = fileMetadatas[firstVideoIndex]
    const vStream = meta.streams.find(s => s.codec_type === 'video')
    if (vStream && vStream.width < vStream.height) {
      width = 1080
      height = 1920
    }
  }

  const command = ffmpeg()
  const filterComplex = []
  const videoInputs = []
  const audioInputs = []

  files.forEach((file, index) => {
    const meta = fileMetadatas[index]
    const isImage = file.mimetype.startsWith('image/')

    command.input(file.path)

    let fileDuration = 0

    if (isImage) {
      fileDuration = (Number.isFinite(file.duration) && file.duration > 0)
        ? file.duration
        : defaultImageDuration
      command.inputOptions(['-loop 1', `-t ${fileDuration}`])
    } else {
      if (meta.format?.duration) {
        fileDuration = parseFloat(meta.format.duration)
      } else {
        const vStream = meta.streams.find(s => s.codec_type === 'video')
        if (vStream?.duration) {
          fileDuration = parseFloat(vStream.duration)
        }
      }
      if (!Number.isFinite(fileDuration) || fileDuration <= 0) {
        fileDuration = 0
      }
    }

    totalDuration += fileDuration

    const vLabel = `v${index}`
    const aLabel = `a${index}`

    filterComplex.push({
      filter: 'scale',
      options: { w: width, h: height, force_original_aspect_ratio: 'decrease' },
      inputs: `${index}:v`,
      outputs: `sc${index}`
    })

    filterComplex.push({
      filter: 'pad',
      options: { w: width, h: height, x: '(ow-iw)/2', y: '(oh-ih)/2', color: 'black' },
      inputs: `sc${index}`,
      outputs: `pd${index}`
    })

    filterComplex.push({
      filter: 'setsar',
      options: '1',
      inputs: `pd${index}`,
      outputs: vLabel
    })

    videoInputs.push(vLabel)

    const hasAudio = !isImage && meta.streams.some(s => s.codec_type === 'audio')

    if (hasAudio) {
      filterComplex.push({
        filter: 'aresample',
        options: { sample_rate: 44100 },
        inputs: `${index}:a`,
        outputs: aLabel
      })
    } else {
      // Generate silence for images and silent videos
      const silenceDuration = fileDuration > 0 ? fileDuration : defaultImageDuration
      filterComplex.push({
        filter: 'anullsrc',
        options: { channel_layout: 'stereo', sample_rate: 44100 },
        outputs: `raw_silence${index}`
      })
      filterComplex.push({
        filter: 'atrim',
        options: { duration: silenceDuration },
        inputs: `raw_silence${index}`,
        outputs: aLabel
      })
    }

    audioInputs.push(aLabel)
  })

  const concatInputs = []
  for (let i = 0; i < files.length; i++) {
    concatInputs.push(videoInputs[i])
    concatInputs.push(audioInputs[i])
  }

  const concatAudioOut = bgAudio ? 'concat_outa' : 'outa'

  filterComplex.push({
    filter: 'concat',
    options: { n: files.length, v: 1, a: 1 },
    inputs: concatInputs,
    outputs: ['outv', concatAudioOut]
  })

  let bgAudioInputIndex = null
  if (bgAudio) {
    bgAudioInputIndex = files.length
    command.input(bgAudio).inputOptions(['-stream_loop -1'])

    filterComplex.push({
      filter: 'volume',
      options: { volume: bgAudioVolume },
      inputs: `${bgAudioInputIndex}:a`,
      outputs: 'bg_vol'
    })
    filterComplex.push({
      filter: 'amix',
      options: { inputs: 2, duration: 'first', normalize: 0 },
      inputs: ['concat_outa', 'bg_vol'],
      outputs: 'outa'
    })
  }

  return new Promise((resolve, reject) => {
    command
      .complexFilter(filterComplex)
      .outputOptions(['-map [outv]', '-map [outa]'])
      .on('start', (cmdLine) => {
        logger.info('Spawned FFmpeg with command: ' + cmdLine)
        logger.info(`Total expected duration for job ${jobId}: ${totalDuration}`)
      })
      .on('error', (err) => {
        logger.error('FFmpeg error: ' + err.message)
        reject(err)
      })
      .on('progress', (progress) => {
        let percent = progress.percent
        if ((!percent || percent < 0) && progress.timemark && totalDuration > 0) {
          const currentSeconds = parseTimemark(progress.timemark)
          percent = (currentSeconds / totalDuration) * 100
        }
        if (percent > 99.9) {
          percent = 99.9
        }

        if (onProgress) {
          onProgress({ ...progress, percent })
        }
      })
      .on('end', () => {
        logger.info(`Processing finished for job ${jobId}.`)
        resolve(outputPath)
      })
      .save(outputPath)
  })
}

const probeFile = (filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err)
      } else {
        resolve(metadata)
      }
    })
  })
}

export { stitchFiles, probeFile }
