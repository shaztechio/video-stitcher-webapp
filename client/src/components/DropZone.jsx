import React, { useRef, useState } from 'react'
import './DropZone.css'

const ACCEPTED_MIME_PREFIXES = ['video/', 'image/']

function isAcceptedFile (file) {
  return ACCEPTED_MIME_PREFIXES.some(prefix => file.type.startsWith(prefix))
}

const DropZone = ({ onFilesAdded }) => {
  const [isDragOver, setIsDragOver] = useState(false)
  const inputRef = useRef(null)

  const handleDragEnter = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!e.dataTransfer.types.includes('Files')) {
      return
    }
    setIsDragOver(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const accepted = Array.from(e.dataTransfer.files).filter(isAcceptedFile)
      if (accepted.length > 0) {
        onFilesAdded(accepted)
      }
      e.dataTransfer.clearData()
    }
  }

  const handleFileInput = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesAdded(Array.from(e.target.files))
    }
  }

  return (
    <div
      className={`drop-zone ${isDragOver ? 'drag-over' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          inputRef.current?.click()
        }
      }}
    >
      <input
        ref={inputRef}
        type='file'
        multiple
        accept='video/*,image/*'
        onChange={handleFileInput}
        style={{ display: 'none' }}
      />
      <div className='drop-zone-content'>
        <p>Drag & Drop video or image files here</p>
        <span>or click to browse</span>
      </div>
    </div>
  )
}

export default DropZone
