# Audio Splitter - Setup

## Installation

### Prerequisites
- Node.js 18+
- FFmpeg installed: `brew install ffmpeg`

### Setup

1. Install dependencies:
```bash
npm install
```

This installs dependencies for both frontend and backend via workspaces.

### Running

**Terminal 1 - Backend**
```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend**
```bash
cd frontend
npm run dev
```

Frontend runs on `http://localhost:5173`
Backend runs on `http://localhost:3001`

### Build

Frontend:
```bash
cd frontend && npm run build
```

Backend doesn't need building (ES modules).
