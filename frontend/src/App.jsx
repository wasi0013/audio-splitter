import { useState, useRef } from 'react'
import { Waveform } from './Waveform'
import './App.css'

function App() {
  const [audioFile, setAudioFile] = useState(null)
  const [audioUrl, setAudioUrl] = useState(null)
  const [markers, setMarkers] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [previewSegment, setPreviewSegment] = useState(null)
  const [bulkFiles, setBulkFiles] = useState([])
  const [selectedBulkFile, setSelectedBulkFile] = useState(null)
  const audioRef = useRef(null)
  const waveSurferRef = useRef(null)

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0]
    if (file && file.type === 'audio/mpeg') {
      setAudioFile(file)
      setAudioUrl(URL.createObjectURL(file))
      setMarkers([])
      setBulkFiles([])
      setSelectedBulkFile(null)
    }
  }

  const handleFolderUpload = (e) => {
    const files = Array.from(e.target.files || [])
    const mp3Files = files.filter(f => f.type === 'audio/mpeg' || f.name.endsWith('.mp3'))
    
    if (mp3Files.length > 0) {
      // Sort files alphabetically by name
      mp3Files.sort((a, b) => a.name.localeCompare(b.name))
      setBulkFiles(mp3Files)
      setSelectedBulkFile(null)
      setAudioFile(null)
      setAudioUrl(null)
      setMarkers([])
    } else {
      alert('No MP3 files found in selection')
    }
  }

  const handleSelectBulkFile = (file) => {
    setSelectedBulkFile(file)
    setAudioFile(file)
    setAudioUrl(URL.createObjectURL(file))
    setMarkers([])
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

  const handlePreviewSegment = (segmentIndex) => {
    if (!waveSurferRef.current) {
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

    setPreviewSegment({ startTime, endTime, segmentIndex })
    
    const duration = waveSurferRef.current.getDuration()
    const seekRatio = startTime / duration
    
    // Seek to start position
    waveSurferRef.current.seekTo(seekRatio)
    
    // Small delay to ensure seek is applied before play
    setTimeout(() => {
      const playPromise = waveSurferRef.current.play()
      if (playPromise !== undefined) {
        playPromise.catch(err => {
          console.error('Play failed:', err)
        })
      }
    }, 50)
  }

  const handleSplit = async () => {
    if (!audioFile || markers.length === 0) {
      alert('Load audio and add markers')
      return
    }

    setIsLoading(true)
    try {
      const formData = new FormData()
      formData.append('file', audioFile)
      formData.append('markers', JSON.stringify(markers.map(m => m.time)))

      console.log('Sending split request with markers:', markers.map(m => m.time))

      const response = await fetch('/api/split', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Split failed')
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'audio-segments.zip'
      a.click()
    } catch (error) {
      console.error('Split error:', error)
      alert('Error: ' + error.message)
    } finally {
      setIsLoading(false)
    }
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

  return (
    <div className="container">
      <header className="header">
        <h1>Audio Splitter</h1>
        <p className="subtitle">Load MP3, place markers, split into segments</p>
      </header>

      <section className="upload-section">
        <div className="upload-options">
          <label className="file-input-label">
            <input 
              type="file" 
              accept="audio/mpeg" 
              onChange={handleFileUpload}
              className="file-input"
            />
            <span className="file-input-text">
              📁 Single File
            </span>
          </label>

          <label className="file-input-label">
            <input 
              type="file" 
              webkitdirectory="true"
              mozdirectory="true"
              onChange={handleFolderUpload}
              className="file-input"
            />
            <span className="file-input-text">
              📂 Bulk Folder
            </span>
          </label>
        </div>

        {audioFile && !bulkFiles.length && (
          <p className="file-info">Loaded: {audioFile.name}</p>
        )}

        {bulkFiles.length > 0 && (
          <div className="bulk-selector">
            <label>Select file from folder:</label>
            <select 
              value={selectedBulkFile ? bulkFiles.indexOf(selectedBulkFile) : ''}
              onChange={(e) => {
                const idx = parseInt(e.target.value)
                handleSelectBulkFile(bulkFiles[idx])
              }}
              className="bulk-dropdown"
            >
              <option value="">-- Choose a file --</option>
              {bulkFiles.map((file, idx) => (
                <option key={idx} value={idx}>
                  {file.name}
                </option>
              ))}
            </select>
            <span className="bulk-count">({bulkFiles.length} files)</span>
          </div>
        )}
      </section>

      {audioFile && (
        <>
          <section className="waveform-section">
            <div className="waveform-header">
              <h3>Timeline - Click to place markers</h3>
            </div>
            <Waveform 
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
                ref={audioRef}
                controls
                src={audioUrl}
                className="audio-player"
              />
              <div className="footer-buttons">
                <button 
                  onClick={handleAddMarker}
                  className="btn btn-primary"
                >
                  + Add Marker
                </button>
                <button 
                  onClick={handleSplit}
                  disabled={isLoading || markers.length === 0}
                  className="btn btn-success"
                >
                  {isLoading ? 'Processing...' : `Split (${markers.length + 1})`}
                </button>
              </div>
            </div>
          </section>

          <section className="markers-section">
            <h3>Markers ({markers.length})</h3>
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
                    <span className="segment-label">Segment 000</span>
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
                        <span className="segment-label">Segment {String(idx + 1).padStart(3, '0')}</span>
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
                    <span className="segment-label">Segment {String(markers.length).padStart(3, '0')}</span>
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

        </>
      )}
    </div>
  )
}

export default App
