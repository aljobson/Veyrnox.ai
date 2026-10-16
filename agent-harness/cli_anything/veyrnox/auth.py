import base64
import hashlib
import json
import secrets
import sys
import time
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer

from . import USER_AGENT
from . import config


def pkce_pair():
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def _json_request(url, *, method="GET", body=None, headers=None):
    payload = None if body is None else json.dumps(body).encode()
    merged = {"Accept": "application/json", "User-Agent": USER_AGENT, **(headers or {})}
    if payload is not None:
        merged["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=payload, headers=merged, method=method)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def discovery(metadata_url=config.DEFAULT_METADATA):
    resource = _json_request(metadata_url)
    issuers = resource.get("authorization_servers") or []
    if len(issuers) != 1 or not issuers[0].startswith("https://"):
        raise RuntimeError("Veyrnox returned invalid OAuth resource metadata")
    issuer = issuers[0].rstrip("/")
    oauth = _json_request(f"{issuer}/.well-known/oauth-authorization-server")
    for name in ["authorization_endpoint", "token_endpoint", "registration_endpoint"]:
        if not str(oauth.get(name, "")).startswith("https://"):
            raise RuntimeError(f"OAuth discovery is missing {name}")
    return resource, oauth


def register_client(endpoint, redirect_uri):
    value = _json_request(endpoint, method="POST", body={
        "client_name": "Veyrnox CLI",
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    })
    if not value.get("client_id"):
        raise RuntimeError("OAuth registration did not return a client ID")
    return value


class _Callback(BaseHTTPRequestHandler):
    result = None

    def do_GET(self):
        type(self).result = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        ok = "code" in type(self).result
        body = b"Veyrnox CLI sign-in complete. You can close this window." if ok else b"Veyrnox CLI sign-in failed. Return to your terminal."
        self.send_response(200 if ok else 400)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        return


def login(open_browser=True):
    server = HTTPServer(("127.0.0.1", 0), _Callback)
    redirect_uri = f"http://127.0.0.1:{server.server_port}/callback"
    resource, oauth = discovery()
    current = config.load()
    registration = register_client(oauth["registration_endpoint"], redirect_uri)
    verifier, challenge = pkce_pair()
    state = secrets.token_urlsafe(32)
    query = urllib.parse.urlencode({
        "client_id": registration["client_id"], "redirect_uri": redirect_uri,
        "response_type": "code", "scope": "openid email profile", "state": state,
        "code_challenge": challenge, "code_challenge_method": "S256",
        "resource": resource["resource"],
    })
    url = f'{oauth["authorization_endpoint"]}?{query}'
    opened = webbrowser.open(url) if open_browser else False
    if not opened:
        print(f"Open this URL in your browser:\n{url}", file=sys.stderr, flush=True)
    _Callback.result = None
    server.timeout = 300
    try:
        server.handle_request()
    finally:
        server.server_close()
    result = _Callback.result or {}
    if result.get("state", [None])[0] != state:
        raise RuntimeError("OAuth state did not match")
    if "error" in result:
        raise RuntimeError(f'OAuth authorization failed: {result["error"][0]}')
    code = result.get("code", [None])[0]
    if not code:
        raise RuntimeError("OAuth callback did not include a code")
    token = _form_request(oauth["token_endpoint"], {
        "grant_type": "authorization_code", "code": code, "client_id": registration["client_id"],
        "redirect_uri": redirect_uri, "code_verifier": verifier,
    })
    saved = {**current, "oauth": oauth, "client_id": registration["client_id"], "redirect_uri": redirect_uri}
    _store_tokens(saved, token)
    config.save(saved)
    return {"signed_in": True, "api_url": saved["api_url"], "expires_at": saved.get("expires_at")}


def _form_request(url, body):
    request = urllib.request.Request(url, data=urllib.parse.urlencode(body).encode(),
        headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT}, method="POST")
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def _store_tokens(saved, token):
    if not token.get("access_token"):
        raise RuntimeError("OAuth token response did not include an access token")
    saved["access_token"] = token["access_token"]
    if token.get("refresh_token"):
        saved["refresh_token"] = token["refresh_token"]
    saved["token_type"] = token.get("token_type", "bearer")
    saved["scope"] = token.get("scope", "")
    saved["expires_at"] = int(time.time()) + int(token.get("expires_in", 3600))


def refresh(saved):
    oauth = saved.get("oauth") or discovery()[1]
    if not saved.get("refresh_token") or not saved.get("client_id"):
        raise RuntimeError("Not signed in. Run: veyrnox auth login")
    token = _form_request(oauth["token_endpoint"], {
        "grant_type": "refresh_token", "refresh_token": saved["refresh_token"], "client_id": saved["client_id"],
    })
    _store_tokens(saved, token)
    saved["oauth"] = oauth
    config.save(saved)
    return saved
