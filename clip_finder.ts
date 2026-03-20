import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const execFileAsync = promisify(execFile)

const __dirname = dirname(fileURLToPath(import.meta.url))
export const CACHE_DIR = join(__dirname, 'cache')
mkdirSync(CACHE_DIR, { recursive: true })

// Add ~/bin to PATH for ffmpeg
const homeBin = (process.env.HOME || '') + '/bin'
process.env.PATH = homeBin + ':' + (process.env.PATH || '')

export type ProgressCallback = (eventType: string, data: unknown) => void

export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export interface Transcript {
  video_id: string
  language: string
  segments: TranscriptSegment[]
  full_text: string
}

export interface Clip {
  id: string
  timestamp: number
  clip_start: number
  clip_end: number
  duration: number
  text: string
  context: string
  youtube_url: string
  embed_url: string
  clip_extract_url: string
}

export interface FindClipsResult {
  video_id: string
  video_url: string
  phrase: string
  total_segments: number
  clips_found: number
  clips: Clip[]
}

function getCachePath(videoId: string, suffix: string): string {
  return join(CACHE_DIR, `${videoId}${suffix}`)
}

export function extractVideoId(url: string): string {
  const patterns = [
    /(?:v=|\/v\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:shorts\/)([a-zA-Z0-9_-]{11})/,
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  // Assume it's already a video ID
  return url
}

export async function fetchTranscript(
  videoId: string,
  onProgress?: ProgressCallback
): Promise<Transcript> {
  const transcriptPath = getCachePath(videoId, '_yt_transcript.json')

  if (existsSync(transcriptPath)) {
    console.error('Using cached transcript')
    onProgress?.('status', { step: 'transcript', message: 'Using cached transcript' })
    const raw = readFileSync(transcriptPath, 'utf-8')
    return JSON.parse(raw) as Transcript
  }

  console.error('Fetching YouTube transcript...')
  onProgress?.('status', { step: 'transcript', message: 'Fetching YouTube transcript...' })

  // Shell out to python3 using youtube_transcript_api as the most reliable approach
  const script = `
import json, sys
from youtube_transcript_api import YouTubeTranscriptApi
api = YouTubeTranscriptApi()
fetched = api.fetch(sys.argv[1])
segments = []
for s in fetched.snippets:
    segments.append({"start": round(s.start, 2), "end": round(s.start + s.duration, 2), "text": s.text.strip()})
full_text = " ".join(seg["text"] for seg in segments)
print(json.dumps({"video_id": sys.argv[1], "language": "en", "segments": segments, "full_text": full_text}))
`.trim()

  const { stdout } = await execFileAsync('python3', ['-c', script, videoId], {
    timeout: 60_000,
    maxBuffer: 50 * 1024 * 1024,
  })

  const transcript: Transcript = JSON.parse(stdout)

  writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2), 'utf-8')

  console.error(`Fetched ${transcript.segments.length} segments`)
  onProgress?.('status', {
    step: 'transcript',
    message: `Fetched ${transcript.segments.length} segments`,
  })

  return transcript
}

export function findPhrase(
  transcript: Transcript,
  phrase: string,
  contextSeconds = 0,
  onProgress?: ProgressCallback
): Clip[] {
  const phraseLower = phrase.toLowerCase()
  const videoId = transcript.video_id
  const segments = transcript.segments
  const clips: Clip[] = []

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (seg.text.toLowerCase().includes(phraseLower)) {
      const contextStart = Math.max(0, i - 2)
      const contextEnd = Math.min(segments.length, i + 3)
      const contextText = segments
        .slice(contextStart, contextEnd)
        .map((s) => s.text)
        .join(' ')

      const clipStart = Math.max(0, Math.floor(seg.start) - contextSeconds)
      const clipEnd = Math.ceil(seg.end) + contextSeconds

      const clip: Clip = {
        id: `${videoId}_${clipStart}`,
        timestamp: seg.start,
        clip_start: clipStart,
        clip_end: clipEnd,
        duration: clipEnd - clipStart,
        text: seg.text,
        context: contextText,
        youtube_url: `https://youtube.com/watch?v=${videoId}&t=${clipStart}s`,
        embed_url: `https://youtube.com/embed/${videoId}?start=${clipStart}&end=${clipEnd}&autoplay=1`,
        clip_extract_url: `/api/clip/extract?url=https://youtube.com/watch?v=${videoId}&start=${clipStart}&end=${clipEnd}`,
      }

      clips.push(clip)
      onProgress?.('clip', clip)
    }
  }

  return clips
}

export async function extractClip(
  videoUrl: string,
  videoId: string,
  start: number,
  end: number
): Promise<string> {
  const clipPath = getCachePath(videoId, `_${start}_${end}.mp4`)

  if (existsSync(clipPath)) {
    console.error(`Using cached clip: ${clipPath}`)
    return clipPath
  }

  console.error(`Extracting clip ${start}s-${end}s from ${videoUrl}...`)

  const outputTemplate = getCachePath(videoId, `_${start}_${end}.%(ext)s`)

  await execFileAsync(
    'python3',
    [
      '-m',
      'yt_dlp',
      '--download-sections',
      `*${start}-${end}`,
      '-f',
      'bv*[height<=720]+ba/b[height<=720]',
      '--remux-video',
      'mp4',
      '--force-keyframes-at-cuts',
      '-o',
      outputTemplate,
      '--no-playlist',
      '--cookies-from-browser',
      'chrome',
      '--remote-components',
      'ejs:github',
      videoUrl,
    ],
    { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 }
  )

  if (!existsSync(clipPath)) {
    throw new Error('Clip file not found after extraction')
  }

  console.error(`Clip extracted: ${clipPath}`)
  return clipPath
}

export async function findClips(
  videoUrl: string,
  phrase: string,
  onProgress?: ProgressCallback
): Promise<FindClipsResult> {
  const videoId = extractVideoId(videoUrl)

  const transcript = await fetchTranscript(videoId, onProgress)

  onProgress?.('status', { step: 'search', message: 'Searching for phrase...' })
  const clips = findPhrase(transcript, phrase, 0, onProgress)

  const result: FindClipsResult = {
    video_id: videoId,
    video_url: `https://youtube.com/watch?v=${videoId}`,
    phrase,
    total_segments: transcript.segments.length,
    clips_found: clips.length,
    clips,
  }

  onProgress?.('done', result)

  return result
}
