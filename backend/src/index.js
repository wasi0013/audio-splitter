import express from 'express'
import multer from 'multer'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = 3001

app.use(cors())
app.use(express.json())

const upload = multer({ dest: path.join(__dirname, '../temp') })

app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.post('/api/split', upload.single('file'), async (req, res) => {
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

    res.json({ message: 'Split endpoint working', markers: markersArray })
  } catch (error) {
    console.error('Split error:', error)
    res.status(500).json({ error: error.message })
  }
})

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`)
})
