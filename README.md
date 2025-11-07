# Audio Splitter

A minimal, elegant audio splicing tool for MP3 files. Load an MP3, place markers at split points, and download lossless audio segments with a single click.

## Features

✨ **Core Functionality**

- 📁 Upload single MP3 or bulk upload entire folders
- 📊 Visual waveform with click-to-place markers
- ✏️ Editable marker timestamps for precise control
- 🎵 Real-time preview of audio segments
- ✂️ Lossless audio splitting using FFmpeg
- 📦 Auto-packaged segments in ZIP format
- 🎨 Modern, professional UI with smooth interactions

## Why?

I built this tool to solve a specific need for my another project [Murajah](https://github.com/wasi0013/murajah/). I use this primarily for splitting long Qur’anic recitations of full Juz’ and Surahs into clean, verse‑by‑verse segments. I wanted a workflow that was precise, and lossless. Since, Murajah focuses on structured memorization and review, it is important to make the split accurate.

  >**Project link**: <https://github.com/wasi0013/murajah>

Initially tried with AI models, however the output was clumsy, and sometime with awkward marker placement due to reciter's repition or subtle recitation styles.  
This project aims to keep things simple: load an MP3, place markers, fine‑tune timestamps down to milliseconds, preview segments, and export without re‑encoding. It preserves the original audio quality from my favorite reciters.

## Installation

### Prerequisites

- Node.js 18+
- FFmpeg installed: `brew install ffmpeg`

### Setup

1. Install dependencies:

```bash
npm install
```

This installs dependencies for both frontend and backend via npm workspaces.

### Running

#### Terminal 1 - Backend

```bash
cd backend
npm run dev
```

#### Terminal 2 - Frontend

```bash
cd frontend
npm run dev
```

Frontend runs on `http://localhost:5174`
Backend runs on `http://localhost:3001`

### Build

Frontend:

```bash
cd frontend && npm run build
```

Backend doesn't need building (ES modules).

---

## How to Use (Step-by-Step)

### Step 1: Load Your Audio

1. Click the **"📁 Single File"** button to upload a single MP3 file
2. **OR** click **"📂 Bulk Folder"** to bulk upload multiple MP3s from a folder
3. The waveform will display once the file loads
4. Audio player controls appear below the waveform

### Step 2: Place Markers

You have two ways to add markers:

#### Method A: Click on the Waveform

- Click anywhere on the waveform to place a marker at that position
- Markers appear as numbered points on the timeline.
- I usually mark the places where the wave has drop of energy. This placement are almost accurate for most cases. 
- If the placements are slightly off, I modify the markers using the marker fields.

#### Method B: Use the Add Marker Button

- Play the audio, listen attentively.
- Press the **"+ Add Marker"** button to mark the desired playback position realtime.
- Useful while listening to recitation to mark points in real-time with minimal effort.

### Step 3: Fine-Tune Marker Positions

1. Look at the **"Markers"** section below the waveform
2. Each marker shows a number and an **editable timestamp field**
3. Click on the numbers of the timestamp to select the numbers and then replace it
4. Accepted formats:
   - `H:MM:SS.ms` (e.g., `0:01:23.456`) - Full precision with milliseconds
   - to replace `23` select and highlight `23` then type your preferred value.
5. The audio automatically seeks to the new position
6. Markers auto-sort by time
7. Click **"Remove"** to delete a marker

### Step 4: Preview Segments

1. The **"Segments"** section shows how your audio will be split:
   - **Segment 1**: From start (0:00) to first marker
   - **Segment 2+**: Between consecutive markers
   - **Last Segment**: From last marker to end
2. Hover over any segment to see its time range
3. Click on a segment number to preview it (audio plays just that portion)
4. The preview status shows: `Playing: Segment X (start → end)`

### Step 5: Split the Audio

1. Click the **"Split (X)"** button (shows the number of segments that will be created)
2. Processing starts - button shows "Processing..." state
3. Once complete, a ZIP file automatically downloads containing:
   - Numbered audio files: `originalfilename000.mp3`, `originalfilename001.mp3`, etc.
   - Folder structure matching your input (for bulk uploads)
   - Lossless quality preserved (codec copy, no re-encoding)

### Step 6: Download & Use

- All segments are automatically downloaded as `audio-segments.zip`
- Extract the ZIP to access individual MP3 files
- Each segment file is named: `[originalname][3-digit-number].mp3`
  - Example: `podcast000.mp3`, `podcast001.mp3`, `podcast002.mp3`
- Each segment is lossless (no quality loss from the original)
- Files are numbered sequentially starting from 000

---

## Efficient Tips & Tricks

### For Precise Timing

- Use the editable timestamp fields for frame-accurate control
- Copy-paste timestamps if you need to match multiple markers
- Use preview to verify segment boundaries before splitting

### For Bulk Operations

- Upload entire folders to process multiple files at once
- Select which file to edit using the dropdown
- All settings reset when you switch files

### For Large Files

- The waveform may take a moment to render for large audio files
- Marker placement is instant once waveform loads
- Processing time depends on file size (large files take longer)

### Keyboard Shortcuts

- Use Tab to move between marker timestamp fields
- Click outside the input or press Enter to confirm changes

---

## Tech Stack

### Frontend

- React 18
- Vite 5 (lightning-fast dev server)
- WaveSurfer.js 7.7 (waveform visualization)
- Modern CSS with gradients and smooth animations

### Backend

- Node.js
- Express 4.18.2
- Multer (file upload handling)
- FFmpeg (audio processing)
- Archiver (ZIP packaging)

### Architecture

- Monorepo with npm workspaces
- Separate frontend and backend
- Lossless audio processing (codec copy)
- RESTful API

---

## Project Structure

```bash
audio-splitter/
├── frontend/                 # React app (Vite)
│   ├── src/
│   │   ├── App.jsx          # Main component
│   │   ├── App.css          # Modern styling
│   │   ├── Waveform.jsx     # WaveSurfer wrapper
│   │   └── main.jsx         # Entry point
│   └── package.json
├── backend/                  # Express server
│   ├── src/
│   │   └── index.js         # API server
│   └── package.json
├── package.json             # Workspace config
└── README.md
```

---

## Troubleshooting

### No waveform appears after upload

- Ensure file is a valid MP3
- Check browser console for errors
- Try a different MP3 file

### Markers not updating

- Ensure timestamp format is correct
- Clear browser cache and reload

### Split fails

- Ensure FFmpeg is installed: `brew install ffmpeg`
- Check that backend is running on port 3001
- Try with a smaller file first

### Download doesn't start

- Check browser download settings
- Try a different browser if stuck

---

## License

[GNU General Public License v3.0](/LICENSE)

