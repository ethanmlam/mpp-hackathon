#!/usr/bin/env python3
"""
Clip Finder API - HTTP wrapper around clip_finder.py
Charges per clip delivered via MPP session.

Run: python3 api_clips.py
Test: tempo request "http://localhost:8085/api/find?url=YOUTUBE_URL&phrase=Ronaldo"
"""

import json
import os
import sys
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import threading

from clip_finder import find_clips, extract_clip, extract_video_id, fetch_transcript, CACHE_DIR

PORT = 8085


class ClipHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        
        if parsed.path == '/':
            self.send_json({
                "name": "ClipDrop",
                "description": "Find every moment a phrase is spoken in a YouTube video",
                "usage": "GET /api/find?url=YOUTUBE_URL&phrase=SEARCH_PHRASE",
                "payment": "MPP session - $0.02 per clip found",
                "example": "/api/find?url=https://www.youtube.com/watch?v=7RaC2nKBqv4&phrase=Ronaldo"
            })
            return
        
        if parsed.path == '/api/find':
            params = parse_qs(parsed.query)
            url = params.get('url', [None])[0]
            phrase = params.get('phrase', [None])[0]
            model = params.get('model', ['base'])[0]
            
            if not url or not phrase:
                self.send_json({"error": "Missing url or phrase parameter"}, 400)
                return
            
            try:
                self.log_message(f"Finding '{phrase}' in {url}")
                result = find_clips(url, phrase, model=model)
                
                # Calculate cost: $0.02 per clip found
                cost_per_clip = 0.02
                total_cost = len(result['clips']) * cost_per_clip
                
                result['billing'] = {
                    'cost_per_clip': f'${cost_per_clip}',
                    'clips_found': len(result['clips']),
                    'total_cost': f'${total_cost:.2f}',
                }
                
                self.send_json(result)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
            return
        
        if parsed.path == '/api/find/stream':
            params = parse_qs(parsed.query)
            url = params.get('url', [None])[0]
            phrase = params.get('phrase', [None])[0]
            model = params.get('model', ['base'])[0]

            if not url or not phrase:
                self.send_response(400)
                self.send_header('Content-Type', 'text/event-stream')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(b'event: error\ndata: {"error":"Missing url or phrase parameter"}\n\n')
                return

            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'keep-alive')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

            def send_sse(event_type, data):
                try:
                    payload = json.dumps(data)
                    msg = f"event: {event_type}\ndata: {payload}\n\n"
                    self.wfile.write(msg.encode())
                    self.wfile.flush()
                except Exception:
                    pass

            try:
                self.log_message(f"[stream] Finding '{phrase}' in {url}")
                find_clips(url, phrase, model=model, on_progress=send_sse)
            except Exception as e:
                send_sse("error", {"error": str(e)})
            return

        if parsed.path == '/api/transcript':
            params = parse_qs(parsed.query)
            url = params.get('url', [None])[0]
            
            if not url:
                self.send_json({"error": "Missing url parameter"}, 400)
                return
            
            try:
                video_id = extract_video_id(url)
                transcript = fetch_transcript(video_id)
                self.send_json(transcript)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
            return
        
        if parsed.path == '/api/clip/extract':
            params = parse_qs(parsed.query)
            url = params.get('url', [None])[0]
            start = params.get('start', [None])[0]
            end = params.get('end', [None])[0]

            if not url or not start or not end:
                self.send_json({"error": "Missing url, start, or end parameter"}, 400)
                return

            try:
                video_id = extract_video_id(url)
                start_int = int(start)
                end_int = int(end)
                extract_clip(url, video_id, start_int, end_int)
                self.send_json({
                    "clip_url": f"/api/clips/{video_id}_{start_int}_{end_int}.mp4",
                    "duration": end_int - start_int,
                })
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
            return

        if parsed.path.startswith('/api/clips/'):
            filename = parsed.path[len('/api/clips/'):]

            # Sanitize: reject path traversal or subdirectory attempts
            if '..' in filename or '/' in filename:
                self.send_json({"error": "Invalid filename"}, 400)
                return

            file_path = os.path.join(CACHE_DIR, filename)

            if not os.path.exists(file_path):
                self.send_json({"error": "Clip not found"}, 404)
                return

            file_size = os.path.getsize(file_path)
            range_header = self.headers.get('Range')

            if range_header:
                # Parse bytes=START-END
                range_match = range_header.strip().replace('bytes=', '').split('-')
                range_start = int(range_match[0]) if range_match[0] else 0
                range_end = int(range_match[1]) if range_match[1] else file_size - 1
                range_end = min(range_end, file_size - 1)
                content_length = range_end - range_start + 1

                self.send_response(206)
                self.send_header('Content-Type', 'video/mp4')
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Content-Range', f'bytes {range_start}-{range_end}/{file_size}')
                self.send_header('Content-Length', str(content_length))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()

                with open(file_path, 'rb') as f:
                    f.seek(range_start)
                    remaining = content_length
                    chunk_size = 65536
                    while remaining > 0:
                        chunk = f.read(min(chunk_size, remaining))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
            else:
                self.send_response(200)
                self.send_header('Content-Type', 'video/mp4')
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Content-Length', str(file_size))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()

                with open(file_path, 'rb') as f:
                    chunk_size = 65536
                    while True:
                        chunk = f.read(chunk_size)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
            return

        self.send_json({"error": "Not found"}, 404)
    
    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, indent=2).encode())
    
    def log_message(self, format, *args):
        sys.stderr.write(f"[ClipDrop] {format % args}\n")


if __name__ == '__main__':
    server = ThreadingHTTPServer(('0.0.0.0', PORT), ClipHandler)
    print(f"ClipDrop API running on http://localhost:{PORT}")
    print(f"Test: curl 'http://localhost:{PORT}/api/find?url=YOUTUBE_URL&phrase=Ronaldo'")
    server.serve_forever()
