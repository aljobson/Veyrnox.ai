import json
import os
from contextlib import contextmanager
from pathlib import Path

DEFAULT_API = "https://veyrnox.ai/api/v1/developer"
DEFAULT_METADATA = "https://veyrnox.ai/.well-known/oauth-protected-resource/api/v1/developer"


def config_path() -> Path:
    explicit = os.environ.get("VEYRNOX_CONFIG")
    if explicit:
        return Path(explicit).expanduser()
    root = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return root / "veyrnox" / "config.json"


@contextmanager
def _lock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = path.with_suffix(path.suffix + ".lock")
    handle = lock_path.open("a+")
    try:
        try:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX)
        except ImportError:
            import msvcrt
            handle.seek(0, 2)
            if handle.tell() == 0:
                handle.write("0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
        yield
    finally:
        try:
            if os.name == "nt":
                import msvcrt
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle, fcntl.LOCK_UN)
        finally:
            handle.close()


def load() -> dict:
    path = config_path()
    if not path.exists():
        return {"api_url": os.environ.get("VEYRNOX_API_URL", DEFAULT_API)}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RuntimeError(f"Cannot read Veyrnox config: {exc}") from exc
    value["api_url"] = os.environ.get("VEYRNOX_API_URL", value.get("api_url", DEFAULT_API))
    return value


def save(value: dict) -> None:
    path = config_path()
    with _lock(path):
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        try:
            os.chmod(temp, 0o600)
        except OSError:
            pass
        temp.replace(path)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass


def logout() -> dict:
    value = load()
    for key in ["access_token", "refresh_token", "expires_at", "token_type", "scope"]:
        value.pop(key, None)
    save(value)
    return value
