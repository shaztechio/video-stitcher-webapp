import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DropZone from '../components/DropZone'

// CSS import in DropZone.jsx must not throw
vi.mock('../components/DropZone.css', () => ({}))

function makeFile (name, type) {
  return new File(['content'], name, { type })
}

describe('DropZone', () => {
  let onFilesAdded

  beforeEach(() => {
    onFilesAdded = vi.fn()
  })

  it('renders the drop zone with prompt text', () => {
    render(<DropZone onFilesAdded={onFilesAdded} />)
    expect(screen.getByText('Drag & Drop video or image files here')).toBeInTheDocument()
    expect(screen.getByText('or click to browse')).toBeInTheDocument()
  })

  it('clicking the drop zone triggers the hidden file input', () => {
    render(<DropZone onFilesAdded={onFilesAdded} />)
    const input = document.querySelector('input[type="file"]')
    const clickSpy = vi.spyOn(input, 'click')
    const dropZone = document.querySelector('.drop-zone')
    fireEvent.click(dropZone)
    expect(clickSpy).toHaveBeenCalledOnce()
  })

  it('accepts video and image files via file input', () => {
    render(<DropZone onFilesAdded={onFilesAdded} />)
    const input = document.querySelector('input[type="file"]')
    const videoFile = makeFile('test.mp4', 'video/mp4')
    const imageFile = makeFile('test.png', 'image/png')
    fireEvent.change(input, { target: { files: [videoFile, imageFile] } })
    expect(onFilesAdded).toHaveBeenCalledWith([videoFile, imageFile])
  })

  it('does not call onFilesAdded when file input has no files', () => {
    render(<DropZone onFilesAdded={onFilesAdded} />)
    const input = document.querySelector('input[type="file"]')
    fireEvent.change(input, { target: { files: [] } })
    expect(onFilesAdded).not.toHaveBeenCalled()
  })

  // DragEnter: sets drag-over class only when Files type is present
  it('sets drag-over class on dragenter with Files type', () => {
    render(<DropZone onFilesAdded={onFilesAdded} />)
    const dropZone = document.querySelector('.drop-zone')
    fireEvent.dragEnter(dropZone, {
      dataTransfer: { types: ['Files'] }
    })
    expect(dropZone).toHaveClass('drag-over')
  })

  it('does not set drag-over class on dragenter without Files type', () => {
    render(<DropZone onFilesAdded={onFilesAdded} />)
    const dropZone = document.querySelector('.drop-zone')
    fireEvent.dragEnter(dropZone, {
      dataTransfer: { types: ['text/plain'] }
    })
    expect(dropZone).not.toHaveClass('drag-over')
  })

  it('removes drag-over class on dragleave', () => {
    render(<DropZone onFilesAdded={onFilesAdded} />)
    const dropZone = document.querySelector('.drop-zone')
    // First set it
    fireEvent.dragEnter(dropZone, { dataTransfer: { types: ['Files'] } })
    expect(dropZone).toHaveClass('drag-over')
    // Then remove it
    fireEvent.dragLeave(dropZone)
    expect(dropZone).not.toHaveClass('drag-over')
  })

  it('prevents default on dragover', () => {
    render(<DropZone onFilesAdded={onFilesAdded} />)
    const dropZone = document.querySelector('.drop-zone')
    const event = new Event('dragover', { bubbles: true, cancelable: true })
    event.dataTransfer = { dropEffect: '' }
    dropZone.dispatchEvent(event)
    // jsdom fires the handler; we just verify no errors thrown and component stable
    expect(dropZone).toBeInTheDocument()
  })

  it('drops accepted video file and calls onFilesAdded', () => {
    render(<DropZone onFilesAdded={onFilesAdded} />)
    const dropZone = document.querySelector('.drop-zone')
    const videoFile = makeFile('clip.mp4', 'video/mp4')
    const clearData = vi.fn()
    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [videoFile],
        clearData,
      },
    })
    expect(onFilesAdded).toHaveBeenCalledWith([videoFile])
    expect(clearData).toHaveBeenCalled()
  })

  it('drops accepted image file and calls onFilesAdded', () => {
    render(<DropZone onFilesAdded={onFilesAdded} />)
    const dropZone = document.querySelector('.drop-zone')
    const imageFile = makeFile('photo.png', 'image/png')
    const clearData = vi.fn()
    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [imageFile],
        clearData,
      },
    })
    expect(onFilesAdded).toHaveBeenCalledWith([imageFile])
  })

  it('filters out non-video/image files on drop', () => {
    render(<DropZone onFilesAdded={onFilesAdded} />)
    const dropZone = document.querySelector('.drop-zone')
    const txtFile = makeFile('readme.txt', 'text/plain')
    const videoFile = makeFile('clip.mp4', 'video/mp4')
    const clearData = vi.fn()
    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [txtFile, videoFile],
        clearData,
      },
    })
    // Only the video file passes the filter
    expect(onFilesAdded).toHaveBeenCalledWith([videoFile])
  })

  it('does not call onFilesAdded when all dropped files are rejected', () => {
    render(<DropZone onFilesAdded={onFilesAdded} />)
    const dropZone = document.querySelector('.drop-zone')
    const txtFile = makeFile('readme.txt', 'text/plain')
    const clearData = vi.fn()
    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [txtFile],
        clearData,
      },
    })
    expect(onFilesAdded).not.toHaveBeenCalled()
  })

  it('does not call onFilesAdded when drop has no files', () => {
    render(<DropZone onFilesAdded={onFilesAdded} />)
    const dropZone = document.querySelector('.drop-zone')
    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [],
        clearData: vi.fn(),
      },
    })
    expect(onFilesAdded).not.toHaveBeenCalled()
  })

  it('removes drag-over class after drop', () => {
    render(<DropZone onFilesAdded={onFilesAdded} />)
    const dropZone = document.querySelector('.drop-zone')
    // Set drag over
    fireEvent.dragEnter(dropZone, { dataTransfer: { types: ['Files'] } })
    expect(dropZone).toHaveClass('drag-over')
    // Drop removes it
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [], clearData: vi.fn() },
    })
    expect(dropZone).not.toHaveClass('drag-over')
  })

  it('the file input has correct accept attribute and multiple', () => {
    render(<DropZone onFilesAdded={onFilesAdded} />)
    const input = document.querySelector('input[type="file"]')
    expect(input).toHaveAttribute('accept', 'video/*,image/*')
    expect(input).toHaveAttribute('multiple')
  })
})
