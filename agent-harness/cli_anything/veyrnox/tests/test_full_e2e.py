import json
import os
import shutil
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


JOB_ID = "11111111-1111-4111-8111-111111111111"


class ContractHandler(BaseHTTPRequestHandler):
    requests = []

    def _json(self, value, status=200):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _record(self, body=None):
        type(self).requests.append((self.command, self.path, self.headers.get("Authorization"), body,
            self.headers.get("User-Agent")))

    def do_GET(self):
        self._record()
        if self.path == "/api/v1/developer/models":
            self._json({"models": [{"id": "image-test", "name": "Image", "modality": "text-to-image", "credits": 2}], "count": 1})
        elif self.path == "/api/v1/developer/balance":
            self._json({"balance": 20, "free_credits": 5, "free_expires_at": None})
        elif self.path.startswith("/api/v1/developer/generations?"):
            self._json({"jobs": [{"job_id": JOB_ID, "state": "succeeded", "model_id": "image-test"}], "next": None})
        elif self.path == f"/api/v1/developer/generations/{JOB_ID}":
            self._json({"state": "succeeded", "credits": 2, "model_id": "image-test"})
        elif self.path == f"/api/v1/developer/generations/{JOB_ID}/asset?download=1":
            self._json({"url": f"http://127.0.0.1:{self.server.server_port}/asset", "mime_type": "image/png", "size_bytes": 8})
        elif self.path == "/asset":
            body = b"PNG-TEST"
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/api/developer/openapi":
            self._json({"openapi": "3.1.0", "info": {"title": "Veyrnox Developer API"}})
        else:
            self._json({"error": "not_found"}, 404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length) or b"{}")
        self._record(body)
        if self.path == "/api/v1/developer/estimates":
            self._json({"model_id": body["model_id"], "maximum_credits": 2, "may_use_free_allowance": True})
        elif self.path == "/api/v1/developer/generations":
            self._json({"job_id": JOB_ID, "state": "SUBMITTED", "balance_after": 18})
        else:
            self._json({"error": "not_found"}, 404)

    def log_message(self, *_args):
        return


def _resolve_cli():
    found = shutil.which("cli-anything-veyrnox")
    if os.environ.get("CLI_ANYTHING_FORCE_INSTALLED") == "1" and not found:
        raise AssertionError("installed cli-anything-veyrnox executable not found")
    return found or "cli-anything-veyrnox"


class InstalledCliTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), ContractHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.config = Path(cls.temp.name) / "config.json"
        cls.config.write_text(json.dumps({
            "api_url": f"http://127.0.0.1:{cls.server.server_port}/api/v1/developer",
            "access_token": "test-access-token", "expires_at": 4102444800,
        }))
        cls.env = {**os.environ, "VEYRNOX_CONFIG": str(cls.config), "NO_COLOR": "1"}
        cls.binary = _resolve_cli()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.temp.cleanup()

    def run_cli(self, *args, ok=True):
        result = subprocess.run([self.binary, *args], env=self.env, capture_output=True, text=True, timeout=15)
        if ok and result.returncode != 0:
            self.fail(f"CLI failed: {result.stderr}")
        return result

    def json_cli(self, *args):
        return json.loads(self.run_cli("--json", *args).stdout)

    def test_01_help_from_installed_binary(self):
        self.assertIn("Price, generate, track", self.run_cli("--help").stdout)

    def test_02_version(self):
        self.assertIn("1.0.0", self.run_cli("--version").stdout)

    def test_03_models(self):
        self.assertEqual(self.json_cli("models", "list")["models"][0]["id"], "image-test")
        self.assertRegex(ContractHandler.requests[-1][4], r"^Veyrnox-CLI/1\.0\.0")

    def test_04_balance(self):
        self.assertEqual(self.json_cli("balance")["balance"], 20)

    def test_05_estimate(self):
        self.assertEqual(self.json_cli("generations", "estimate", "--model", "image-test")["maximum_credits"], 2)

    def test_06_confirmed_create(self):
        value = self.json_cli("generations", "create", "--model", "image-test", "--prompt", "blue fox", "--confirmed-credits", "2")
        self.assertEqual(value["job_id"], JOB_ID)
        posts = [r for r in ContractHandler.requests if r[0:2] == ("POST", "/api/v1/developer/generations")]
        self.assertEqual(posts[-1][3]["confirmed_credits"], 2)
        self.assertEqual(posts[-1][3]["inputs"]["prompt"], "blue fox")

    def test_07_changed_price_stops_before_create(self):
        before = len([r for r in ContractHandler.requests if r[0:2] == ("POST", "/api/v1/developer/generations")])
        result = self.run_cli("--json", "generations", "create", "--model", "image-test", "--confirmed-credits", "3", ok=False)
        self.assertNotEqual(result.returncode, 0)
        after = len([r for r in ContractHandler.requests if r[0:2] == ("POST", "/api/v1/developer/generations")])
        self.assertEqual(before, after)

    def test_08_dry_run_does_not_create(self):
        before = len([r for r in ContractHandler.requests if r[0:2] == ("POST", "/api/v1/developer/generations")])
        value = self.json_cli("generations", "create", "--model", "image-test", "--dry-run")
        self.assertTrue(value["dry_run"])
        after = len([r for r in ContractHandler.requests if r[0:2] == ("POST", "/api/v1/developer/generations")])
        self.assertEqual(before, after)

    def test_09_list_and_get(self):
        self.assertEqual(self.json_cli("generations", "list")["jobs"][0]["job_id"], JOB_ID)
        self.assertEqual(self.json_cli("generations", "get", JOB_ID)["state"], "succeeded")

    def test_10_wait(self):
        self.assertEqual(self.json_cli("generations", "wait", JOB_ID, "--interval", "0.2")["state"], "succeeded")

    def test_11_download(self):
        output = Path(self.temp.name) / "result.png"
        value = self.json_cli("generations", "download", JOB_ID, "--output", str(output))
        self.assertEqual(value["bytes"], 8)
        self.assertEqual(output.read_bytes(), b"PNG-TEST")

    def test_12_openapi(self):
        self.assertEqual(self.json_cli("openapi")["openapi"], "3.1.0")


if __name__ == "__main__":
    unittest.main()
