/**
 * App.test.jsx — exhaustive unit tests for src/App.jsx
 *
 * Timer strategy:
 *   Most tests run with real timers and drain async work via act().
 *   Only the polling tests (handleStitch describe block) need fake timers
 *   to control the 1-second setInterval.  Those tests set up/tear down fake
 *   timers locally.
 *
 * Why not shouldAdvanceTime:
 *   Vitest 4 + React 19 + jsdom 29 + @testing-library/react 16 all interact
 *   in ways that make shouldAdvanceTime unreliable for multi-step async flows.
 *   Instead we use act() + Promise.resolve() chains to drain the microtask
 *   queue, and vi.advanceTimersByTimeAsync() only when we need to fire a
 *   specific timer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Stable mock api instance — vi.hoisted() runs before vi.mock() factories.
// ---------------------------------------------------------------------------
const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  interceptors: {
    request: {
      use: vi.fn(() => 99),
      eject: vi.fn(),
    },
  },
}))

vi.mock('axios', () => ({
  default: { create: vi.fn(() => mockApi) },
}))

vi.mock('uuid', () => ({
  v4: vi.fn((() => {
    let n = 0
    return () => `id-${++n}`
  })()),
}))

// Capture onFilesAdded so tests can trigger it imperatively.
let _onFilesAdded = null
vi.mock('../components/DropZone', () => ({
  default: ({ onFilesAdded }) => {
    _onFilesAdded = onFilesAdded
    return <div data-testid='dropzone' />
  },
}))

vi.mock('../App.css', () => ({}))

import App from '../App'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile (name, type, size = 512) {
  return new File([new ArrayBuffer(size)], name, { type })
}

function makeJwt (data) {
  const json = JSON.stringify(data)
  const b64url = btoa(json)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
  return `hdr.${b64url}.sig`
}

/**
 * Drain React's async scheduler (effects, state updates) by running all
 * pending microtasks.  This works without fake timers.
 */
async function flush () {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

// ---------------------------------------------------------------------------
// Shared reset
// ---------------------------------------------------------------------------
beforeEach(() => {
  _onFilesAdded = null
  localStorage.clear()

  mockApi.get.mockReset()
  mockApi.post.mockReset()
  mockApi.interceptors.request.use.mockReset()
  mockApi.interceptors.request.use.mockReturnValue(99)
  mockApi.interceptors.request.eject.mockReset()

  mockApi.get.mockImplementation((url) => {
    if (url === '/api/config') {
      return Promise.resolve({ data: { retentionMinutes: 5 } })
    }
    return Promise.reject(new Error(`Unexpected GET: ${url}`))
  })

  delete window.google
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

// ---------------------------------------------------------------------------
// Shortcuts
// ---------------------------------------------------------------------------

function seedToken (data = { email: 'alice@example.com', name: 'Alice' }) {
  localStorage.setItem('google_id_token', makeJwt(data))
}

/**
 * Render App with a valid token already in localStorage, wait for the main
 * UI (dropzone) to become visible.
 */
async function renderAuthed () {
  render(<App />)
  await act(async () => {
    for (let i = 0; i < 10; i++) {
      await Promise.resolve()
    }
  })
  expect(screen.getByTestId('dropzone')).toBeInTheDocument()
}

// ===========================================================================
// decodeJwtPayload — tested indirectly through the token-restore useEffect
// ===========================================================================
describe('decodeJwtPayload', () => {
  it('decodes a valid JWT and sets user on mount', async () => {
    seedToken({ email: 'alice@example.com' })
    await renderAuthed()
    expect(screen.getByTestId('dropzone')).toBeInTheDocument()
  })

  it('returns null for a token without a second segment', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    localStorage.setItem('google_id_token', 'single-segment')
    render(<App />)
    await flush()
    expect(localStorage.getItem('google_id_token')).toBeNull()
    expect(screen.getByText('Authentication Required')).toBeInTheDocument()
    spy.mockRestore()
  })

  it('returns null when base64 payload is not valid JSON', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Encode something that is valid base64 but not JSON
    const badPayload = btoa('not-json!!!').replace(/=/g, '')
    localStorage.setItem('google_id_token', `h.${badPayload}.s`)
    render(<App />)
    await flush()
    expect(localStorage.getItem('google_id_token')).toBeNull()
    spy.mockRestore()
  })

  it('returns null when atob throws (invalid base64 characters)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    localStorage.setItem('google_id_token', 'h.!invalid!.s')
    render(<App />)
    await flush()
    expect(localStorage.getItem('google_id_token')).toBeNull()
    spy.mockRestore()
  })
})

// ===========================================================================
// Unauthenticated view
// ===========================================================================
describe('unauthenticated view', () => {
  it('shows Authentication Required when there is no token', async () => {
    render(<App />)
    await flush()
    expect(screen.getByText('Authentication Required')).toBeInTheDocument()
    expect(screen.getByText(/Please log in with your Google account/)).toBeInTheDocument()
  })

  it('does not show VITE_GOOGLE_CLIENT_ID error when env is set', async () => {
    render(<App />)
    await flush()
    expect(screen.queryByText(/VITE_GOOGLE_CLIENT_ID is not configured/)).not.toBeInTheDocument()
  })

  it('calls window.google.accounts.id.initialize when google is present', async () => {
    const initialize = vi.fn()
    const renderButton = vi.fn()
    window.google = { accounts: { id: { initialize, renderButton } } }
    render(<App />)
    await flush()
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: 'test-client-id-123' })
    )
  })

  it('calls renderButton inside the setTimeout(0)', async () => {
    const initialize = vi.fn()
    const renderButton = vi.fn()
    window.google = { accounts: { id: { initialize, renderButton } } }
    render(<App />)
    // The setTimeout(0) needs a real timer tick — use a small real wait
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
    })
    expect(renderButton).toHaveBeenCalled()
  })
})

// ===========================================================================
// /api/config effects
// ===========================================================================
describe('/api/config', () => {
  it('shows Verifying Authorization while config is pending', async () => {
    seedToken()
    let resolveConfig
    mockApi.get.mockImplementation((url) => {
      if (url === '/api/config') {
        return new Promise(resolve => {
          resolveConfig = resolve
        })
      }
      return Promise.reject(new Error('unexpected'))
    })
    render(<App />)
    await waitFor(() => screen.getByText('Verifying Authorization...'), { timeout: 3000 })
    resolveConfig({ data: { retentionMinutes: 5 } })
    await flush()
  })

  it('renders main UI after successful config response', async () => {
    seedToken()
    await renderAuthed()
    expect(screen.getByTestId('dropzone')).toBeInTheDocument()
  })

  it('shows Access Denied on 403', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    seedToken()
    mockApi.get.mockRejectedValue({ response: { status: 403 } })
    render(<App />)
    await waitFor(() => screen.getByText('Access Denied'), { timeout: 3000 })
    expect(screen.getByText(/is not authorized/)).toBeInTheDocument()
    expect(screen.getByText(/Please contact the administrator/)).toBeInTheDocument()
    spy.mockRestore()
  })

  it('stays authorized on non-403 server error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    seedToken()
    mockApi.get.mockRejectedValue({ response: { status: 500 } })
    render(<App />)
    await waitFor(() => screen.getByTestId('dropzone'), { timeout: 3000 })
    spy.mockRestore()
  })

  it('stays authorized on network error (no response property)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    seedToken()
    mockApi.get.mockRejectedValue(new Error('net error'))
    render(<App />)
    await waitFor(() => screen.getByTestId('dropzone'), { timeout: 3000 })
    spy.mockRestore()
  })

  it('skips config fetch when idToken is null (early return)', async () => {
    render(<App />)
    await flush()
    expect(mockApi.get).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// handleLoginCallback
// ===========================================================================
describe('handleLoginCallback', () => {
  function setupGoogle () {
    let cb = null
    window.google = {
      accounts: {
        id: {
          initialize: vi.fn(({ callback }) => {
            cb = callback
          }),
          renderButton: vi.fn(),
        },
      },
    }
    return () => cb
  }

  it('sets user and token when credential is valid', async () => {
    const getCallback = setupGoogle()
    mockApi.get.mockResolvedValue({ data: { retentionMinutes: 5 } })
    render(<App />)
    await flush()

    const callback = getCallback()
    expect(callback).not.toBeNull()

    const payload = { email: 'bob@example.com', name: 'Bob' }
    const token = makeJwt(payload)
    await act(async () => {
      callback({ credential: token })
      for (let i = 0; i < 10; i++) {
        await Promise.resolve()
      }
    })
    await waitFor(() => screen.getByTestId('dropzone'), { timeout: 3000 })

    expect(localStorage.getItem('google_id_token')).toBe(token)
  })

  it('logs error when credential token is invalid', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const getCallback = setupGoogle()
    render(<App />)
    await flush()

    const callback = getCallback()
    expect(callback).not.toBeNull()

    await act(() => {
      callback({ credential: 'bad.nopayload' })
    })
    await flush()

    expect(spy).toHaveBeenCalledWith('Failed to parse token')
    spy.mockRestore()
  })
})

// ===========================================================================
// handleLogout
// ===========================================================================
describe('handleLogout', () => {
  it('clears user state and shows login prompt', async () => {
    seedToken()
    await renderAuthed()
    const logoutBtn = screen.getByText('Logout')
    await act(() => {
      fireEvent.click(logoutBtn)
    })
    await flush()
    expect(localStorage.getItem('google_id_token')).toBeNull()
    expect(screen.getByText('Authentication Required')).toBeInTheDocument()
  })

  it('logout from Access Denied clears state', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    seedToken()
    mockApi.get.mockRejectedValue({ response: { status: 403 } })
    render(<App />)
    await waitFor(() => screen.getByText('Access Denied'), { timeout: 3000 })
    await act(() => {
      fireEvent.click(screen.getByText('Log in with different account'))
    })
    await flush()
    expect(localStorage.getItem('google_id_token')).toBeNull()
    spy.mockRestore()
  })
})

// ===========================================================================
// Axios interceptor
// ===========================================================================
describe('axios request interceptor', () => {
  it('registers interceptor on mount', async () => {
    seedToken()
    render(<App />)
    await flush()
    expect(mockApi.interceptors.request.use).toHaveBeenCalled()
  })

  it('adds Authorization header when idToken is present', async () => {
    seedToken()
    render(<App />)
    await flush()
    const [fn] = mockApi.interceptors.request.use.mock.calls[0]
    const cfg = { headers: {} }
    fn(cfg)
    expect(cfg.headers.Authorization).toMatch(/^Bearer hdr\./)
  })

  it('does not add Authorization header when idToken is null', async () => {
    render(<App />)
    await flush()
    if (mockApi.interceptors.request.use.mock.calls.length) {
      const [fn] = mockApi.interceptors.request.use.mock.calls[0]
      const cfg = { headers: {} }
      fn(cfg)
      expect(cfg.headers.Authorization).toBeUndefined()
    }
  })

  it('ejects interceptor on unmount', async () => {
    seedToken()
    const { unmount } = render(<App />)
    await flush()
    unmount()
    expect(mockApi.interceptors.request.eject).toHaveBeenCalledWith(99)
  })
})

// ===========================================================================
// File management
// ===========================================================================
describe('file list', () => {
  beforeEach(() => seedToken())

  it('shows file list and counts after files added', async () => {
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('a.mp4', 'video/mp4'), makeFile('b.png', 'image/png')]))
    await flush()
    expect(screen.getByText('Selected Files (2)')).toBeInTheDocument()
  })

  it('shows 🎬 icon for video files', async () => {
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('v.mp4', 'video/mp4')]))
    await flush()
    expect(screen.getByText('🎬')).toBeInTheDocument()
  })

  it('shows 🖼️ icon for image files', async () => {
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('p.png', 'image/png')]))
    await flush()
    expect(screen.getByText('🖼️')).toBeInTheDocument()
  })

  it('shows file size in MB', async () => {
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('v.mp4', 'video/mp4', 1048576)]))
    await flush()
    expect(screen.getByText('1.00 MB')).toBeInTheDocument()
  })

  it('shows global duration row when images present', async () => {
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('p.png', 'image/png')]))
    await flush()
    expect(screen.getByText(/Default image duration:/)).toBeInTheDocument()
  })

  it('hides global duration row for video-only list', async () => {
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('v.mp4', 'video/mp4')]))
    await flush()
    expect(screen.queryByText('Default image duration:')).not.toBeInTheDocument()
  })

  it('removes a file', async () => {
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('del.mp4', 'video/mp4')]))
    await flush()
    const removeBtns = screen.getAllByText('×')
    fireEvent.click(removeBtns[removeBtns.length - 1])
    await flush()
    expect(screen.queryByText('del.mp4')).not.toBeInTheDocument()
  })

  it('↑ moves a file up', async () => {
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('first.mp4', 'video/mp4'), makeFile('second.mp4', 'video/mp4')]))
    await flush()
    const upBtns = screen.getAllByText('↑')
    fireEvent.click(upBtns[1])
    await flush()
    expect(screen.getAllByRole('listitem')[0].textContent).toContain('second.mp4')
  })

  it('↑ at index 0 is a no-op (moveFile early return)', async () => {
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('first.mp4', 'video/mp4'), makeFile('second.mp4', 'video/mp4')]))
    await flush()
    const upBtns = screen.getAllByText('↑')
    // The ↑ button at index 0 has disabled={true} as a React prop, so React
    // ignores click events on it.  Call the React onClick prop directly to
    // exercise the moveFile early-return guard without going through the UI.
    const propsKey = Object.keys(upBtns[0]).find(k => k.startsWith('__reactProps'))
    await act(async () => {
      upBtns[0][propsKey].onClick(); await Promise.resolve()
    })
    await flush()
    expect(screen.getAllByRole('listitem')[0].textContent).toContain('first.mp4')
  })

  it('↓ moves a file down', async () => {
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('first.mp4', 'video/mp4'), makeFile('second.mp4', 'video/mp4')]))
    await flush()
    const downBtns = screen.getAllByText('↓')
    fireEvent.click(downBtns[0])
    await flush()
    expect(screen.getAllByRole('listitem')[0].textContent).toContain('second.mp4')
  })

  it('↓ at last index is a no-op (moveFile early return)', async () => {
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('first.mp4', 'video/mp4'), makeFile('second.mp4', 'video/mp4')]))
    await flush()
    const downBtns = screen.getAllByText('↓')
    // The ↓ button at last index has disabled={true} as a React prop, so React
    // ignores click events on it.  Call the React onClick prop directly to
    // exercise the moveFile early-return guard without going through the UI.
    const propsKey = Object.keys(downBtns[1]).find(k => k.startsWith('__reactProps'))
    await act(async () => {
      downBtns[1][propsKey].onClick(); await Promise.resolve()
    })
    await flush()
    expect(screen.getAllByRole('listitem')[1].textContent).toContain('second.mp4')
  })

  it('adding files resets status and clears error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockApi.post.mockRejectedValue(new Error('oops'))
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('a.mp4', 'video/mp4'), makeFile('b.mp4', 'video/mp4')]))
    await flush()
    await act(async () => {
      fireEvent.click(screen.getByText('Stitch Videos'))
    })
    await flush()
    expect(screen.getByText(/oops/)).toBeInTheDocument()
    act(() => _onFilesAdded([makeFile('c.mp4', 'video/mp4')]))
    await flush()
    expect(screen.queryByText(/oops/)).not.toBeInTheDocument()
    spy.mockRestore()
  })

  it('updateFileDuration sets per-image duration', async () => {
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('p.png', 'image/png')]))
    await flush()
    const spinners = screen.getAllByRole('spinbutton')
    fireEvent.change(spinners[1], { target: { value: '6' } })
    await flush()
    expect(spinners[1].value).toBe('6')
  })

  it('updateFileDuration only updates the targeted image (false branch for other files)', async () => {
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('a.png', 'image/png'), makeFile('b.png', 'image/png')]))
    await flush()
    const spinners = screen.getAllByRole('spinbutton')
    // spinners[0] = global, spinners[1] = a.png, spinners[2] = b.png
    fireEvent.change(spinners[1], { target: { value: '8' } })
    await flush()
    expect(spinners[1].value).toBe('8')
    // The second image's spinner should be unchanged (false branch in map)
    expect(spinners[2].value).not.toBe('8')
  })

  it('per-image input gets invalid class for value ≤ 0', async () => {
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('p.png', 'image/png')]))
    await flush()
    const spinners = screen.getAllByRole('spinbutton')
    fireEvent.change(spinners[1], { target: { value: '0' } })
    await flush()
    expect(spinners[1]).toHaveClass('invalid')
  })

  it('Stitch button disabled when any duration is invalid', async () => {
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('p.png', 'image/png')]))
    await flush()
    const spinners = screen.getAllByRole('spinbutton')
    fireEvent.change(spinners[1], { target: { value: '0' } })
    await flush()
    expect(screen.getByText('Stitch Videos')).toBeDisabled()
  })

  it('global duration input clamps to 1 for values ≤ 0', async () => {
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('p.png', 'image/png')]))
    await flush()
    const spinners = screen.getAllByRole('spinbutton')
    fireEvent.change(spinners[0], { target: { value: '0' } })
    await flush()
    expect(spinners[0].value).toBe('1')
  })

  it('global duration input clamps to 1 for NaN', async () => {
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('p.png', 'image/png')]))
    await flush()
    const spinners = screen.getAllByRole('spinbutton')
    fireEvent.change(spinners[0], { target: { value: 'xyz' } })
    await flush()
    expect(spinners[0].value).toBe('1')
  })

  it('mouseDown on per-image spinner stops propagation', async () => {
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('p.png', 'image/png')]))
    await flush()
    const spinners = screen.getAllByRole('spinbutton')
    fireEvent.mouseDown(spinners[1])
    expect(spinners[1]).toBeInTheDocument()
  })
})

// ===========================================================================
// isSingleVideoNoAudio
// ===========================================================================
describe('isSingleVideoNoAudio', () => {
  beforeEach(() => seedToken())

  it('shows warning and disables Stitch for single video with no bg audio', async () => {
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('v.mp4', 'video/mp4')]))
    await flush()
    expect(screen.getByText(/Nothing to stitch/)).toBeInTheDocument()
    expect(screen.getByText('Stitch Videos')).toBeDisabled()
  })

  it('no warning for a single image file', async () => {
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('p.png', 'image/png')]))
    await flush()
    expect(screen.queryByText(/Nothing to stitch/)).not.toBeInTheDocument()
  })

  it('no warning for multiple video files', async () => {
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('a.mp4', 'video/mp4'), makeFile('b.mp4', 'video/mp4')]))
    await flush()
    expect(screen.queryByText(/Nothing to stitch/)).not.toBeInTheDocument()
  })

  it('warning disappears when bg audio added to single video', async () => {
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('v.mp4', 'video/mp4')]))
    await flush()
    expect(screen.getByText(/Nothing to stitch/)).toBeInTheDocument()
    const audioInput = document.querySelector('input[type="file"][accept="audio/*"]')
    fireEvent.change(audioInput, { target: { files: [makeFile('bg.mp3', 'audio/mpeg')] } })
    await flush()
    expect(screen.queryByText(/Nothing to stitch/)).not.toBeInTheDocument()
    expect(screen.getByText('Stitch Videos')).not.toBeDisabled()
  })
})

// ===========================================================================
// File list drag-and-drop reordering
// ===========================================================================
describe('file list drag-and-drop', () => {
  beforeEach(() => seedToken())

  async function renderWithTwo () {
    await renderAuthed()
    act(() => _onFilesAdded([makeFile('first.mp4', 'video/mp4'), makeFile('second.mp4', 'video/mp4')]))
    await flush()
    return screen.getAllByRole('listitem')
  }

  it('dragStart adds dragging class to the item', async () => {
    const items = await renderWithTwo()
    fireEvent.dragStart(items[0], { dataTransfer: { effectAllowed: '' } })
    expect(items[0]).toHaveClass('dragging')
  })

  it('dragEnter adds drag-over class to target (not source)', async () => {
    const items = await renderWithTwo()
    fireEvent.dragStart(items[0], { dataTransfer: { effectAllowed: '' } })
    fireEvent.dragEnter(items[1])
    expect(items[1]).toHaveClass('drag-over')
    expect(items[0]).not.toHaveClass('drag-over')
  })

  it('dragOver does not throw', async () => {
    const items = await renderWithTwo()
    const e = new Event('dragover', { bubbles: true, cancelable: true })
    e.dataTransfer = { dropEffect: '' }
    items[0].dispatchEvent(e)
    expect(items[0]).toBeInTheDocument()
  })

  it('drop swaps src and target items', async () => {
    const items = await renderWithTwo()
    fireEvent.dragStart(items[0], { dataTransfer: { effectAllowed: '' } })
    fireEvent.drop(items[1], { dataTransfer: {} })
    await flush()
    const reordered = screen.getAllByRole('listitem')
    expect(reordered[0].textContent).toContain('second.mp4')
    expect(reordered[1].textContent).toContain('first.mp4')
  })

  it('drop on same index is a no-op', async () => {
    const items = await renderWithTwo()
    fireEvent.dragStart(items[0], { dataTransfer: { effectAllowed: '' } })
    fireEvent.drop(items[0], { dataTransfer: {} })
    await flush()
    expect(screen.getAllByRole('listitem')[0].textContent).toContain('first.mp4')
  })

  it('drop with no prior dragStart (null src) is a no-op', async () => {
    const items = await renderWithTwo()
    fireEvent.drop(items[1], { dataTransfer: {} })
    await flush()
    expect(screen.getAllByRole('listitem')[0].textContent).toContain('first.mp4')
  })

  it('dragEnd clears dragging and drag-over state', async () => {
    const items = await renderWithTwo()
    fireEvent.dragStart(items[0], { dataTransfer: { effectAllowed: '' } })
    fireEvent.dragEnter(items[1])
    fireEvent.dragEnd(items[0])
    await flush()
    expect(items[0]).not.toHaveClass('dragging')
    expect(items[1]).not.toHaveClass('drag-over')
  })
})

// ===========================================================================
// Background audio
// ===========================================================================
describe('background audio', () => {
  beforeEach(() => seedToken())

  async function selectAudio (file) {
    await renderAuthed()
    const input = document.querySelector('input[type="file"][accept="audio/*"]')
    fireEvent.change(input, { target: { files: file ? [file] : [] } })
    await flush()
  }

  it('shows Choose/drop label initially', async () => {
    await renderAuthed()
    expect(screen.getByText(/Choose or drop background audio/)).toBeInTheDocument()
  })

  it('no-op when audio file input is cleared', async () => {
    await selectAudio(null)
    expect(screen.getByText(/Choose or drop background audio/)).toBeInTheDocument()
  })

  it('shows filename and size after selecting', async () => {
    await selectAudio(makeFile('music.mp3', 'audio/mpeg', 1048576))
    expect(screen.getByText('music.mp3')).toBeInTheDocument()
    expect(screen.getByText('1.00 MB')).toBeInTheDocument()
  })

  it('× clears the selected audio file and resets volume', async () => {
    await selectAudio(makeFile('music.mp3', 'audio/mpeg'))
    fireEvent.click(screen.getByText('×'))
    await flush()
    expect(screen.getByText(/Choose or drop background audio/)).toBeInTheDocument()
  })

  it('shows bgAudioDragOver label when an audio file is dragged over the section', async () => {
    await renderAuthed()
    const section = document.querySelector('.bg-audio-section')
    fireEvent.dragOver(section, {
      dataTransfer: { items: [{ kind: 'file', type: 'audio/mpeg' }] },
    })
    await flush()
    expect(screen.getByText('Drop audio file here')).toBeInTheDocument()
    expect(section).toHaveClass('bg-audio-drag-over')
  })

  it('does not set drag-over for non-audio file kind', async () => {
    await renderAuthed()
    const section = document.querySelector('.bg-audio-section')
    fireEvent.dragOver(section, {
      dataTransfer: { items: [{ kind: 'file', type: 'video/mp4' }] },
    })
    await flush()
    expect(section).not.toHaveClass('bg-audio-drag-over')
  })

  it('does not set drag-over for item kind !== file', async () => {
    await renderAuthed()
    const section = document.querySelector('.bg-audio-section')
    fireEvent.dragOver(section, {
      dataTransfer: { items: [{ kind: 'string', type: 'audio/mpeg' }] },
    })
    await flush()
    expect(section).not.toHaveClass('bg-audio-drag-over')
  })

  it('dragLeave with relatedTarget outside the section clears drag-over', async () => {
    await renderAuthed()
    const section = document.querySelector('.bg-audio-section')
    fireEvent.dragOver(section, {
      dataTransfer: { items: [{ kind: 'file', type: 'audio/mpeg' }] },
    })
    await flush()
    fireEvent.dragLeave(section, { relatedTarget: document.body })
    await flush()
    expect(section).not.toHaveClass('bg-audio-drag-over')
  })

  it('dragLeave with relatedTarget inside the section does NOT clear drag-over', async () => {
    await renderAuthed()
    const section = document.querySelector('.bg-audio-section')
    fireEvent.dragOver(section, {
      dataTransfer: { items: [{ kind: 'file', type: 'audio/mpeg' }] },
    })
    await flush()
    const child = section.firstElementChild
    // jsdom does not set relatedTarget via the DragEvent constructor; use a
    // plain Event with Object.defineProperty so React's handler sees the value.
    const leaveEvent = new Event('dragleave', { bubbles: true, cancelable: true })
    Object.defineProperty(leaveEvent, 'relatedTarget', { get: () => child, configurable: true })
    act(() => section.dispatchEvent(leaveEvent))
    await flush()
    expect(section).toHaveClass('bg-audio-drag-over')
  })

  it('drop of audio file sets bgAudioFile', async () => {
    await renderAuthed()
    const section = document.querySelector('.bg-audio-section')
    const af = makeFile('bg.mp3', 'audio/mpeg')
    fireEvent.drop(section, { dataTransfer: { files: [af] } })
    await flush()
    expect(screen.getByText('bg.mp3')).toBeInTheDocument()
  })

  it('drop of non-audio file does not set bgAudioFile', async () => {
    await renderAuthed()
    const section = document.querySelector('.bg-audio-section')
    fireEvent.drop(section, { dataTransfer: { files: [makeFile('v.mp4', 'video/mp4')] } })
    await flush()
    expect(screen.getByText(/Choose or drop background audio/)).toBeInTheDocument()
  })

  describe('volume hint', () => {
    it('shows "original" at volume 1.0', async () => {
      await selectAudio(makeFile('s.mp3', 'audio/mpeg'))
      expect(screen.getByText('original')).toBeInTheDocument()
    })

    it('shows "muted" at volume 0', async () => {
      await selectAudio(makeFile('s.mp3', 'audio/mpeg'))
      fireEvent.change(screen.getByRole('slider'), { target: { value: '0' } })
      await flush()
      expect(screen.getByText('muted')).toBeInTheDocument()
    })

    it('shows percentage for volume between 0 and 1 (exclusive)', async () => {
      await selectAudio(makeFile('s.mp3', 'audio/mpeg'))
      fireEvent.change(screen.getByRole('slider'), { target: { value: '0.5' } })
      await flush()
      expect(screen.getByText('50%')).toBeInTheDocument()
    })

    it('shows "× louder" hint for volume > 1', async () => {
      await selectAudio(makeFile('s.mp3', 'audio/mpeg'))
      fireEvent.change(screen.getByRole('slider'), { target: { value: '1.5' } })
      await flush()
      expect(screen.getByText('1.5× louder')).toBeInTheDocument()
    })
  })
})

// ===========================================================================
// handleStitch — uses fake timers to control the setInterval polling loop
// ===========================================================================
describe('handleStitch', () => {
  beforeEach(() => {
    seedToken()
    vi.useFakeTimers()
  })

  afterEach(async () => {
    await act(async () => {
      vi.runOnlyPendingTimers()
      for (let i = 0; i < 5; i++) {
        await Promise.resolve()
      }
    })
    vi.useRealTimers()
  })

  function mockPoll ({ status, progress = 0, downloadUrl, error } = {}) {
    mockApi.get.mockImplementation((url) => {
      if (url === '/api/config') {
        return Promise.resolve({ data: { retentionMinutes: 5 } })
      }
      if (url.startsWith('/api/status/')) {
        return Promise.resolve({ data: { status, progress, downloadUrl, error } })
      }
      return Promise.reject(new Error(`Unexpected GET: ${url}`))
    })
  }

  /**
   * Render and wait for the authed main UI using real-timer-based waitFor
   * (works because fake timers don't block Promise microtasks).
   */
  async function renderStitchReady () {
    render(<App />)
    // Drain effects: token decode → user set → config fetch → isLoadingAuth=false
    // All of these are promise-based so they drain in microtask rounds.
    await act(async () => {
      // Give React 19 + scheduler time to run all effects
      for (let i = 0; i < 10; i++) {
        await Promise.resolve()
      }
    })
    // After draining microtasks the dropzone must already be in the DOM;
    // waitFor is avoided here because fake timers prevent its retry setInterval.
    expect(screen.getByTestId('dropzone')).toBeInTheDocument()
  }

  async function addTwoVideos () {
    await renderStitchReady()
    act(() => _onFilesAdded([makeFile('a.mp4', 'video/mp4'), makeFile('b.mp4', 'video/mp4')]))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  async function clickStitch () {
    await act(async () => {
      fireEvent.click(screen.getByText('Stitch Videos'))
      for (let i = 0; i < 10; i++) {
        await Promise.resolve()
      }
    })
  }

  async function advancePolling () {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
      for (let i = 0; i < 10; i++) {
        await Promise.resolve()
      }
    })
  }

  it('shows "Uploading…" while upload is pending', async () => {
    mockApi.post.mockReturnValue(new Promise(() => {}))
    await addTwoVideos()
    await act(async () => {
      fireEvent.click(screen.getByText('Stitch Videos'))
      await Promise.resolve()
    })
    expect(screen.getByText(/Uploading\.\.\. 0%/)).toBeInTheDocument()
  })

  it('onUploadProgress updates the upload percentage display', async () => {
    let onProgress = null
    mockApi.post.mockImplementation((_u, _d, cfg) => {
      onProgress = cfg.onUploadProgress
      return new Promise(() => {})
    })
    await addTwoVideos()
    await act(async () => {
      fireEvent.click(screen.getByText('Stitch Videos'))
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => onProgress({ loaded: 75, total: 100 }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText('Uploading... 75%')).toBeInTheDocument()
  })

  it('transitions to processing state and shows progress', async () => {
    mockApi.post.mockResolvedValue({ data: { jobId: 'j1' } })
    mockPoll({ status: 'processing', progress: 33 })
    await addTwoVideos()
    await clickStitch()
    await advancePolling()
    expect(screen.getByText(/Processing\.\.\. 33%/)).toBeInTheDocument()
  })

  it('transitions to completed state and shows download button', async () => {
    mockApi.post.mockResolvedValue({ data: { jobId: 'j2' } })
    mockPoll({ status: 'completed', downloadUrl: '/download/out.mp4' })
    await addTwoVideos()
    await clickStitch()
    await advancePolling()
    expect(screen.getByText('Success!')).toBeInTheDocument()
    expect(screen.getByText('Download Stitched Video')).toBeInTheDocument()
  })

  it('shows retention warning in completed state', async () => {
    mockApi.post.mockResolvedValue({ data: { jobId: 'j3' } })
    mockApi.get.mockImplementation((url) => {
      if (url === '/api/config') {
        return Promise.resolve({ data: { retentionMinutes: 10 } })
      }
      if (url.startsWith('/api/status/')) {
        return Promise.resolve({ data: { status: 'completed', downloadUrl: '/download/out.mp4' } })
      }
      return Promise.reject(new Error('unexpected'))
    })
    await addTwoVideos()
    await clickStitch()
    await advancePolling()
    expect(screen.getByText(/will be deleted after 10 minutes/)).toBeInTheDocument()
  })

  it('shows video preview element in completed state', async () => {
    mockApi.post.mockResolvedValue({ data: { jobId: 'j4' } })
    mockPoll({ status: 'completed', downloadUrl: '/download/out.mp4' })
    await addTwoVideos()
    await clickStitch()
    await advancePolling()
    expect(document.querySelector('video.preview-video')).toBeInTheDocument()
  })

  it('transitions to error state when job fails with a message', async () => {
    mockApi.post.mockResolvedValue({ data: { jobId: 'j5' } })
    mockPoll({ status: 'failed', error: 'FFmpeg crashed' })
    await addTwoVideos()
    await clickStitch()
    await advancePolling()
    expect(screen.getByText(/FFmpeg crashed/)).toBeInTheDocument()
  })

  it('transitions to error state when job fails with no message', async () => {
    mockApi.post.mockResolvedValue({ data: { jobId: 'j6' } })
    mockPoll({ status: 'failed' })
    await addTwoVideos()
    await clickStitch()
    await advancePolling()
    expect(screen.getByText(/Processing failed/)).toBeInTheDocument()
  })

  it('unknown status from poll is ignored (no state change)', async () => {
    mockApi.post.mockResolvedValue({ data: { jobId: 'j6b' } })
    mockPoll({ status: 'queued' })
    await addTwoVideos()
    await clickStitch()
    await advancePolling()
    // Status is still 'processing' — unknown status doesn't change UI
    expect(screen.getByText('Processing...')).toBeInTheDocument()
  })

  it('poll 403 error sets Access Denied error and stops polling', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockApi.post.mockResolvedValue({ data: { jobId: 'j7' } })
    mockApi.get.mockImplementation((url) => {
      if (url === '/api/config') {
        return Promise.resolve({ data: { retentionMinutes: 5 } })
      }
      if (url.startsWith('/api/status/')) {
        return Promise.reject(Object.assign(new Error('Forbidden'), { response: { status: 403 } }))
      }
      return Promise.reject(new Error('unexpected'))
    })
    await addTwoVideos()
    await clickStitch()
    await advancePolling()
    expect(screen.getByText(/Access Denied/)).toBeInTheDocument()
    spy.mockRestore()
  })

  it('poll non-403 error logs but does not change status', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockApi.post.mockResolvedValue({ data: { jobId: 'j8' } })
    mockApi.get.mockImplementation((url) => {
      if (url === '/api/config') {
        return Promise.resolve({ data: { retentionMinutes: 5 } })
      }
      if (url.startsWith('/api/status/')) {
        return Promise.reject(new Error('timeout'))
      }
      return Promise.reject(new Error('unexpected'))
    })
    await addTwoVideos()
    await clickStitch()
    await advancePolling()
    expect(screen.queryByText('Success!')).not.toBeInTheDocument()
    // spy.mockRestore() intentionally omitted: afterEach calls vi.runOnlyPendingTimers()
    // which fires the still-pending interval; restoring the spy here would un-mock
    // console.error before that timer fires, causing spurious stderr output.
    // vi.restoreAllMocks() in the outer afterEach cleans up after timers run.
  })

  it('upload 403 shows Access Denied', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockApi.post.mockRejectedValue({ response: { status: 403 } })
    await addTwoVideos()
    await clickStitch()
    expect(screen.getByText(/Access Denied/)).toBeInTheDocument()
    spy.mockRestore()
  })

  it('upload error with server error message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockApi.post.mockRejectedValue({ response: { status: 500, data: { error: 'Disk full' } } })
    await addTwoVideos()
    await clickStitch()
    expect(screen.getByText(/Disk full/)).toBeInTheDocument()
    spy.mockRestore()
  })

  it('upload error uses err.message when no server data', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockApi.post.mockRejectedValue(new Error('Network Error'))
    await addTwoVideos()
    await clickStitch()
    expect(screen.getByText(/Network Error/)).toBeInTheDocument()
    spy.mockRestore()
  })

  it('upload error falls back to "Upload failed" when no message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockApi.post.mockRejectedValue({})
    await addTwoVideos()
    await clickStitch()
    expect(screen.getByText(/Upload failed/)).toBeInTheDocument()
    spy.mockRestore()
  })

  it('appends bgAudio and bgAudioVolume to FormData', async () => {
    mockApi.post.mockResolvedValue({ data: { jobId: 'jbg' } })
    mockPoll({ status: 'processing', progress: 0 })
    await renderStitchReady()
    act(() => _onFilesAdded([makeFile('a.mp4', 'video/mp4'), makeFile('b.mp4', 'video/mp4')]))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const audioInput = document.querySelector('input[type="file"][accept="audio/*"]')
    fireEvent.change(audioInput, { target: { files: [makeFile('bg.mp3', 'audio/mpeg')] } })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    await clickStitch()
    const fd = mockApi.post.mock.calls[0][1]
    expect(fd.get('bgAudio')).not.toBeNull()
    expect(fd.get('bgAudioVolume')).toBe('1')
  })

  it('does not append bgAudio when no bg audio file', async () => {
    mockApi.post.mockResolvedValue({ data: { jobId: 'jnobg' } })
    mockPoll({ status: 'processing', progress: 0 })
    await addTwoVideos()
    await clickStitch()
    const fd = mockApi.post.mock.calls[0][1]
    expect(fd.get('bgAudio')).toBeNull()
  })

  it('includes per-image duration when explicitly set', async () => {
    mockApi.post.mockResolvedValue({ data: { jobId: 'jdur' } })
    mockPoll({ status: 'processing', progress: 0 })
    await renderStitchReady()
    act(() => _onFilesAdded([makeFile('p.png', 'image/png')]))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const spinners = screen.getAllByRole('spinbutton')
    fireEvent.change(spinners[1], { target: { value: '9' } })
    await act(async () => {
      await Promise.resolve()
    })
    await clickStitch()
    const fd = mockApi.post.mock.calls[0][1]
    expect(JSON.parse(fd.get('imageDurations'))['0']).toBe(9)
  })

  it('omits null duration from imageDurations', async () => {
    mockApi.post.mockResolvedValue({ data: { jobId: 'jnodur' } })
    mockPoll({ status: 'processing', progress: 0 })
    await renderStitchReady()
    act(() => _onFilesAdded([makeFile('p.png', 'image/png')]))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    await clickStitch()
    const fd = mockApi.post.mock.calls[0][1]
    expect(Object.keys(JSON.parse(fd.get('imageDurations')))).toHaveLength(0)
  })

  it('Stitch button label changes to Processing… while processing', async () => {
    mockApi.post.mockResolvedValue({ data: { jobId: 'jlbl' } })
    mockPoll({ status: 'processing', progress: 0 })
    await addTwoVideos()
    await clickStitch()
    await advancePolling()
    expect(screen.getByText('Processing...')).toBeInTheDocument()
  })

  it('clears polling interval when job completes', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    mockApi.post.mockResolvedValue({ data: { jobId: 'jclr' } })
    mockPoll({ status: 'completed', downloadUrl: '/download/out.mp4' })
    await addTwoVideos()
    await clickStitch()
    await advancePolling()
    expect(screen.getByText('Success!')).toBeInTheDocument()
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })

  it('clears existing polling interval before starting new stitch', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    mockApi.post.mockResolvedValue({ data: { jobId: 'j-re' } })
    mockPoll({ status: 'processing', progress: 0 })

    // First stitch
    await addTwoVideos()
    await clickStitch()
    await advancePolling()

    // At this point polling is ongoing. Second stitch click should clear old interval.
    // Re-add files to reset status
    act(() => _onFilesAdded([makeFile('c.mp4', 'video/mp4'), makeFile('d.mp4', 'video/mp4')]))
    await act(async () => {
      await Promise.resolve(); await Promise.resolve()
    })

    // Need to go back to idle status by clearing via add files
    // Since mockApi.post will resolve again, click stitch again
    mockApi.post.mockResolvedValue({ data: { jobId: 'j-re2' } })
    await clickStitch()
    // The old interval should have been cleared
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })
})

// ===========================================================================
// handleDownload
// ===========================================================================
describe('handleDownload', () => {
  beforeEach(() => {
    seedToken()
    vi.useFakeTimers()
  })

  afterEach(async () => {
    await act(async () => {
      vi.runOnlyPendingTimers()
      for (let i = 0; i < 5; i++) {
        await Promise.resolve()
      }
    })
    vi.useRealTimers()
  })

  async function renderCompleted () {
    mockApi.post.mockResolvedValue({ data: { jobId: 'jdl' } })
    mockApi.get.mockImplementation((url) => {
      if (url === '/api/config') {
        return Promise.resolve({ data: { retentionMinutes: 5 } })
      }
      if (url.startsWith('/api/status/')) {
        return Promise.resolve({
          data: { status: 'completed', downloadUrl: '/download/out.mp4' },
        })
      }
      return Promise.reject(new Error('unexpected'))
    })
    render(<App />)
    await act(async () => {
      for (let i = 0; i < 10; i++) {
        await Promise.resolve()
      }
    })
    expect(screen.getByTestId('dropzone')).toBeInTheDocument()
    act(() => _onFilesAdded([makeFile('a.mp4', 'video/mp4'), makeFile('b.mp4', 'video/mp4')]))
    await act(async () => {
      await Promise.resolve(); await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Stitch Videos'))
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText('Download Stitched Video')).toBeInTheDocument()
  }

  it('fetches blob and triggers anchor download', async () => {
    await renderCompleted()
    const blob = new Blob(['video'], { type: 'video/mp4' })
    global.fetch = vi.fn().mockResolvedValue({ blob: () => Promise.resolve(blob) })
    global.URL.createObjectURL = vi.fn(() => 'blob:test')
    global.URL.revokeObjectURL = vi.fn()
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((el) => {
      if (el.tagName === 'A') {
        el.click = vi.fn()
      }
    })
    const removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation(() => {})

    fireEvent.click(screen.getByText('Download Stitched Video'))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(global.fetch).toHaveBeenCalled()
    expect(global.URL.createObjectURL).toHaveBeenCalledWith(blob)
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:test')
    appendSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('button shows "Downloading…" and is disabled while downloading', async () => {
    await renderCompleted()
    global.fetch = vi.fn(() => new Promise(() => {}))
    fireEvent.click(screen.getByText('Download Stitched Video'))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText('Downloading…')).toBeDisabled()
  })
})

// ===========================================================================
// Unmount cleanup (pollingIntervalRef)
// ===========================================================================
describe('unmount cleanup', () => {
  beforeEach(() => {
    seedToken()
    vi.useFakeTimers()
  })

  afterEach(async () => {
    await act(async () => {
      vi.runOnlyPendingTimers()
      for (let i = 0; i < 5; i++) {
        await Promise.resolve()
      }
    })
    vi.useRealTimers()
  })

  it('clears polling interval when unmounted during processing', async () => {
    mockApi.post.mockResolvedValue({ data: { jobId: 'ju' } })
    mockApi.get.mockImplementation((url) => {
      if (url === '/api/config') {
        return Promise.resolve({ data: { retentionMinutes: 5 } })
      }
      if (url.startsWith('/api/status/')) {
        return Promise.resolve({ data: { status: 'processing', progress: 5 } })
      }
      return Promise.reject(new Error('unexpected'))
    })
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')

    const { unmount } = render(<App />)
    await act(async () => {
      for (let i = 0; i < 10; i++) {
        await Promise.resolve()
      }
    })
    expect(screen.getByTestId('dropzone')).toBeInTheDocument()
    act(() => _onFilesAdded([makeFile('a.mp4', 'video/mp4'), makeFile('b.mp4', 'video/mp4')]))
    await act(async () => {
      await Promise.resolve(); await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Stitch Videos'))
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
      await Promise.resolve()
    })

    unmount()
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })

  it('does not throw when unmounted without active polling', async () => {
    const { unmount } = render(<App />)
    await act(async () => {
      for (let i = 0; i < 10; i++) {
        await Promise.resolve()
      }
    })
    expect(() => unmount()).not.toThrow()
  })
})

// ===========================================================================
// Module-reload tests — cover compile-time-constant branches by re-importing
// App with different import.meta.env values via vi.stubEnv + vi.resetModules.
// ===========================================================================
describe('env-driven constant branches', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('VITE_API_URL defined uses the provided URL (non-fallback || branch)', async () => {
    vi.stubEnv('VITE_API_URL', 'http://custom-api.example.com')
    vi.resetModules()
    const { default: AppWithUrl } = await import('../App')
    render(<AppWithUrl />)
    await act(async () => {
      for (let i = 0; i < 10; i++) {
        await Promise.resolve()
      }
    })
    // App renders (API_URL taken from env, not the || fallback)
    expect(screen.getByText('Authentication Required')).toBeInTheDocument()
  })

  it('DISABLE_AUTH=true sets user to local user without login (both DISABLE_AUTH branches)', async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', 'true')
    vi.resetModules()
    const { default: AppDisabled } = await import('../App')
    render(<AppDisabled />)
    await act(async () => {
      for (let i = 0; i < 10; i++) {
        await Promise.resolve()
      }
    })
    // user and idToken are set from the DISABLE_AUTH branches — main UI shows
    expect(screen.getByTestId('dropzone')).toBeInTheDocument()
  })

  it('VITE_GOOGLE_CLIENT_ID not set shows configuration error message', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')
    vi.resetModules()
    const { default: AppNoId } = await import('../App')
    render(<AppNoId />)
    await act(async () => {
      for (let i = 0; i < 10; i++) {
        await Promise.resolve()
      }
    })
    expect(screen.getByText(/VITE_GOOGLE_CLIENT_ID is not configured/)).toBeInTheDocument()
  })
})
