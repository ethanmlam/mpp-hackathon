#!/usr/bin/env python3
"""
Clip Finder - Fetches YouTube transcripts and finds all timestamps
where a phrase is spoken. Returns timestamped YouTube links as "clips".
"""

import json
import os
import sys
import subprocess
import re

from youtube_transcript_api import YouTubeTranscriptApi

CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
os.makedirs(CACHE_DIR, exist_ok=True)

# Add ~/bin to PATH for ffmpeg
os.environ["PATH"] = os.path.expanduser("~/bin") + ":" + os.environ.get("PATH", "")


def extract_video_id(url: str) -> str:
    """Extract YouTube video ID from various URL formats."""
    patterns = [
        r'(?:v=|/v/|youtu\.be/)([a-zA-Z0-9_-]{11})',
        r'(?:shorts/)([a-zA-Z0-9_-]{11})',
    ]
    for p in patterns:
        m = re.search(p, url)
        if m:
            return m.group(1)
    return url  # assume it's already an ID


def get_cache_path(video_id: str, suffix: str) -> str:
    return os.path.join(CACHE_DIR, f"{video_id}{suffix}")


def download_audio(video_url: str, video_id: str, on_progress=None) -> str:
    """Download audio from YouTube video using yt-dlp."""
    audio_path = get_cache_path(video_id, ".mp3")

    if os.path.exists(audio_path):
        print(f"Using cached audio: {audio_path}", file=sys.stderr)
        if on_progress:
            on_progress("status", {"step": "download", "message": "Using cached audio"})
        return audio_path

    print(f"Downloading audio from {video_url}...", file=sys.stderr)
    if on_progress:
        on_progress("status", {"step": "download", "message": "Downloading audio..."})
    
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "-x",  # extract audio
        "--audio-format", "mp3",
        "--audio-quality", "5",  # lower quality = faster
        "-o", get_cache_path(video_id, ".%(ext)s"),
        "--no-playlist",
        "--cookies-from-browser", "chrome",
        "--remote-components", "ejs:github",
        video_url
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    
    if result.returncode != 0:
        raise Exception(f"yt-dlp failed: {result.stderr[:500]}")
    
    if not os.path.exists(audio_path):
        # yt-dlp might have used a different extension
        for ext in ['.mp3', '.m4a', '.opus', '.webm']:
            alt = get_cache_path(video_id, ext)
            if os.path.exists(alt):
                audio_path = alt
                break
    
    if not os.path.exists(audio_path):
        raise Exception("Audio file not found after download")
    
    print(f"Audio downloaded: {audio_path}", file=sys.stderr)
    return audio_path


def extract_clip(video_url: str, video_id: str, start: int, end: int) -> str:
    """Extract a video clip segment using yt-dlp --download-sections."""
    clip_path = get_cache_path(video_id, f"_{start}_{end}.mp4")

    if os.path.exists(clip_path):
        print(f"Using cached clip: {clip_path}", file=sys.stderr)
        return clip_path

    print(f"Extracting clip {start}s-{end}s from {video_url}...", file=sys.stderr)

    cmd = [
        sys.executable, "-m", "yt_dlp",
        "--download-sections", f"*{start}-{end}",
        "-f", "bv*[height<=720]+ba/b[height<=720]",
        "--remux-video", "mp4",
        "--force-keyframes-at-cuts",
        "-o", get_cache_path(video_id, f"_{start}_{end}.%(ext)s"),
        "--no-playlist",
        "--cookies-from-browser", "chrome",
        "--remote-components", "ejs:github",
        video_url
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

    if result.returncode != 0:
        raise Exception(f"yt-dlp clip extract failed: {result.stderr[:500]}")

    if not os.path.exists(clip_path):
        raise Exception("Clip file not found after extraction")

    print(f"Clip extracted: {clip_path}", file=sys.stderr)
    return clip_path


def fetch_transcript(video_id: str, on_progress=None) -> dict:
    """Fetch transcript from YouTube. Returns segments with timestamps."""
    transcript_path = get_cache_path(video_id, "_yt_transcript.json")

    if os.path.exists(transcript_path):
        print(f"Using cached transcript", file=sys.stderr)
        if on_progress:
            on_progress("status", {"step": "transcript", "message": "Using cached transcript"})
        with open(transcript_path) as f:
            return json.load(f)

    print(f"Fetching YouTube transcript...", file=sys.stderr)
    if on_progress:
        on_progress("status", {"step": "transcript", "message": "Fetching YouTube transcript..."})

    api = YouTubeTranscriptApi()
    fetched = api.fetch(video_id)

    segments = []
    for snippet in fetched.snippets:
        segments.append({
            "start": round(snippet.start, 2),
            "end": round(snippet.start + snippet.duration, 2),
            "text": snippet.text.strip(),
        })

    full_text = " ".join(s["text"] for s in segments)
    transcript = {
        "video_id": video_id,
        "language": "en",
        "segments": segments,
        "full_text": full_text,
    }

    with open(transcript_path, "w") as f:
        json.dump(transcript, f, indent=2)

    print(f"Fetched {len(segments)} segments", file=sys.stderr)
    if on_progress:
        on_progress("status", {"step": "transcript", "message": f"Fetched {len(segments)} segments"})
    return transcript


def find_phrase(transcript: dict, phrase: str, context_seconds: int = 0, on_progress=None) -> list:
    """Find all timestamps where a phrase is spoken."""
    phrase_lower = phrase.lower()
    video_id = transcript["video_id"]
    clips = []

    segments = transcript["segments"]

    for i, seg in enumerate(segments):
        if phrase_lower in seg["text"].lower():
            # Get surrounding context
            context_start = max(0, i - 2)
            context_end = min(len(segments), i + 3)
            context_text = " ".join(s["text"] for s in segments[context_start:context_end])

            # Clip starts a few seconds before the phrase
            clip_start = max(0, int(seg["start"]) - context_seconds)
            clip_end = int(seg["end"]) + context_seconds

            clip = {
                "id": f"{video_id}_{clip_start}",
                "timestamp": seg["start"],
                "clip_start": clip_start,
                "clip_end": clip_end,
                "duration": clip_end - clip_start,
                "text": seg["text"],
                "context": context_text,
                "youtube_url": f"https://youtube.com/watch?v={video_id}&t={clip_start}s",
                "embed_url": f"https://youtube.com/embed/{video_id}?start={clip_start}&end={clip_end}&autoplay=1",
                "clip_extract_url": f"/api/clip/extract?url=https://youtube.com/watch?v={video_id}&start={clip_start}&end={clip_end}",
            }
            clips.append(clip)
            if on_progress:
                on_progress("clip", clip)

    return clips


def find_clips(video_url: str, phrase: str, model: str = "base", on_progress=None) -> dict:
    """Main entry point: find all clips matching a phrase in a YouTube video."""
    video_id = extract_video_id(video_url)

    # Fetch transcript from YouTube
    transcript = fetch_transcript(video_id, on_progress=on_progress)

    # Find phrase
    if on_progress:
        on_progress("status", {"step": "search", "message": f"Searching for phrase..."})
    clips = find_phrase(transcript, phrase, on_progress=on_progress)

    result = {
        "video_id": video_id,
        "video_url": f"https://youtube.com/watch?v={video_id}",
        "phrase": phrase,
        "total_segments": len(transcript["segments"]),
        "clips_found": len(clips),
        "clips": clips,
    }

    if on_progress:
        on_progress("done", result)

    return result


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python clip_finder.py <youtube_url> <phrase>")
        print("Example: python clip_finder.py 'https://youtube.com/watch?v=abc123' 'Cristiano Ronaldo'")
        sys.exit(1)
    
    url = sys.argv[1]
    phrase = sys.argv[2]
    model = sys.argv[3] if len(sys.argv) > 3 else "base"
    
    result = find_clips(url, phrase, model=model)
    print(json.dumps(result, indent=2))
