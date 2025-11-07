import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import path from 'path'
import fs from 'fs'
import { promisify } from 'util'

const mkdir = promisify(fs.mkdir)
const unlink = promisify(fs.unlink)
const readdir = promisify(fs.readdir)

ffmpeg.setFfmpegPath(ffmpegStatic)

export async function splitAudio(inputPath, timestamps, outputDir) {
  try {
    await mkdir(outputDir, { recursive: true })

    const inputFileName = path.basename(inputPath, path.extname(inputPath))
    const segments = []

    // Create segments: 0-ts[0], ts[0]-ts[1], ..., ts[n]-end
    const timePoints = [0, ...timestamps]

    for (let i = 0; i < timePoints.length; i++) {
      const startTime = timePoints[i]
      const endTime = i + 1 < timePoints.length ? timePoints[i + 1] : null

      const segmentNum = i + 1
      const outputFileName = `${inputFileName}${String(segmentNum).padStart(3, '0')}.mp3`
      const outputPath = path.join(outputDir, outputFileName)

      await new Promise((resolve, reject) => {
        let cmd = ffmpeg(inputPath)
          .setStartTime(startTime)
          .audioCodec('libmp3lame')
          .audioBitrate('192k')

        if (endTime) {
          cmd = cmd.duration(endTime - startTime)
        }

        cmd
          .on('error', reject)
          .on('end', () => {
            segments.push({ name: outputFileName, path: outputPath })
            resolve()
          })
          .save(outputPath)
      })
    }

    return segments
  } catch (error) {
    throw new Error(`Audio split failed: ${error.message}`)
  }
}

export async function cleanupFiles(filePaths) {
  for (const filePath of filePaths) {
    try {
      await unlink(filePath)
    } catch (error) {
      console.error(`Failed to cleanup ${filePath}:`, error.message)
    }
  }
}

export async function cleanupDir(dirPath) {
  try {
    const files = await readdir(dirPath)
    for (const file of files) {
      const filePath = path.join(dirPath, file)
      await unlink(filePath)
    }
  } catch (error) {
    console.error(`Failed to cleanup directory ${dirPath}:`, error.message)
  }
}
