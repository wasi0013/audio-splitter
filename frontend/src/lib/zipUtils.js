import JSZip from 'jszip'

/**
 * Create a ZIP file from audio segments
 * @param {Array} segments - Array of {name, data} objects
 * @param {string} folderName - Name of folder inside ZIP
 * @returns {Promise<Blob>} ZIP file blob
 */
export async function createZipFromSegments(segments, folderName) {
  const zip = new JSZip()

  // Create folder in ZIP
  const folder = zip.folder(folderName)

  // Add all segments to the folder
  for (const segment of segments) {
    folder.file(segment.name, segment.data)
  }

  // Generate ZIP blob
  const zipBlob = await zip.generateAsync({ type: 'blob' })
  return zipBlob
}

/**
 * Download a blob as a file
 * @param {Blob} blob - File blob to download
 * @param {string} fileName - Name of the downloaded file
 */
export function downloadFile(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
