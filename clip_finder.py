#!/usr/bin/env python3
"""
Clip Finder - Downloads YouTube audio, transcribes with Whisper,
finds all timestamps where a phrase is spoken.
Returns timestamped YouTube links as "clips".
"""

import json
import os
import sys
import subprocess
import tempfile
import re
import hashlib

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


def transcribe(audio_path: str, video_id: str, model: str = "base", on_progress=None) -> dict:
    """Transcribe audio using Whisper. Returns segments with timestamps."""
    transcript_path = get_cache_path(video_id, "_transcript.json")

    if os.path.exists(transcript_path):
        print(f"Using cached transcript", file=sys.stderr)
        with open(transcript_path) as f:
            return json.load(f)

    print(f"Transcribing with Whisper ({model})...", file=sys.stderr)

    import whisper

    if on_progress:
        on_progress("status", {"step": "transcribe", "message": "Loading Whisper model..."})
    whisper_model = whisper.load_model(model)
    if on_progress:
        on_progress("status", {"step": "transcribe", "message": "Transcribing audio..."})
    result = whisper_model.transcribe(audio_path, word_timestamps=True)
    
    # Extract segments with timestamps
    segments = []
    for seg in result.get("segments", []):
        segments.append({
            "start": round(seg["start"], 2),
            "end": round(seg["end"], 2),
            "text": seg["text"].strip(),
        })
    
    transcript = {
        "video_id": video_id,
        "language": result.get("language", "en"),
        "segments": segments,
        "full_text": result.get("text", ""),
    }
    
    with open(transcript_path, "w") as f:
        json.dump(transcript, f, indent=2)
    
    print(f"Transcribed {len(segments)} segments", file=sys.stderr)
    if on_progress:
        on_progress("status", {"step": "transcribe", "message": f"Transcribed {len(segments)} segments"})
    return transcript


def find_phrase(transcript: dict, phrase: str, context_seconds: int = 5, on_progress=None) -> list:
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
            }
            clips.append(clip)
            if on_progress:
                on_progress("clip", clip)

    return clips


def find_clips(video_url: str, phrase: str, model: str = "base", on_progress=None) -> dict:
    """Main entry point: find all clips matching a phrase in a YouTube video."""
    video_id = extract_video_id(video_url)

    # Download audio
    audio_path = download_audio(video_url, video_id, on_progress=on_progress)

    # Transcribe
    transcript = transcribe(audio_path, video_id, model=model, on_progress=on_progress)

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
