import archiver from 'archiver'
import fs from 'fs'
import path from 'path'

export async function createZip(filePaths, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath)
    const archive = archiver('zip', { zlib: { level: 9 } })

    output.on('close', () => resolve(outputPath))
    archive.on('error', reject)
    output.on('error', reject)

    archive.pipe(output)

    for (const filePath of filePaths) {
      archive.file(filePath, { name: path.basename(filePath) })
    }

    archive.finalize()
  })
}
