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

import React, { useState, useEffect, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import axios from 'axios'
import DropZone from './components/DropZone'
import './App.css'
import { API_URL, GOOGLE_CLIENT_ID, DISABLE_AUTH } from './env'

const api = axios.create({
  baseURL: API_URL
})

/**
 * Decode the payload of a JWT without verifying the signature.
 * Returns null if the token is malformed.
 */
function decodeJwtPayload (token) {
  try {
    const base64Url = token.split('.')[1]
    if (!base64Url) {
      return null
    }
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((2 - base64Url.length % 4) % 4)
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    )
    return JSON.parse(json)
  } catch {
    return null
  }
}

function App () {
  const [files, setFiles] = useState([])
  const [_isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [processingProgress, setProcessingProgress] = useState(0)
  const [status, setStatus] = useState('idle') // idle, uploading, processing, completed, error
  const [resultUrl, setResultUrl] = useState(null)
  const [error, setError] = useState(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const [defaultImageDuration, setDefaultImageDuration] = useState(1)
  const [retentionMinutes, setRetentionMinutes] = useState(null)
  const [bgAudioFile, setBgAudioFile] = useState(null)
  const [bgAudioVolume, setBgAudioVolume] = useState(1.0)

  const [user, setUser] = useState(() => {
    if (DISABLE_AUTH) {
      return { email: 'local-user@local-stitcher', name: 'Local User' }
    }
    return null
  })
  const [idToken, setIdToken] = useState(() => {
    if (DISABLE_AUTH) {
      return 'local-dev-token'
    }
    return localStorage.getItem('google_id_token')
  })
  const [isAuthorized, setIsAuthorized] = useState(true)
  const [isLoadingAuth, setIsLoadingAuth] = useState(false)
  const googleBtnRef = useRef(null)
  const pollingIntervalRef = useRef(null)

  useEffect(() => {
    // Initialize or re-render Google Identity Services button
    if (window.google && GOOGLE_CLIENT_ID && !user && !DISABLE_AUTH) {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleLoginCallback,
      })

      // Brief delay to ensure the ref element is in the DOM
      setTimeout(() => {
        if (googleBtnRef.current) {
          window.google.accounts.id.renderButton(
            googleBtnRef.current,
            { theme: 'outline', size: 'large' }
          )
        }
      }, 0)
    }
  }, [user])

  // Decode user from token if we have one (on mount or after restore)
  useEffect(() => {
    if (idToken && !user) {
      const payload = decodeJwtPayload(idToken)
      if (payload) {
        setUser(payload)
      } else {
        console.error('Failed to parse persisted token')
        setIdToken(null)
        localStorage.removeItem('google_id_token')
      }
    }
  }, [idToken, user])

  // Clear polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
      }
    }
  }, [])

  const handleLoginCallback = (response) => {
    const token = response.credential
    setIdToken(token)
    localStorage.setItem('google_id_token', token)

    const payload = decodeJwtPayload(token)
    if (payload) {
      setUser(payload)
      setIsAuthorized(true)
    } else {
      console.error('Failed to parse token')
    }
  }

  const handleLogout = () => {
    setUser(null)
    setIdToken(null)
    localStorage.removeItem('google_id_token')
    setIsAuthorized(true)
    setError(null)
  }

  // Set up axios interceptor to add the token
  useEffect(() => {
    const interceptor = api.interceptors.request.use((config) => {
      if (idToken) {
        config.headers.Authorization = `Bearer ${idToken}`
      }
      return config
    })
    return () => api.interceptors.request.eject(interceptor)
  }, [idToken])

  useEffect(() => {
    if (!idToken) {
      return
    }

    setIsLoadingAuth(true)
    api.get('/api/config')
      .then(res => {
        setRetentionMinutes(res.data.retentionMinutes)
        setIsAuthorized(true)
      })
      .catch(err => {
        console.error('Failed to fetch config', err)
        if (err.response?.status === 403) {
          setIsAuthorized(false)
          setError('Access Denied: Your email is not on the allowlist.')
        }
      })
      .finally(() => {
        setIsLoadingAuth(false)
      })
  }, [idToken])

  const handleFilesAdded = (newFiles) => {
    const wrappedFiles = newFiles.map(f => ({
      file: f,
      id: uuidv4(),
      duration: null
    }))
    setFiles(prev => [...prev, ...wrappedFiles])
    setStatus('idle')
    setResultUrl(null)
    setError(null)
  }

  const removeFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  const updateFileDuration = (id, value) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, duration: parseInt(value, 10) } : f))
  }

  const isImageDurationValid = (wrapper) => {
    if (!wrapper.file.type.startsWith('image/')) {
      return true
    }
    const d = wrapper.duration ?? defaultImageDuration
    return Number.isInteger(d) && d >= 1
  }

  const hasInvalidDurations = files.some(f => !isImageDurationValid(f))

  const isSingleVideoNoAudio =
    files.length === 1 &&
    files[0].file.type.startsWith('video/') &&
    !bgAudioFile

  const moveFile = (index, direction) => {
    if ((direction === -1 && index === 0) || (direction === 1 && index === files.length - 1)) {
      return
    }

    const newFiles = [...files]
    const temp = newFiles[index]
    newFiles[index] = newFiles[index + direction]
    newFiles[index + direction] = temp

    setFiles(newFiles)
  }

  const dragSrcIndex = useRef(null)
  const [draggingIndex, setDraggingIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)

  const handleDragStart = (e, index) => {
    dragSrcIndex.current = index
    setDraggingIndex(index)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragEnter = (e, index) => {
    e.preventDefault()
    setDragOverIndex(index)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e, index) => {
    e.preventDefault()
    const src = dragSrcIndex.current
    if (src === null || src === index) {
      setDraggingIndex(null)
      setDragOverIndex(null)
      return
    }
    const newFiles = [...files]
    const [removed] = newFiles.splice(src, 1)
    newFiles.splice(index, 0, removed)
    setFiles(newFiles)
    dragSrcIndex.current = null
    setDraggingIndex(null)
    setDragOverIndex(null)
  }

  const [bgAudioDragOver, setBgAudioDragOver] = useState(false)

  const handleBgAudioChange = (e) => {
    setBgAudioFile(e.target.files[0] || null)
    e.target.value = ''
  }

  const handleClearBgAudio = () => {
    setBgAudioFile(null)
    setBgAudioVolume(1.0)
  }

  const handleBgAudioDragOver = (e) => {
    e.preventDefault()
    const items = [...e.dataTransfer.items]
    if (items.some(i => i.kind === 'file' && i.type.startsWith('audio/'))) {
      setBgAudioDragOver(true)
    }
  }

  const handleBgAudioDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setBgAudioDragOver(false)
    }
  }

  const handleBgAudioDrop = (e) => {
    e.preventDefault()
    setBgAudioDragOver(false)
    const file = [...e.dataTransfer.files].find(f => f.type.startsWith('audio/'))
    if (file) {
      setBgAudioFile(file)
    }
  }

  const handleDragEnd = () => {
    dragSrcIndex.current = null
    setDraggingIndex(null)
    setDragOverIndex(null)
  }

  const handleDownload = async () => {
    setIsDownloading(true)
    try {
      const res = await fetch(resultUrl)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = 'stitched-video.mp4'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } finally {
      setIsDownloading(false)
    }
  }

  const handleStitch = async () => {
    // Clear any previous polling interval
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }

    setIsUploading(true)
    setStatus('uploading')
    setUploadProgress(0)
    setProcessingProgress(0)
    setError(null)

    const formData = new FormData()
    const imageDurations = {}
    files.forEach((wrapper, index) => {
      formData.append('files', wrapper.file)
      if (wrapper.file.type.startsWith('image/') && wrapper.duration !== null) {
        imageDurations[index] = wrapper.duration
      }
    })

    formData.append('defaultImageDuration', defaultImageDuration)
    formData.append('imageDurations', JSON.stringify(imageDurations))

    if (bgAudioFile) {
      formData.append('bgAudio', bgAudioFile)
      formData.append('bgAudioVolume', String(bgAudioVolume))
    }

    try {
      const response = await api.post('/api/stitch', formData, {
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          setUploadProgress(percentCompleted)
        }
      })

      const { jobId } = response.data
      setStatus('processing')

      pollingIntervalRef.current = setInterval(async () => {
        try {
          const statusRes = await api.get(`/api/status/${jobId}`)
          const { status, progress, downloadUrl, error: jobError } = statusRes.data

          if (status === 'processing') {
            setProcessingProgress(progress)
          } else if (status === 'completed') {
            clearInterval(pollingIntervalRef.current)
            pollingIntervalRef.current = null
            setStatus('completed')
            setProcessingProgress(100)
            setResultUrl(`${API_URL}${downloadUrl}`)
          } else if (status === 'failed') {
            clearInterval(pollingIntervalRef.current)
            pollingIntervalRef.current = null
            setStatus('error')
            setError(jobError || 'Processing failed')
          }
        } catch (e) {
          console.error('Polling error', e)
          if (e.response?.status === 403) {
            clearInterval(pollingIntervalRef.current)
            pollingIntervalRef.current = null
            setStatus('error')
            setError('Access Denied: Your email is not on the allowlist.')
          }
        }
      }, 1000)
    } catch (err) {
      console.error(err)
      setStatus('error')
      const message = err.response?.status === 403
        ? 'Access Denied: Your email is not on the allowlist.'
        : (err.response?.data?.error || err.message || 'Upload failed')
      setError(message)
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className='app-container'>
      <header className='app-header'>
        <div className='header-top'>
          <h1>Video Stitcher</h1>
          <div className='auth-controls'>
            {user && !DISABLE_AUTH
              ? (
                <div className='user-info'>
                  <span>{user.email}</span>
                  <button onClick={handleLogout} className='auth-btn'>Logout</button>
                </div>
                )
              : !user && (
                <div ref={googleBtnRef} />
                )}
          </div>
        </div>
        <p>Combine videos and images into a single file</p>
      </header>

      <main>
        {!user
          ? (
            <div className='login-prompt'>
              <h2>Authentication Required</h2>
              <p>Please log in with your Google account to use the Video Stitcher.</p>
              {!GOOGLE_CLIENT_ID && (
                <p className='error-message'>Error: VITE_GOOGLE_CLIENT_ID is not configured.</p>
              )}
              <div className='login-btn-container'>
                <div ref={googleBtnRef} />
              </div>
            </div>
            )
          : isLoadingAuth
            ? (
              <div className='status-message'>
                <h2>Verifying Authorization...</h2>
              </div>
              )
            : !isAuthorized
                ? (
                  <div className='login-prompt'>
                    <h2 className='error-message'>Access Denied</h2>
                    <p>Your account (<strong>{user.email}</strong>) is not authorized to use this application.</p>
                    <p>Please contact the administrator to be added to the allowlist.</p>
                    <button onClick={handleLogout} className='stitch-btn' style={{ marginTop: '20px' }}>Log in with different account</button>
                  </div>
                  )
                : (
                  <>
                    <DropZone onFilesAdded={handleFilesAdded} />

                    <div
                      className={`bg-audio-section${bgAudioDragOver ? ' bg-audio-drag-over' : ''}`}
                      onDragOver={handleBgAudioDragOver}
                      onDragLeave={handleBgAudioDragLeave}
                      onDrop={handleBgAudioDrop}
                    >
                      {!bgAudioFile
                        ? (
                          <label className='bg-audio-pick-btn'>
                            <span className='bg-audio-icon'>♪</span>
                            {bgAudioDragOver ? 'Drop audio file here' : 'Choose or drop background audio (optional)'}
                            <input type='file' accept='audio/*' onChange={handleBgAudioChange} style={{ display: 'none' }} />
                          </label>
                          )
                        : (
                          <div className='bg-audio-selected'>
                            <span className='bg-audio-icon'>♪</span>
                            <span className='bg-audio-name' title={bgAudioFile.name}>{bgAudioFile.name}</span>
                            <span className='bg-audio-size'>{(bgAudioFile.size / 1024 / 1024).toFixed(2)} MB</span>
                            <div className='bg-audio-volume'>
                              <label>Volume:</label>
                              <input
                                type='range'
                                min='0'
                                max='2'
                                step='0.1'
                                value={bgAudioVolume}
                                onChange={(e) => setBgAudioVolume(parseFloat(e.target.value))}
                                title='0.0 = muted · 1.0 = original volume · 2.0 = double volume'
                              />
                              <span className='bg-audio-volume-value' title='0.0 = muted · 1.0 = original volume · 2.0 = double volume'>
                                {bgAudioVolume.toFixed(1)}
                              </span>
                              <span className='bg-audio-volume-hint'>
                                {bgAudioVolume === 0 ? 'muted' : bgAudioVolume === 1.0 ? 'original' : bgAudioVolume < 1.0 ? `${Math.round(bgAudioVolume * 100)}%` : `${bgAudioVolume.toFixed(1)}× louder`}
                              </span>
                            </div>
                            <button className='remove-btn' onClick={handleClearBgAudio}>×</button>
                          </div>
                          )}
                    </div>

                    {files.length > 0 && (
                      <div className='file-list'>
                        <h3>Selected Files ({files.length})</h3>
                        {files.some(w => w.file.type.startsWith('image/')) && (
                          <div className='global-duration-row'>
                            <label>
                              Default image duration:
                              <input
                                type='number'
                                min='1'
                                step='1'
                                value={defaultImageDuration}
                                onChange={(e) => setDefaultImageDuration(Math.max(1, parseInt(e.target.value, 10) || 1))}
                              />
                              s
                            </label>
                          </div>
                        )}
                        <ul>
                          {files.map((wrapper, index) => (
                            <li
                              key={wrapper.id}
                              className={`file-item${draggingIndex === index ? ' dragging' : ''}${dragOverIndex === index && draggingIndex !== index ? ' drag-over' : ''}`}
                              draggable
                              onDragStart={(e) => handleDragStart(e, index)}
                              onDragEnter={(e) => handleDragEnter(e, index)}
                              onDragOver={handleDragOver}
                              onDrop={(e) => handleDrop(e, index)}
                              onDragEnd={handleDragEnd}
                            >
                              <div className='file-info'>
                                <span className='drag-handle'>⠿</span>
                                <span className='file-type-icon'>
                                  {wrapper.file.type.startsWith('image/') ? '🖼️' : '🎬'}
                                </span>
                                <span className='file-name' title={wrapper.file.name}>{wrapper.file.name}</span>
                                <span className='file-size'>{(wrapper.file.size / 1024 / 1024).toFixed(2)} MB</span>
                                {wrapper.file.type.startsWith('image/') && (
                                  <span className='image-duration'>
                                    <input
                                      type='number'
                                      min='1'
                                      step='1'
                                      draggable={false}
                                      className={isImageDurationValid(wrapper) ? '' : 'invalid'}
                                      value={wrapper.duration ?? defaultImageDuration}
                                      onChange={(e) => updateFileDuration(wrapper.id, e.target.value)}
                                      onMouseDown={(e) => e.stopPropagation()}
                                    />
                                    s
                                  </span>
                                )}
                              </div>
                              <div className='file-actions'>
                                <button onClick={() => moveFile(index, -1)} disabled={index === 0}>↑</button>
                                <button onClick={() => moveFile(index, 1)} disabled={index === files.length - 1}>↓</button>
                                <button onClick={() => removeFile(wrapper.id)} className='remove-btn'>×</button>
                              </div>
                            </li>
                          ))}
                        </ul>

                        {isSingleVideoNoAudio && (
                          <p className='warn-message'>
                            Nothing to stitch: add more files or a background audio track.
                          </p>
                        )}
                        <button
                          className='stitch-btn'
                          onClick={handleStitch}
                          disabled={files.length < 1 || status === 'uploading' || status === 'processing' || hasInvalidDurations || isSingleVideoNoAudio}
                        >
                          {status === 'uploading'
                            ? 'Uploading...'
                            : status === 'processing' ? 'Processing...' : 'Stitch Videos'}
                        </button>
                      </div>
                    )}

                    {status === 'uploading' && (
                      <div className='progress-section'>
                        <span>Uploading... {uploadProgress}%</span>
                        <div className='progress-bar-track'>
                          <div className='progress-bar-fill' style={{ width: `${uploadProgress}%` }} />
                        </div>
                      </div>
                    )}

                    {status === 'processing' && (
                      <div className='progress-section'>
                        <span>Processing... {processingProgress}%</span>
                        <div className='progress-bar-track'>
                          <div className='progress-bar-fill processing' style={{ width: `${processingProgress}%` }} />
                        </div>
                      </div>
                    )}

                    {status === 'completed' && resultUrl && (
                      <div className='result-section'>
                        <h3>Success!</h3>
                        <button
                          className='download-btn'
                          onClick={handleDownload}
                          disabled={isDownloading}
                        >
                          {isDownloading ? 'Downloading…' : 'Download Stitched Video'}
                        </button>
                        {retentionMinutes && (
                          <p className='retention-warning'>
                            ⚠️ Note: The stitched file will be deleted after {retentionMinutes} minutes.
                          </p>
                        )}
                        <video controls src={resultUrl} className='preview-video' />
                      </div>
                    )}

                    {status === 'error' && (
                      <div className='error-message'>
                        Error: {error}
                      </div>
                    )}
                  </>
                  )}
      </main>
    </div>
  )
}

export default App
