import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'

let ffmpeg = null
let ffmpegReady = false

/**
 * Initialize FFmpeg instance
 * @param {Function} onProgress - Callback for progress updates
 * @returns {Promise<FFmpeg>}
 */
export async function initFFmpeg(onProgress = null) {
  if (ffmpegReady) {
    return ffmpeg
  }

  try {
    ffmpeg = new FFmpeg()

    ffmpeg.on('log', ({ message }) => {
      console.log('[FFmpeg]', message)
    })

    ffmpeg.on('progress', ({ progress, time }) => {
      if (onProgress) {
        onProgress({ progress: Math.round(progress * 100), time })
      }
    })

    // Load FFmpeg core files from CDN
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm'
    
    // Create blob URLs for the core files
    const coreResponse = await fetch(`${baseURL}/ffmpeg-core.js`)
    const wasmResponse = await fetch(`${baseURL}/ffmpeg-core.wasm`)
    
    const coreBlob = await coreResponse.blob()
    const wasmBlob = await wasmResponse.blob()
    
    const coreURL = URL.createObjectURL(coreBlob)
    const wasmURL = URL.createObjectURL(wasmBlob)
    
    await ffmpeg.load({
      coreURL: coreURL,
      wasmURL: wasmURL,
    })

    ffmpegReady = true
    console.log('FFmpeg loaded successfully')
    return ffmpeg
  } catch (error) {
    console.error('Failed to initialize FFmpeg:', error)
    throw new Error(`FFmpeg initialization failed: ${error.message}`)
  }
}

/**
 * Split audio file into segments
 * @param {File} audioFile - Input MP3 file
 * @param {number[]} markers - Array of timestamps (in seconds) to split at
 * @param {Function} onProgress - Callback for progress updates
 * @returns {Promise<Uint8Array[]>} Array of segment data
 */
export async function splitAudio(audioFile, markers, onProgress = null) {
  if (!ffmpegReady || !ffmpeg) {
    throw new Error('FFmpeg not initialized. Call initFFmpeg first.')
  }

  try {
    const fileName = audioFile.name
    const inputName = `input_${Date.now()}.mp3`

    // Update progress
    if (onProgress) onProgress({ status: 'Loading file...' })

    // Write input file to FFmpeg virtual filesystem
    await ffmpeg.writeFile(inputName, await fetchFile(audioFile))

    // Get audio duration
    if (onProgress) onProgress({ status: 'Analyzing audio...' })

    // Sort markers and create time points
    const sortedMarkers = [...markers].sort((a, b) => a - b)
    const timePoints = [0, ...sortedMarkers]

    const segments = []
    const baseFileName = fileName.replace(/\.[^.]+$/, '') // Remove extension

    // Create each segment
    for (let i = 0; i < timePoints.length; i++) {
      const startTime = timePoints[i]
      const endTime = i + 1 < timePoints.length ? timePoints[i + 1] : null

      const segmentNum = String(i).padStart(3, '0')
      const outputName = `${baseFileName}${segmentNum}.mp3`

      if (onProgress) {
        onProgress({
          status: `Processing segment ${i + 1}/${timePoints.length}...`,
          current: i + 1,
          total: timePoints.length,
        })
      }

      // Build FFmpeg command
      const args = [
        '-i', inputName,
        '-ss', String(startTime),
      ]

      if (endTime !== null) {
        args.push('-to', String(endTime))
      }

      // Use copy codec for lossless splitting
      args.push(
        '-c', 'copy',
        '-y', // Overwrite output file
        outputName
      )

      // Execute FFmpeg command
      await ffmpeg.exec(args)

      // Read the output file
      const segmentData = await ffmpeg.readFile(outputName)
      segments.push({
        name: outputName,
        data: segmentData,
      })

      // Delete temporary output file
      await ffmpeg.deleteFile(outputName)
    }

    // Clean up input file
    await ffmpeg.deleteFile(inputName)

    if (onProgress) onProgress({ status: 'Done!' })

    return segments
  } catch (error) {
    console.error('Error splitting audio:', error)
    throw new Error(`Audio splitting failed: ${error.message}`)
  }
}

/**
 * Check if FFmpeg is initialized and ready
 * @returns {boolean}
 */
export function isFFmpegReady() {
  return ffmpegReady && ffmpeg !== null
}

/**
 * Get FFmpeg instance
 * @returns {FFmpeg|null}
 */
export function getFFmpeg() {
  return ffmpeg
}
