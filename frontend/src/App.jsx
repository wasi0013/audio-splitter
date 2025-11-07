import { useState, useRef } from 'react'
import './App.css'

function App() {
  const [audioFile, setAudioFile] = useState(null)
  const [audioUrl, setAudioUrl] = useState(null)
  const [markers, setMarkers] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const audioRef = useRef(null)
  const waveformRef = useRef(null)

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0]
    if (file && file.type === 'audio/mpeg') {
      setAudioFile(file)
      setAudioUrl(URL.createObjectURL(file))
      setMarkers([])
    }
  }

  const handleAddMarker = () => {
    if (!audioRef.current) return
    const currentTime = audioRef.current.currentTime
    const newMarker = {
      id: Date.now(),
      time: currentTime
    }
    setMarkers([...markers, newMarker].sort((a, b) => a.time - b.time))
  }

  const handleRemoveMarker = (id) => {
    setMarkers(markers.filter(m => m.id !== id))
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

      const response = await fetch('/api/split', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) throw new Error('Split failed')
      
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'audio-segments.zip'
      a.click()
    } catch (error) {
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

  return (
    <div className="container">
      <header className="header">
        <h1>Audio Splitter</h1>
        <p className="subtitle">Load MP3, place markers, split into segments</p>
      </header>

      <section className="upload-section">
        <label className="file-input-label">
          <input 
            type="file" 
            accept="audio/mpeg" 
            onChange={handleFileUpload}
            className="file-input"
          />
          <span className="file-input-text">
            {audioFile ? audioFile.name : 'Click to load MP3'}
          </span>
        </label>
      </section>

      {audioFile && (
        <>
          <section className="player-section">
            <audio 
              ref={audioRef}
              controls
              src={audioUrl}
              className="audio-player"
            />
          </section>

          <section className="waveform-section">
            <div className="waveform-header">
              <h3>Timeline</h3>
              <button 
                onClick={handleAddMarker}
                className="btn btn-primary"
              >
                + Add Marker
              </button>
            </div>
            <div ref={waveformRef} className="waveform-container" />
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
                    <span className="marker-time">{formatTime(marker.time)}s</span>
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

          <section className="actions-section">
            <button 
              onClick={handleSplit}
              disabled={isLoading || markers.length === 0}
              className="btn btn-success btn-large"
            >
              {isLoading ? 'Processing...' : `Split into ${markers.length + 1} segments`}
            </button>
          </section>
        </>
      )}
    </div>
  )
}

export default App
