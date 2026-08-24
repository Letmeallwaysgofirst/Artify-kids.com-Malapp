import os
import json
import random
import base64
import datetime
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote
from functools import lru_cache

HOST_NAME = "0.0.0.0"
PORT = 8000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GALLERY_DIR = os.path.join(BASE_DIR, "galerie")
MAX_UPLOAD_MB = 15
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

os.makedirs(GALLERY_DIR, exist_ok=True)

MIME_TYPES = {
    ".html":  "text/html; charset=utf-8",
    ".css":   "text/css; charset=utf-8",
    ".js":    "application/javascript; charset=utf-8",
    ".mjs":   "application/javascript; charset=utf-8",
    ".json":  "application/json; charset=utf-8",
    ".png":   "image/png",
    ".jpg":   "image/jpeg",
    ".jpeg":  "image/jpeg",
    ".gif":   "image/gif",
    ".webp":  "image/webp",
    ".svg":   "image/svg+xml",
    ".ico":   "image/x-icon",
    ".woff":  "font/woff",
    ".woff2": "font/woff2",
}

FILE_CACHE = {}
CACHE_MAX_AGE = 3600


class ArtStudioHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {self.address_string()} - {format % args}")

    def _set_headers(self, status_code=200, content_type="application/json"):
        self.send_response(status_code)
        self.send_header("Content-type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers(200)

    def do_GET(self):
        parsed_path = urlparse(self.path)
        path = unquote(parsed_path.path)
        if path == "/gallery":
            self.handle_gallery_request()
        elif path == "/" or path == "":
            self.serve_static_file("index.html")
        else:
            clean_path = path.lstrip("/")
            self.serve_static_file(clean_path)

    def do_POST(self):
        parsed_path = urlparse(self.path)
        path = unquote(parsed_path.path)
        if path == "/save":
            self.handle_save_request()
        else:
            self._set_headers(404, "application/json")
            self.wfile.write(json.dumps({"error": "Endpunkt nicht gefunden"}).encode("utf-8"))

    def serve_static_file(self, relative_path):
        requested_path = os.path.normpath(os.path.join(BASE_DIR, relative_path))
        if not (requested_path == BASE_DIR or requested_path.startswith(BASE_DIR + os.sep)):
            self._set_headers(403, "text/plain")
            self.wfile.write(b"Forbidden")
            return
        if not os.path.isfile(requested_path):
            self._set_headers(404, "text/plain")
            self.wfile.write(b"404 Not Found")
            return
        
        cache_key = requested_path
        current_mtime = os.path.getmtime(requested_path)
        
        if cache_key in FILE_CACHE:
            cached_data, cached_mtime, cached_etag = FILE_CACHE[cache_key]
            if cached_mtime == current_mtime:
                if self.headers.get("If-None-Match") == cached_etag:
                    self.send_response(304)
                    self.end_headers()
                    return
                ext = os.path.splitext(requested_path)[1].lower()
                mime_type = MIME_TYPES.get(ext, "application/octet-stream")
                self.send_response(200)
                self.send_header("Content-type", mime_type)
                self.send_header("Content-Length", str(len(cached_data)))
                self.send_header("ETag", cached_etag)
                self.send_header("Cache-Control", f"public, max-age={CACHE_MAX_AGE}")
                self.end_headers()
                self.wfile.write(cached_data)
                return
        
        ext = os.path.splitext(requested_path)[1].lower()
        mime_type = MIME_TYPES.get(ext, "application/octet-stream")
        try:
            with open(requested_path, "rb") as f:
                file_content = f.read()
            
            file_hash = hashlib.md5(file_content).hexdigest()
            etag = f'"{file_hash}"'
            FILE_CACHE[cache_key] = (file_content, current_mtime, etag)
            
            if len(FILE_CACHE) > 100:
                oldest_key = next(iter(FILE_CACHE))
                del FILE_CACHE[oldest_key]
            
            self.send_response(200)
            self.send_header("Content-type", mime_type)
            self.send_header("Content-Length", str(len(file_content)))
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", f"public, max-age={CACHE_MAX_AGE}")
            self.end_headers()
            self.wfile.write(file_content)
        except Exception as e:
            self._set_headers(500, "text/plain")
            self.wfile.write(f"Interner Serverfehler: {str(e)}".encode("utf-8"))

    def handle_gallery_request(self):
        images = []
        if os.path.exists(GALLERY_DIR):
            for filename in os.listdir(GALLERY_DIR):
                if filename.lower().endswith((".png", ".jpg", ".jpeg", ".gif", ".webp")):
                    file_path = os.path.join(GALLERY_DIR, filename)
                    mtime = os.path.getmtime(file_path)
                    date_str = datetime.datetime.fromtimestamp(mtime).strftime("%d.%m.%Y %H:%M")
                    images.append({
                        "url": f"/galerie/{filename}",
                        "name": filename,
                        "filename": filename,
                        "date": date_str,
                        "timestamp": mtime
                    })
        images.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
        self._set_headers(200, "application/json")
        self.wfile.write(json.dumps(images, ensure_ascii=False).encode("utf-8"))

    def handle_save_request(self):
        content_length = int(self.headers.get("Content-Length", 0))
        max_bytes = MAX_UPLOAD_MB * 1024 * 1024
        if content_length == 0:
            self._set_headers(400, "application/json")
            self.wfile.write(json.dumps({"error": "Keine Daten empfangen"}).encode("utf-8"))
            return
        if content_length > max_bytes:
            self._set_headers(413, "application/json")
            self.wfile.write(json.dumps({"error": f"Datei zu gross (max {MAX_UPLOAD_MB} MB)"}).encode("utf-8"))
            return
        try:
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode("utf-8"))
            image_data_url = data.get("image", "")
            if not image_data_url.startswith("data:image"):
                raise ValueError("Ungueltiges Bildformat")
            header, encoded = image_data_url.split(",", 1)
            image_bytes = base64.b64decode(encoded)
            if not image_bytes[:8] == PNG_MAGIC:
                raise ValueError("Kein gueltiges PNG")
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            rand_suffix = random.randint(1000, 9999)
            filename = f"kunstwerk_{timestamp}_{rand_suffix}.png"
            filepath = os.path.join(GALLERY_DIR, filename)
            with open(filepath, "wb") as f:
                f.write(image_bytes)
            print(f"Kunstwerk gespeichert: {filename} ({len(image_bytes)} Bytes)")
            self._set_headers(200, "application/json")
            self.wfile.write(json.dumps({
                "status": "success",
                "url": f"/galerie/{filename}",
                "name": filename
            }, ensure_ascii=False).encode("utf-8"))
        except json.JSONDecodeError:
            self._set_headers(400, "application/json")
            self.wfile.write(json.dumps({"error": "Ungueltiges JSON"}).encode("utf-8"))
        except Exception as e:
            self._set_headers(500, "application/json")
            self.wfile.write(json.dumps({"error": f"Fehler beim Speichern: {str(e)}"}).encode("utf-8"))


def main():
    server = ThreadingHTTPServer((HOST_NAME, PORT), ArtStudioHandler)
    print("=" * 50)
    print("  Artify-Kids Server gestartet")
    print(f"  Adresse: http://localhost:{PORT}")
    print(f"  Galerie: {GALLERY_DIR}")
    print(f"  Max Upload: {MAX_UPLOAD_MB} MB")
    print("=" * 50)
    print("  Druecke STRG+C zum Stoppen")
    print("=" * 50)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer wird heruntergefahren...")
        server.shutdown()
        server.server_close()
        print("Server beendet.")


if __name__ == "__main__":
    main()