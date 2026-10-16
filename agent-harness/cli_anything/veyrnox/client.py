import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from . import auth, config


class ApiError(RuntimeError):
    def __init__(self, status, body, retry_after=None):
        if not isinstance(body, dict):
            body = {"error": "invalid_response"}
        self.status, self.body, self.retry_after = status, body, retry_after
        super().__init__(f"Veyrnox API error {status}: {body.get('error', 'unknown_error')}")


def parse_value(value):
    try:
        return json.loads(value)
    except ValueError:
        return value


class Client:
    def __init__(self, saved=None):
        self.saved = saved or config.load()
        self.base = self.saved.get("api_url", config.DEFAULT_API).rstrip("/")

    def request(self, method, path, body=None, retry=True):
        if not self.saved.get("access_token"):
            raise RuntimeError("Not signed in. Run: veyrnox auth login")
        if self.saved.get("expires_at", 0) <= int(time.time()) + 30 and self.saved.get("refresh_token"):
            self.saved = auth.refresh(self.saved)
        data = None if body is None else json.dumps(body).encode()
        headers = {"Accept": "application/json", "Authorization": f'Bearer {self.saved["access_token"]}'}
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(f"{self.base}{path}", data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as exc:
            if exc.code == 401 and retry and self.saved.get("refresh_token"):
                self.saved = auth.refresh(self.saved)
                return self.request(method, path, body, retry=False)
            try:
                payload = json.loads(exc.read())
            except ValueError:
                payload = {"error": "invalid_response"}
            raise ApiError(exc.code, payload, exc.headers.get("Retry-After")) from None

    def download(self, job_id, output):
        asset = self.request("GET", f"/generations/{job_id}/asset?download=1")
        target = Path(output)
        with urllib.request.urlopen(asset["url"], timeout=120) as response:
            data = response.read()
        if not data:
            raise RuntimeError("Downloaded asset was empty")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return {"path": str(target.resolve()), "bytes": len(data), "mime_type": asset.get("mime_type")}
