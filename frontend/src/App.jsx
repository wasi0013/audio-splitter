import { useState, useRef, useEffect } from 'react'
import { Waveform } from './Waveform'
import { initFFmpeg, splitAudio, isFFmpegReady } from './lib/ffmpegProcessor'
import { createZipFromSegments, downloadFile } from './lib/zipUtils'
import './App.css'

function App() {
  const [audioFile, setAudioFile] = useState(null)
  const [audioUrl, setAudioUrl] = useState(null)
  const [markers, setMarkers] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [previewSegment, setPreviewSegment] = useState(null)
  const [ffmpegStatus, setFFmpegStatus] = useState('Loading FFmpeg...')
  const [ffmpegInitialized, setFFmpegInitialized] = useState(false)
  const [progress, setProgress] = useState(null)
  const [namingConfig, setNamingConfig] = useState({
    prependText: '',
    prependCounter: '',
    prependCounterDigits: 3,
    name: '',
    appendText: '',
    appendCounter: '0',
    appendCounterDigits: 3,
  })
  const audioRef = useRef(null)
  const waveSurferRef = useRef(null)
  const previousAudioUrlRef = useRef(null)

  // Initialize FFmpeg on component mount
  useEffect(() => {
    const initializeFFmpeg = async () => {
      try {
        setFFmpegStatus('Initializing FFmpeg...')
        await initFFmpeg((progressUpdate) => {
          console.log('Progress:', progressUpdate)
        })
        setFFmpegInitialized(true)
        setFFmpegStatus('Ready')
      } catch (error) {
        console.error('Failed to initialize FFmpeg:', error)
        setFFmpegStatus(`Error: ${error.message}`)
      }
    }

    initializeFFmpeg()
  }, [])

  // Generate a storage key for the current audio file
  const getStorageKey = (file) => {
    if (!file) return null
    return `audio-splitter-markers:${file.name}:${file.size}`
  }

  // Save markers to localStorage whenever they change
  useEffect(() => {
    const key = getStorageKey(audioFile)
    if (!key) return
    if (markers.length === 0) {
      localStorage.removeItem(key)
    } else {
      try {
        localStorage.setItem(key, JSON.stringify(markers))
      } catch (e) {
        console.warn('Failed to save markers to localStorage:', e)
      }
    }
  }, [markers, audioFile])

  // Update audio element when URL changes
  useEffect(() => {
    if (audioRef.current && audioUrl) {
      audioRef.current.src = audioUrl
      audioRef.current.load()
    }
  }, [audioUrl])

  // Revoke old blob URL after new one is loaded
  useEffect(() => {
    // Revoke the previous blob URL after a small delay to ensure it's no longer needed
    if (previousAudioUrlRef.current && previousAudioUrlRef.current !== audioUrl) {
      setTimeout(() => {
        URL.revokeObjectURL(previousAudioUrlRef.current)
      }, 100)
    }
    // Update the ref to current URL
    previousAudioUrlRef.current = audioUrl
  }, [audioUrl])

  // Cleanup audio resources on component unmount
  useEffect(() => {
    return () => {
      // Revoke the current blob URL
      if (previousAudioUrlRef.current) {
        URL.revokeObjectURL(previousAudioUrlRef.current)
      }
      // Stop audio playback
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.currentTime = 0
      }
    }
  }, [])

  // Check if file is an audio file
  const isAudioFile = (file) => {
    const audioMimeTypes = [
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave',
      'audio/ogg', 'audio/flac', 'audio/aac', 'audio/x-aac',
      'audio/m4a', 'audio/mp4', 'audio/x-m4a'
    ]
    const audioExtensions = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.mp4']
    
    return audioMimeTypes.includes(file.type) || 
           audioExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
  }

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0]
    if (file && isAudioFile(file)) {
      // Stop audio playback before loading new file
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.currentTime = 0
        // Hard reset the media element to drop any stale source
        try {
          audioRef.current.removeAttribute('src')
        } catch (__) {}
        audioRef.current.load()
      }

      // Clear preview state
      setPreviewSegment(null)

      // Load new file (old blob URL will be revoked automatically by useEffect)
      const nextUrl = URL.createObjectURL(file)
      setAudioFile(file)
      setAudioUrl(nextUrl)

      // Restore markers from localStorage if available
      const key = getStorageKey(file)
      if (key) {
        try {
          const saved = localStorage.getItem(key)
          if (saved) {
            const restored = JSON.parse(saved)
            if (Array.isArray(restored) && restored.length > 0) {
              setMarkers(restored)
            } else {
              setMarkers([])
            }
          } else {
            setMarkers([])
          }
        } catch (e) {
          console.warn('Failed to restore markers from localStorage:', e)
          setMarkers([])
        }
      } else {
        setMarkers([])
      }
      
      // Reset file input to allow loading same file again
      e.target.value = ''
    } else if (file) {
      alert('Please select a valid audio file (MP3, WAV, OGG, FLAC, AAC, M4A)')
      // Reset file input
      e.target.value = ''
    }
  }

  const handleWaveformReady = (waveSurfer) => {
    waveSurferRef.current = waveSurfer
  }

  const handleWaveformClick = (time) => {
    addMarker(time)
  }

  const addMarker = (time) => {
    const newMarker = {
      id: Date.now(),
      time: time
    }
    setMarkers([...markers, newMarker].sort((a, b) => a.time - b.time))
  }

  const handleAddMarker = () => {
    if (!waveSurferRef.current) return
    const currentTime = waveSurferRef.current.getCurrentTime()
    addMarker(currentTime)
  }

  const handleRemoveMarker = (id) => {
    setMarkers(markers.filter(m => m.id !== id))
  }

  const isPreviewingRef = useRef(false)

  const handlePreviewSegment = async (segmentIndex) => {
    if (!waveSurferRef.current || isPreviewingRef.current) {
      return
    }
    
    const sortedMarkers = markers.map(m => m.time).sort((a, b) => a - b)
    let startTime, endTime
    
    if (segmentIndex === 0) {
      // First segment: 0 to first marker
      startTime = 0
      endTime = sortedMarkers.length > 0 ? sortedMarkers[0] : waveSurferRef.current.getDuration()
    } else if (segmentIndex <= sortedMarkers.length) {
      // Middle segments
      startTime = sortedMarkers[segmentIndex - 1]
      endTime = segmentIndex < sortedMarkers.length ? sortedMarkers[segmentIndex] : waveSurferRef.current.getDuration()
    } else {
      return
    }

    isPreviewingRef.current = true

    // Pause any current playback first
    try {
      waveSurferRef.current.pause()
    } catch (e) { /* ignore */ }

    setPreviewSegment({ startTime, endTime, segmentIndex })
    
    const duration = waveSurferRef.current.getDuration()
    const seekRatio = startTime / duration
    
    // Seek to start position
    waveSurferRef.current.seekTo(seekRatio)
    
    // Small delay to ensure seek is applied before play
    setTimeout(() => {
      if (!waveSurferRef.current) {
        isPreviewingRef.current = false
        return
      }
      try {
        const playPromise = waveSurferRef.current.play()
        if (playPromise !== undefined) {
          playPromise.catch(err => {
            console.error('Play failed:', err)
          }).finally(() => {
            isPreviewingRef.current = false
          })
        } else {
          isPreviewingRef.current = false
        }
      } catch (e) {
        isPreviewingRef.current = false
      }
    }, 100)
  }

  const handleSeek = (seconds) => {
    if (!waveSurferRef.current) return
    waveSurferRef.current.skip(seconds)
  }

  const handleSplit = async () => {
    if (!audioFile || markers.length === 0) {
      alert('Load audio and add markers')
      return
    }

    if (!ffmpegInitialized) {
      alert('FFmpeg is still loading. Please wait.')
      return
    }

    setIsLoading(true)
    setProgress({ status: 'Starting...', current: 0, total: 0 })
    
    try {
      const markerTimes = markers.map(m => m.time)
      
      console.log('Starting audio split with markers:', markerTimes)
      setProgress({ status: 'Processing audio segments...' })

      // Split audio using FFmpeg
      const segments = await splitAudio(audioFile, markerTimes, (update) => {
        setProgress(update)
        console.log('Split progress:', update)
      })

      // Rename segments using naming config
      segments.forEach((seg, i) => {
        seg.name = generateSegmentName(i)
      })

      setProgress({ status: 'Creating ZIP file...' })

      // Create ZIP with segments
      const baseFileName = audioFile.name.replace(/\.[^.]+$/, '')
      const zipBlob = await createZipFromSegments(segments, baseFileName)

      setProgress({ status: 'Downloading...' })

      // Download the ZIP file
      downloadFile(zipBlob, `${baseFileName}.zip`)

      setProgress({ status: 'Complete!' })
      setTimeout(() => setProgress(null), 2000)

      console.log('Split completed successfully')
    } catch (error) {
      console.error('Split error:', error)
      setProgress(null)
      alert('Error: ' + error.message)
    } finally {
      setIsLoading(false)
    }
  }

  const getFileExtension = () => {
    if (!audioFile) return '.mp3'
    const match = audioFile.name.match(/\.[^.]+$/)
    return match ? match[0] : '.mp3'
  }

  const generateSegmentName = (index) => {
    const ext = getFileExtension()
    const parts = []
    parts.push(namingConfig.prependText)
    if (namingConfig.prependCounter !== '') {
      const counterVal = (parseInt(namingConfig.prependCounter, 10) || 0) + index
      parts.push(String(counterVal).padStart(namingConfig.prependCounterDigits, '0'))
    }
    const baseName = namingConfig.name || (audioFile ? audioFile.name.replace(/\.[^.]+$/, '') : 'segment')
    parts.push(baseName)
    parts.push(namingConfig.appendText)
    if (namingConfig.appendCounter !== '') {
      const counterVal = (parseInt(namingConfig.appendCounter, 10) || 0) + index
      parts.push(String(counterVal).padStart(namingConfig.appendCounterDigits, '0'))
    }
    return parts.join('') + ext
  }

  const updateNamingField = (field, value) => {
    setNamingConfig(prev => ({ ...prev, [field]: value }))
  }

  const formatTime = (seconds) => {
    if (!seconds) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const formatTimeForInput = (seconds) => {
    if (!seconds) return '0:00:00'
    const hrs = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 1000)
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`
  }

  const parseTimeInput = (timeStr) => {
    // Parse format: H:MM:SS.ms or MM:SS or MM:SS.ms
    const parts = timeStr.trim().split(':')
    if (parts.length < 2 || parts.length > 3) return null
    
    try {
      let totalSeconds = 0
      
      if (parts.length === 2) {
        // MM:SS.ms format
        const [minPart, secPart] = parts
        const mins = parseInt(minPart)
        const [secsStr, msStr] = secPart.split('.')
        const secs = parseInt(secsStr)
        const ms = msStr ? parseInt(msStr.padEnd(3, '0').substring(0, 3)) : 0
        totalSeconds = mins * 60 + secs + ms / 1000
      } else {
        // H:MM:SS.ms format
        const [hrPart, minPart, secPart] = parts
        const hrs = parseInt(hrPart)
        const mins = parseInt(minPart)
        const [secsStr, msStr] = secPart.split('.')
        const secs = parseInt(secsStr)
        const ms = msStr ? parseInt(msStr.padEnd(3, '0').substring(0, 3)) : 0
        totalSeconds = hrs * 3600 + mins * 60 + secs + ms / 1000
      }
      
      return totalSeconds >= 0 ? totalSeconds : null
    } catch (e) {
      return null
    }
  }

  const handleUpdateMarkerTime = (markerId, newTimeStr) => {
    const newTime = parseTimeInput(newTimeStr)
    if (newTime !== null && newTime >= 0) {
      setMarkers(markers.map(m => 
        m.id === markerId ? { ...m, time: newTime } : m
      ).sort((a, b) => a.time - b.time))
      
      // Seek to new marker position for preview
      if (waveSurferRef.current) {
        waveSurferRef.current.seekTo(newTime / waveSurferRef.current.getDuration())
      }
    }
  }

  const handleExportTimestamps = () => {
    if (markers.length === 0) return
    const data = { markers: markers.map(m => ({ time: m.time })) }
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const baseName = audioFile ? audioFile.name.replace(/\.[^.]+$/, '') : 'timestamps'
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${baseName}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportTimestamps = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target.result)
        if (data.markers && Array.isArray(data.markers)) {
          const imported = data.markers
            .filter(m => typeof m.time === 'number' && m.time >= 0)
            .map(m => ({ id: Date.now() + Math.random(), time: m.time }))
            .sort((a, b) => a.time - b.time)
          if (imported.length > 0) {
            setMarkers(imported)
          } else {
            alert('No valid timestamps found in the file.')
          }
        } else {
          alert('Invalid timestamp file format.')
        }
      } catch {
        alert('Failed to parse JSON file.')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger shortcuts when typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return

      if (e.code === 'Space' && waveSurferRef.current) {
        e.preventDefault()
        waveSurferRef.current.playPause()
      } else if (e.code === 'KeyM' && waveSurferRef.current) {
        e.preventDefault()
        handleAddMarker()
      } else if (e.code === 'Escape' && previewSegment) {
        e.preventDefault()
        if (waveSurferRef.current) waveSurferRef.current.pause()
        setPreviewSegment(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [previewSegment])

  return (
    <div className="container">
      <header className="header">
        <h1>Audio Splitter</h1>
        <p className="subtitle">Load audio file (MP3, WAV, OGG, FLAC, AAC, M4A), place markers, split into segments</p>
        <div className="ffmpeg-status">
          {ffmpegInitialized ? (
            <span className="status-badge status-ready">✓ Ready</span>
          ) : (
            <span className="status-badge status-loading">⏳ {ffmpegStatus}</span>
          )}
        </div>
      </header>

      <section className="upload-section">
        <div className="upload-options">
          <label className="file-input-label">
            <input 
              type="file" 
              accept="audio/*"
              onChange={handleFileUpload}
              className="file-input"
            />
            <span className="file-input-text">
              🎵 Load Audio
            </span>
          </label>
        </div>

        {audioFile && (
          <p className="file-info">Loaded: {audioFile.name}</p>
        )}
      </section>

      {audioFile && (
        <>
          <section className="waveform-section">
            <div className="waveform-header">
              <h3>Timeline - Click to place markers</h3>
            </div>
            <Waveform 
              key={audioUrl || 'waveform-empty'}
              audioUrl={audioUrl}
              audioRef={audioRef}
              markers={markers}
              previewSegment={previewSegment}
              onReady={handleWaveformReady}
              onMarkerClick={handleWaveformClick}
              onPreviewEnd={() => setPreviewSegment(null)}
            />
            <div className="waveform-footer">
              <audio 
                key={audioUrl || 'audio-empty'}
                ref={audioRef}
                controls
                src={audioUrl}
                className="audio-player"
              />
              <div className="seek-buttons">
                <button onClick={() => handleSeek(-60)} className="btn btn-small btn-seek" title="Back 1 min">⏪ 1 min</button>
                <button onClick={() => handleSeek(-30)} className="btn btn-small btn-seek" title="Back 30s">⏪ 30s</button>
                <button onClick={() => handleSeek(-5)} className="btn btn-small btn-seek" title="Back 5s">⏪ 5s</button>
                <button onClick={() => handleSeek(5)} className="btn btn-small btn-seek" title="Forward 5s">5s ⏩</button>
                <button onClick={() => handleSeek(30)} className="btn btn-small btn-seek" title="Forward 30s">30s ⏩</button>
                <button onClick={() => handleSeek(60)} className="btn btn-small btn-seek" title="Forward 1 min">1 min ⏩</button>
              </div>
              <div className="footer-buttons">
                <button 
                  onClick={handleAddMarker}
                  className="btn btn-primary"
                >
                  + Add Marker
                </button>
                <button 
                  onClick={handleSplit}
                  disabled={isLoading || markers.length === 0 || !ffmpegInitialized}
                  className="btn btn-success"
                >
                  {isLoading ? `${progress?.status || 'Processing...'}` : `Split (${markers.length + 1})`}
                </button>
              </div>
              {progress && (
                <div className="progress-info">
                  <div className="progress-status">{progress.status}</div>
                  {progress.total > 0 && (
                    <div className="progress-bar">
                      <div 
                        className="progress-fill" 
                        style={{ width: `${(progress.current / progress.total) * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          <div className="markers-segments-columns">
          <section className="markers-section">
            <div className="markers-header">
              <h3>Markers ({markers.length})</h3>
              <div className="markers-actions">
                <button
                  onClick={handleExportTimestamps}
                  disabled={markers.length === 0}
                  className="btn btn-small btn-info"
                  title="Export timestamps to JSON"
                >
                  ⬇ Export
                </button>
                <label className="btn btn-small btn-info import-label" title="Import timestamps from JSON">
                  ⬆ Import
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleImportTimestamps}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>
            </div>
            {markers.length === 0 ? (
              <p className="empty-state">No markers yet. Click audio timeline or use Add Marker button.</p>
            ) : (
              <div className="markers-list">
                {markers.map((marker, idx) => (
                  <div key={marker.id} className="marker-item">
                    <span className="marker-number">#{idx + 1}</span>
                    <input 
                      type="text"
                      className="marker-time-input"
                      inputMode="decimal"
                      autoComplete="off"
                      value={formatTimeForInput(marker.time)}
                      onChange={(e) => handleUpdateMarkerTime(marker.id, e.target.value)}
                      placeholder="H:MM:SS.ms"
                      title="Edit marker time (H:MM:SS.ms or MM:SS.ms)"
                    />
                    <button 
                      onClick={() => handleRemoveMarker(marker.id)}
                      className="btn btn-small btn-danger"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="segments-section">
            <h3>Preview Segments</h3>
            <div className="segments-list">
              {markers.length === 0 ? (
                <p className="empty-state">Add markers to see segments</p>
              ) : (
                <>
                  {/* First segment: 0 to first marker */}
                  <div className="segment-item">
                    <span className="segment-label" title={generateSegmentName(0)}>{generateSegmentName(0)}</span>
                    <span className="segment-time">0:00 → {formatTime(markers[0].time)}</span>
                    <button
                      onClick={() => handlePreviewSegment(0)}
                      className="btn btn-small btn-info"
                    >
                      ▶ Preview
                    </button>
                  </div>

                  {/* Middle segments */}
                  {markers.map((marker, idx) => {
                    if (idx === markers.length - 1) return null // Skip last, it's handled below
                    const startTime = marker.time
                    const endTime = markers[idx + 1].time
                    return (
                      <div key={`seg-${idx + 1}`} className="segment-item">
                        <span className="segment-label" title={generateSegmentName(idx + 1)}>{generateSegmentName(idx + 1)}</span>
                        <span className="segment-time">{formatTime(startTime)} → {formatTime(endTime)}</span>
                        <button
                          onClick={() => handlePreviewSegment(idx + 1)}
                          className="btn btn-small btn-info"
                        >
                          ▶ Preview
                        </button>
                      </div>
                    )
                  })}

                  {/* Last segment */}
                  <div className="segment-item">
                    <span className="segment-label" title={generateSegmentName(markers.length)}>{generateSegmentName(markers.length)}</span>
                    <span className="segment-time">{formatTime(markers[markers.length - 1].time)} → End</span>
                    <button
                      onClick={() => handlePreviewSegment(markers.length)}
                      className="btn btn-small btn-info"
                    >
                      ▶ Preview
                    </button>
                  </div>
                </>
              )}
            </div>
            {previewSegment && (
              <div className="preview-info">
                Playing: Segment {previewSegment.segmentIndex + 1} ({formatTime(previewSegment.startTime)} → {formatTime(previewSegment.endTime)})
              </div>
            )}
          </section>
          </div>

          <section className="naming-section">
            <details>
              <summary>🏷️ Segment Naming</summary>
              <div className="naming-content">
                <div className="naming-preview">
                  <strong>Preview:</strong>{' '}
                  <code>{generateSegmentName(0)}</code>
                  {markers.length > 0 && (
                    <>
                      {' → ... → '}
                      <code>{generateSegmentName(markers.length)}</code>
                    </>
                  )}
                </div>
                <div className="naming-fields">
                  <div className="naming-group">
                    <h4>Prepend</h4>
                    <label>
                      Text
                      <input
                        type="text"
                        value={namingConfig.prependText}
                        onChange={(e) => updateNamingField('prependText', e.target.value)}
                        placeholder="e.g. page"
                      />
                    </label>
                    <label>
                      Counter Start
                      <input
                        type="text"
                        inputMode="numeric"
                        value={namingConfig.prependCounter}
                        onChange={(e) => updateNamingField('prependCounter', e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="empty = off"
                      />
                    </label>
                    <label>
                      Counter Digits
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={namingConfig.prependCounterDigits}
                        onChange={(e) => updateNamingField('prependCounterDigits', Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                      />
                    </label>
                  </div>
                  <div className="naming-group">
                    <h4>Base Name</h4>
                    <label>
                      Name
                      <input
                        type="text"
                        value={namingConfig.name}
                        onChange={(e) => updateNamingField('name', e.target.value)}
                        placeholder={audioFile ? audioFile.name.replace(/\.[^.]+$/, '') : 'filename'}
                      />
                    </label>
                  </div>
                  <div className="naming-group">
                    <h4>Append</h4>
                    <label>
                      Text
                      <input
                        type="text"
                        value={namingConfig.appendText}
                        onChange={(e) => updateNamingField('appendText', e.target.value)}
                        placeholder="e.g. _part"
                      />
                    </label>
                    <label>
                      Counter Start
                      <input
                        type="text"
                        inputMode="numeric"
                        value={namingConfig.appendCounter}
                        onChange={(e) => updateNamingField('appendCounter', e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="empty = off"
                      />
                    </label>
                    <label>
                      Counter Digits
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={namingConfig.appendCounterDigits}
                        onChange={(e) => updateNamingField('appendCounterDigits', Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                      />
                    </label>
                  </div>
                </div>
              </div>
            </details>
          </section>

        </>
      )}

      <section className="tutorial-section">
        <details>
          <summary>📖 Quick Tutorial</summary>
          <div className="tutorial-content">
            <img src="/audiosplitter.png" alt="Audio Splitter Overview" className="tutorial-image" />
            <div className="tutorial-step">
              <strong>1. Load Audio:</strong> Click "🎵 Load Audio" button to upload your audio file. Supports MP3, WAV, OGG, FLAC, AAC, M4A formats.
            </div>
            <div className="tutorial-step">
              <strong>2. Place Markers:</strong> Click directly on the waveform to place split points, or use the "+ Add Marker" button to mark the current playback position.
            </div>
            <div className="tutorial-step">
              <strong>3. Fine-Tune:</strong> Edit marker timestamps by clicking on the time values in the Markers section. Format: H:MM:SS.ms (e.g., 0:01:23.456)
            </div>
            <div className="tutorial-step">
              <strong>4. Preview:</strong> Click on any segment in the Segments section to hear a preview before splitting.
            </div>
            <div className="tutorial-step">
              <strong>5. Split & Download:</strong> Click the "Split" button to process all segments. A ZIP file will automatically download containing all segments.
            </div>
            <div className="tutorial-tip">
              💡 <strong>Tip:</strong> Processing happens in your browser - no uploads to servers. Audio quality is preserved (lossless codec copying).
            </div>
            <div className="tutorial-tip keyboard-shortcuts">
              ⌨️ <strong>Keyboard Shortcuts:</strong> <kbd>Space</kbd> Play/Pause · <kbd>M</kbd> Add Marker · <kbd>Esc</kbd> Stop Preview
            </div>
          </div>
        </details>
      </section>

      <footer className="app-footer">
        <div className="footer-content">
          <a href="https://github.com/wasi0013/audio-splitter" target="_blank" rel="noopener noreferrer" className="footer-link" title="View source code">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v 3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            GitHub
          </a>
        </div>
      </footer>
    </div>
  )
}

export default App
