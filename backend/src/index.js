import express from 'express'
import multer from 'multer'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import archiver from 'archiver'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = 3001

ffmpeg.setFfmpegPath(ffmpegStatic)

app.use(cors())
app.use(express.json())

const upload = multer({ dest: path.join(__dirname, '../temp') })

app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

async function splitAudioFile(inputPath, timestamps, originalFileName) {
  const tempSegmentsDir = path.join(__dirname, '../temp', `segments-${Date.now()}`)
  
  try {
    fs.mkdirSync(tempSegmentsDir, { recursive: true })

    const inputFileName = path.basename(originalFileName, path.extname(originalFileName))
    const segments = []

    // Create segments: 0-ts[0], ts[0]-ts[1], ..., ts[n]-end
    const timePoints = [0, ...timestamps.sort((a, b) => a - b)]

    for (let i = 0; i < timePoints.length; i++) {
      const startTime = timePoints[i]
      const endTime = i + 1 < timePoints.length ? timePoints[i + 1] : null

      const segmentNum = i
      const outputFileName = `${inputFileName}${String(segmentNum).padStart(3, '0')}.mp3`
      const outputPath = path.join(tempSegmentsDir, outputFileName)

      await new Promise((resolve, reject) => {
        let cmd = ffmpeg(inputPath)
          .setStartTime(startTime)
          .audioCodec('copy')

        if (endTime) {
          cmd = cmd.duration(endTime - startTime)
        }

        cmd
          .on('error', reject)
          .on('end', () => {
            segments.push(outputPath)
            resolve()
          })
          .save(outputPath)
      })
    }

    return { segments, tempDir: tempSegmentsDir }
  } catch (error) {
    fs.rmSync(tempSegmentsDir, { recursive: true, force: true })
    throw error
  }
}

async function createZip(filePaths, outputPath, folderName) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath)
    const archive = archiver('zip', { zlib: { level: 9 } })

    output.on('close', () => resolve(outputPath))
    archive.on('error', reject)
    output.on('error', reject)

    archive.pipe(output)

    for (const filePath of filePaths) {
      const fileName = path.basename(filePath)
      const arcPath = folderName ? `${folderName}/${fileName}` : fileName
      archive.file(filePath, { name: arcPath })
    }

    archive.finalize()
  })
}

app.post('/api/split', upload.single('file'), async (req, res) => {
  let tempSegmentsDir = null
  let zipPath = null

  try {
    const { markers } = req.body
    const markersArray = markers ? JSON.parse(markers) : []

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    if (!Array.isArray(markersArray) || markersArray.length === 0) {
      return res.status(400).json({ error: 'No markers provided' })
    }

    console.log(`Processing ${req.file.originalname} with ${markersArray.length} markers`)

    // Split audio
    const { segments, tempDir } = await splitAudioFile(req.file.path, markersArray, req.file.originalname)
    tempSegmentsDir = tempDir

    console.log(`Created ${segments.length} segments`)

    // Get base filename without extension for ZIP and folder
    const baseFileName = path.basename(req.file.originalname, path.extname(req.file.originalname))
    
    // Create ZIP
    zipPath = path.join(__dirname, '../temp', `${baseFileName}-${Date.now()}.zip`)
    await createZip(segments, zipPath, baseFileName)

    console.log(`ZIP created at ${zipPath}`)

    // Send ZIP file
    res.download(zipPath, `${baseFileName}.zip`, (err) => {
      if (err) console.error('Download error:', err)
      
      // Cleanup
      fs.unlink(req.file.path, () => {})
      if (tempSegmentsDir) fs.rmSync(tempSegmentsDir, { recursive: true, force: true })
      if (zipPath) fs.unlink(zipPath, () => {})
    })
  } catch (error) {
    console.error('Split error:', error)
    
    // Cleanup on error
    if (req.file?.path) fs.unlink(req.file.path, () => {})
    if (tempSegmentsDir) fs.rmSync(tempSegmentsDir, { recursive: true, force: true })
    if (zipPath) fs.unlink(zipPath, () => {})

    res.status(500).json({ error: error.message })
  }
})

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`)
})
