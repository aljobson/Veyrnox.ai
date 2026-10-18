import json
import os
import stat
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from cli_anything.veyrnox import auth, config
from cli_anything.veyrnox.client import Client, parse_value


class ConfigTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = mock.patch.dict(os.environ, {"VEYRNOX_CONFIG": str(Path(self.temp.name) / "config.json")}, clear=False)
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def test_default_when_missing(self):
        self.assertEqual(config.load()["api_url"], config.DEFAULT_API)

    def test_save_round_trip(self):
        config.save({"api_url": "https://test/api", "access_token": "secret"})
        self.assertEqual(config.load()["access_token"], "secret")

    def test_config_mode_is_user_only(self):
        config.save({"api_url": config.DEFAULT_API})
        if os.name != "nt":
            self.assertEqual(stat.S_IMODE(config.config_path().stat().st_mode), 0o600)

    def test_environment_overrides_api(self):
        config.save({"api_url": "https://saved"})
        with mock.patch.dict(os.environ, {"VEYRNOX_API_URL": "https://env"}):
            self.assertEqual(config.load()["api_url"], "https://env")

    def test_logout_keeps_registration(self):
        config.save({"api_url": "https://test", "client_id": "public", "access_token": "secret", "refresh_token": "refresh"})
        value = config.logout()
        self.assertEqual(value["client_id"], "public")
        self.assertNotIn("access_token", value)
        self.assertNotIn("refresh_token", value)


class AuthTests(unittest.TestCase):
    def test_pkce_pair(self):
        verifier, challenge = auth.pkce_pair()
        self.assertGreaterEqual(len(verifier), 43)
        self.assertNotIn("=", challenge)
        self.assertGreaterEqual(len(challenge), 43)

    def test_registration_is_public(self):
        with mock.patch.object(auth, "_json_request", return_value={"client_id": "abc"}) as call:
            self.assertEqual(auth.register_client("https://issuer/register", "http://127.0.0.1:123/callback")["client_id"], "abc")
        body = call.call_args.kwargs["body"]
        self.assertEqual(body["token_endpoint_auth_method"], "none")
        self.assertIn("refresh_token", body["grant_types"])

    def test_registration_requires_client_id(self):
        with mock.patch.object(auth, "_json_request", return_value={}):
            with self.assertRaises(RuntimeError):
                auth.register_client("https://issuer/register", "http://127.0.0.1:123/callback")

    def test_store_rotated_refresh_token(self):
        saved = {"refresh_token": "old"}
        with mock.patch.object(time, "time", return_value=100):
            auth._store_tokens(saved, {"access_token": "new", "refresh_token": "rotated", "expires_in": 60})
        self.assertEqual((saved["refresh_token"], saved["expires_at"]), ("rotated", 160))

    def test_store_requires_access_token(self):
        with self.assertRaises(RuntimeError):
            auth._store_tokens({}, {"refresh_token": "nope"})

    def test_discovery_requests_identify_the_cli(self):
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b'{"ok":true}'
        response.__exit__.return_value = False
        with mock.patch("urllib.request.urlopen", return_value=response) as opened:
            self.assertEqual(auth._json_request("https://example.test"), {"ok": True})
        self.assertRegex(opened.call_args.args[0].get_header("User-agent"), r"^Veyrnox-CLI/1\.0\.0")


class ClientTests(unittest.TestCase):
    def test_parse_typed_values(self):
        self.assertEqual(parse_value("true"), True)
        self.assertEqual(parse_value("12"), 12)
        self.assertEqual(parse_value('["a"]'), ["a"])
        self.assertEqual(parse_value("plain"), "plain")

    def test_missing_token_fails_before_network(self):
        with self.assertRaisesRegex(RuntimeError, "Not signed in"):
            Client({"api_url": "https://example.test"}).request("GET", "/models")

    def test_expired_token_refreshes_once(self):
        saved = {"api_url": "https://example.test", "access_token": "old", "refresh_token": "r", "expires_at": 0}
        refreshed = {**saved, "access_token": "new", "expires_at": int(time.time()) + 3600}
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b'{"ok":true}'
        response.__exit__.return_value = False
        with mock.patch.object(auth, "refresh", return_value=refreshed) as refresh, mock.patch("urllib.request.urlopen", return_value=response) as opened:
            self.assertEqual(Client(saved).request("GET", "/models"), {"ok": True})
        refresh.assert_called_once()
        self.assertEqual(opened.call_args.args[0].get_header("Authorization"), "Bearer new")
        self.assertRegex(opened.call_args.args[0].get_header("User-agent"), r"^Veyrnox-CLI/1\.0\.0")

    def test_download_rejects_empty_bytes(self):
        api = Client({"api_url": "https://example.test", "access_token": "a", "expires_at": int(time.time()) + 3600})
        api.request = mock.Mock(return_value={"url": "https://asset.test/file"})
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b""
        response.__exit__.return_value = False
        with mock.patch("urllib.request.urlopen", return_value=response) as opened, self.assertRaisesRegex(RuntimeError, "empty"):
            api.download("job", "/tmp/unused-veyrnox-test")
        self.assertRegex(opened.call_args.args[0].get_header("User-agent"), r"^Veyrnox-CLI/1\.0\.0")


class PublishCommandTests(unittest.TestCase):
    def run_cli(self, *args, reply=None):
        from click.testing import CliRunner
        from cli_anything.veyrnox import veyrnox_cli
        with mock.patch.object(veyrnox_cli.Client, "request", return_value=reply or {}) as call:
            result = CliRunner().invoke(veyrnox_cli.cli, ["--json", *args])
        return result, call

    def test_accounts_hit_the_publish_path_with_brand(self):
        result, call = self.run_cli("publish", "--brand", "b1", "accounts", reply={"accounts": []})
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual(call.call_args.args, ("GET", "/publish/accounts?brand_id=b1"))

    def test_schedule_requires_yes_when_not_interactive(self):
        result, call = self.run_cli("publish", "schedule", "--at", "2030-01-01T10:00:00Z", "--account", "a1", "--video", "j1")
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("requires --yes", result.output)
        call.assert_not_called()

    def test_schedule_dry_run_sends_nothing(self):
        result, call = self.run_cli("publish", "schedule", "--at", "2030-01-01T10:00:00Z", "--account", "a1", "--image", "j1", "--dry-run")
        self.assertEqual(result.exit_code, 0, result.output)
        body = json.loads(result.output)["request"]
        self.assertEqual(body["media"], [{"media_type": "image", "job_id": "j1"}])
        self.assertNotIn("publish_now", body)
        call.assert_not_called()

    def test_schedule_posts_the_request(self):
        result, call = self.run_cli("publish", "schedule", "--at", "2030-01-01T10:00:00Z", "--account", "a1", "--video", "j1",
            "--idempotency-key", "idem-12345678", "--yes", reply={"post_id": "p", "scheduled_at": "x"})
        self.assertEqual(result.exit_code, 0, result.output)
        method, path, body = call.call_args.args
        self.assertEqual((method, path, body["idempotency_key"]), ("POST", "/publish/posts", "idem-12345678"))

    def test_cancel_needs_the_version_and_confirmation(self):
        result, call = self.run_cli("publish", "cancel", "p1", "--expected-updated-at", "2030-01-01T00:00:00Z")
        self.assertIn("requires --yes", result.output)
        call.assert_not_called()
        result, call = self.run_cli("publish", "cancel", "p1", "--expected-updated-at", "2030-01-01T00:00:00Z", "--yes",
            reply={"post_id": "p1"})
        self.assertEqual(call.call_args.args[:2], ("POST", "/publish/posts/p1/cancel"))
        self.assertEqual(call.call_args.args[2], {"expected_updated_at": "2030-01-01T00:00:00Z"})

    def test_posts_query_is_encoded(self):
        _, call = self.run_cli("publish", "posts", "--status", "published", "--network", "youtube", reply={"posts": []})
        self.assertEqual(call.call_args.args[1], "/publish/posts?status=published&network=youtube")


if __name__ == "__main__":
    unittest.main()
