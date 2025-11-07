import { useEffect, useRef } from 'react'
import WaveSurfer from 'wavesurfer.js'

export function Waveform({ audioUrl, audioRef, markers, previewSegment, onReady, onMarkerClick, onPreviewEnd }) {
  const containerRef = useRef(null)
  const waveSurferRef = useRef(null)
  const markersCanvasRef = useRef(null)
  const previewIntervalRef = useRef(null)

  useEffect(() => {
    if (!audioUrl || !containerRef.current) return

    const waveSurfer = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#cbd5e1',
      progressColor: '#3498db',
      barWidth: 2,
      barRadius: 2,
      barGap: 2,
      height: 150,
      normalize: true,
      responsive: true,
      cursorColor: '#e74c3c',
      cursorWidth: 2
    })

    waveSurfer.load(audioUrl)

    waveSurfer.on('ready', () => {
      waveSurferRef.current = waveSurfer
      if (onReady) onReady(waveSurfer)
    })

    waveSurfer.on('click', (relativeX) => {
      const duration = waveSurfer.getDuration()
      const clickedTime = relativeX * duration
      if (onMarkerClick) onMarkerClick(clickedTime)
    })

    // Sync wavesurfer playback with audio element
    waveSurfer.on('play', () => {
      if (audioRef?.current && audioRef.current.paused) {
        audioRef.current.play().catch(() => {})
      }
    })

    waveSurfer.on('pause', () => {
      if (audioRef?.current && !audioRef.current.paused) {
        audioRef.current.pause()
      }
    })

    // Update wavesurfer position when audio element time changes
    const handleTimeUpdate = () => {
      if (audioRef?.current && waveSurfer && !waveSurfer.isPlaying()) {
        const duration = waveSurfer.getDuration()
        if (duration > 0) {
          waveSurfer.seekTo(audioRef.current.currentTime / duration)
        }
      }
    }

    if (audioRef?.current) {
      audioRef.current.addEventListener('timeupdate', handleTimeUpdate)
    }

    return () => {
      if (audioRef?.current) {
        audioRef.current.removeEventListener('timeupdate', handleTimeUpdate)
      }
      try {
        waveSurfer.destroy()
      } catch (e) {
        // Ignore destroy errors in development
      }
    }
  }, [audioUrl, onReady, onMarkerClick, audioRef])

  // Monitor preview segment playback
  useEffect(() => {
    if (!previewSegment || !waveSurferRef.current) return

    const waveSurfer = waveSurferRef.current
    const checkPreviewEnd = () => {
      const currentTime = waveSurfer.getCurrentTime()
      if (currentTime >= previewSegment.endTime) {
        waveSurfer.pause()
        if (onPreviewEnd) onPreviewEnd()
      }
    }

    previewIntervalRef.current = setInterval(checkPreviewEnd, 50)

    return () => {
      if (previewIntervalRef.current) {
        clearInterval(previewIntervalRef.current)
      }
    }
  }, [previewSegment, onPreviewEnd])

  // Draw markers on canvas overlay
  useEffect(() => {
    if (!waveSurferRef.current || !markersCanvasRef.current || !markers?.length) return

    const waveSurfer = waveSurferRef.current
    const canvas = markersCanvasRef.current
    const duration = waveSurfer.getDuration()

    if (!duration) return

    const rect = canvas.parentElement.getBoundingClientRect()
    canvas.width = rect.width
    canvas.height = 150

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    markers.forEach((marker, idx) => {
      const x = (marker.time / duration) * canvas.width
      
      // Draw vertical line
      ctx.strokeStyle = `hsl(${(idx * 60) % 360}, 70%, 50%)`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, canvas.height)
      ctx.stroke()

      // Draw label
      ctx.fillStyle = `hsl(${(idx * 60) % 360}, 70%, 50%)`
      ctx.font = 'bold 12px sans-serif'
      ctx.fillText(`#${idx + 1}`, x + 5, 15)
    })
  }, [markers, waveSurferRef.current?.getDuration()])

  return (
    <div className="waveform-wrapper">
      <div ref={containerRef} className="waveform-canvas" />
      <canvas ref={markersCanvasRef} className="markers-overlay" />
    </div>
  )
}
