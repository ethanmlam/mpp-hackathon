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
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import threading

from clip_finder import find_clips

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
                "example": "/api/find?url=https://youtube.com/watch?v=o5nnBM3WH-Q&phrase=Ronaldo"
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
        
        if parsed.path == '/api/transcript':
            params = parse_qs(parsed.query)
            url = params.get('url', [None])[0]
            
            if not url:
                self.send_json({"error": "Missing url parameter"}, 400)
                return
            
            try:
                from clip_finder import extract_video_id, download_audio, transcribe
                video_id = extract_video_id(url)
                audio_path = download_audio(url, video_id)
                transcript = transcribe(audio_path, video_id)
                self.send_json(transcript)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
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
    server = HTTPServer(('0.0.0.0', PORT), ClipHandler)
    print(f"ClipDrop API running on http://localhost:{PORT}")
    print(f"Test: curl 'http://localhost:{PORT}/api/find?url=YOUTUBE_URL&phrase=Ronaldo'")
    server.serve_forever()
