import json
import shlex
import sys
import time
import uuid
import urllib.request

import click

from . import USER_AGENT, __version__, auth, config
from .client import ApiError, Client, parse_value
from .utils.repl_skin import ReplSkin


def emit(ctx, value, human=None):
    if ctx.obj["json"]:
        click.echo(json.dumps(value, indent=2, sort_keys=True))
    elif human:
        click.echo(human(value))
    else:
        click.echo(json.dumps(value, indent=2, sort_keys=True))


def client(ctx):
    saved = config.load()
    if ctx.obj.get("api_url"):
        saved["api_url"] = ctx.obj["api_url"]
    return Client(saved)


def fail(exc):
    if isinstance(exc, ApiError):
        detail = dict(exc.body)
        detail["status"] = exc.status
        if exc.retry_after:
            detail["retry_after"] = exc.retry_after
        raise click.ClickException(json.dumps(detail, sort_keys=True)) from None
    raise click.ClickException(str(exc)) from None


@click.group(invoke_without_command=True, context_settings={"help_option_names": ["-h", "--help"]})
@click.version_option(__version__, prog_name="veyrnox")
@click.option("--json", "json_output", is_flag=True, help="Write one machine-readable JSON value.")
@click.option("--api-url", envvar="VEYRNOX_API_URL", help="Override the Veyrnox Developer API base URL.")
@click.pass_context
def cli(ctx, json_output, api_url):
    """Price, generate, track and download media with Veyrnox.ai."""
    ctx.ensure_object(dict)
    ctx.obj.update(json=json_output, api_url=api_url)
    if ctx.invoked_subcommand is None:
        if not sys.stdin.isatty():
            click.echo(ctx.get_help())
            return
        repl()


@cli.group()
def auth_group():
    """Sign in, inspect or clear local OAuth credentials."""


@auth_group.command("login")
@click.option("--no-browser", is_flag=True, help="Print the authorization URL instead of opening it.")
@click.pass_context
def auth_login(ctx, no_browser):
    try:
        result = auth.login(open_browser=not no_browser)
        emit(ctx, result, lambda _: "Signed in to Veyrnox.ai.")
    except Exception as exc:
        fail(exc)


@auth_group.command("status")
@click.pass_context
def auth_status(ctx):
    saved = config.load()
    if not saved.get("access_token"):
        emit(ctx, {"signed_in": False, "api_url": saved["api_url"]}, lambda _: "Not signed in.")
        return
    try:
        me = client(ctx).request("GET", "/me")
        emit(ctx, {"signed_in": True, **me}, lambda v: f'Signed in as {v.get("email") or v["id"]}.')
    except Exception as exc:
        fail(exc)


@auth_group.command("logout")
@click.pass_context
def auth_logout(ctx):
    config.logout()
    emit(ctx, {"signed_in": False}, lambda _: "Local Veyrnox tokens removed.")


@cli.group()
def models():
    """Browse generation models."""


@models.command("list")
@click.option("--modality", help="Filter by exact modality.")
@click.pass_context
def models_list(ctx, modality):
    try:
        value = client(ctx).request("GET", "/models")
        if modality:
            value["models"] = [m for m in value.get("models", []) if m.get("modality") == modality]
            value["count"] = len(value["models"])
        emit(ctx, value, lambda v: "\n".join(f'{m["id"]:28} {m["modality"]:18} {m["credits"]} credits' for m in v["models"]))
    except Exception as exc:
        fail(exc)


@cli.command()
@click.pass_context
def balance(ctx):
    """Show paid and free credit balances."""
    try:
        emit(ctx, client(ctx).request("GET", "/balance"),
            lambda v: f'{v["balance"]} credits ({v.get("free_credits", 0)} free)')
    except Exception as exc:
        fail(exc)


@cli.command()
@click.pass_context
def openapi(ctx):
    """Print the public OpenAPI 3.1 document."""
    try:
        base = (ctx.obj.get("api_url") or config.load()["api_url"]).split("/api/v1/developer")[0]
        request = urllib.request.Request(f"{base}/api/developer/openapi", headers={
            "Accept": "application/json", "User-Agent": USER_AGENT,
        })
        with urllib.request.urlopen(request, timeout=30) as response:
            emit(ctx, json.loads(response.read()))
    except Exception as exc:
        fail(exc)


@cli.group()
def generations():
    """Estimate, create, list, wait for and download generations."""


def input_map(values, prompt, duration):
    result = {}
    for item in values:
        if "=" not in item:
            raise click.ClickException(f"--input must be KEY=VALUE: {item}")
        key, value = item.split("=", 1)
        if not key:
            raise click.ClickException("--input key cannot be empty")
        result[key] = parse_value(value)
    if prompt is not None:
        result["prompt"] = prompt
    if duration is not None:
        result["duration_seconds"] = duration
    return result


def source_asset_map(values):
    result = []
    for item in values:
        if "=" not in item:
            raise click.ClickException(f"--source-asset must be SLOT=ASSET_ID: {item}")
        slot, asset_id = item.split("=", 1)
        if slot not in {"image", "endImage", "video", "audio"}:
            raise click.ClickException(f"Unsupported source slot: {slot}")
        result.append({"slot": slot, "asset_id": asset_id})
    if len(result) > 2:
        raise click.ClickException("Veyrnox accepts at most two source assets")
    return result


@generations.command("estimate")
@click.option("--model", required=True, help="Catalog model ID.")
@click.option("--duration", type=click.IntRange(1, 600), help="Video duration in seconds.")
@click.pass_context
def generation_estimate(ctx, model, duration):
    try:
        body = {"model_id": model, **({"duration_seconds": duration} if duration else {})}
        emit(ctx, client(ctx).request("POST", "/estimates", body),
            lambda v: f'Maximum: {v["maximum_credits"]} credits')
    except Exception as exc:
        fail(exc)


@generations.command("create")
@click.option("--model", required=True, help="Catalog model ID.")
@click.option("--prompt", help="Prompt text.")
@click.option("--duration", type=click.IntRange(1, 600), help="Video duration in seconds.")
@click.option("--input", "inputs", multiple=True, help="Additional model input as KEY=JSON_VALUE.")
@click.option("--source-asset", "source_assets", multiple=True, help="Owned Library asset as SLOT=ASSET_ID.")
@click.option("--idempotency-key", default=lambda: str(uuid.uuid4()), show_default="generated UUID")
@click.option("--confirmed-credits", type=click.IntRange(0), help="Exact maximum from an estimate.")
@click.option("--consent", is_flag=True, help="Attest rights for referenced media.")
@click.option("--yes", is_flag=True, help="Confirm the current estimate without prompting.")
@click.option("--dry-run", is_flag=True, help="Estimate only; never create a generation.")
@click.pass_context
def generation_create(ctx, model, prompt, duration, inputs, source_assets, idempotency_key, confirmed_credits, consent, yes, dry_run):
    try:
        api = client(ctx)
        controls = input_map(inputs, prompt, duration)
        sources = source_asset_map(source_assets)
        if sources and not consent:
            raise click.ClickException("Library sources require --consent to attest your rights")
        estimate_duration = controls.get("duration_seconds")
        quote = api.request("POST", "/estimates", {"model_id": model,
            **({"duration_seconds": estimate_duration} if isinstance(estimate_duration, int) else {})})
        expected = quote["maximum_credits"]
        if dry_run:
            emit(ctx, {"dry_run": True, "request": {"model_id": model, "inputs": controls,
                **({"source_assets": sources, "consent": True} if sources else {})}, "estimate": quote})
            return
        if confirmed_credits is not None and confirmed_credits != expected:
            raise click.ClickException(f"--confirmed-credits is {confirmed_credits}; live estimate is {expected}")
        if confirmed_credits is None:
            if yes:
                confirmed_credits = expected
            elif not sys.stdin.isatty() or ctx.obj["json"]:
                raise click.ClickException(f"Non-interactive creation requires --confirmed-credits {expected} or --yes")
            elif click.confirm(f"This generation can charge up to {expected} credits. Continue?"):
                confirmed_credits = expected
            else:
                raise click.Abort()
        body = {"model_id": model, "idempotency_key": idempotency_key,
            "confirmed_credits": confirmed_credits, "inputs": controls, "consent": consent}
        if sources:
            body["source_assets"] = sources
        emit(ctx, api.request("POST", "/generations", body),
            lambda v: f'Generation {v["job_id"]} created.')
    except (click.ClickException, click.Abort):
        raise
    except Exception as exc:
        fail(exc)


@generations.command("list")
@click.option("--limit", type=click.IntRange(1, 50), default=24, show_default=True)
@click.pass_context
def generations_list(ctx, limit):
    try:
        value = client(ctx).request("GET", f"/generations?limit={limit}")
        emit(ctx, value, lambda v: "\n".join(f'{j["job_id"]} {j["state"]:10} {j["model_id"]}' for j in v["jobs"]))
    except Exception as exc:
        fail(exc)


@generations.command("get")
@click.argument("job_id")
@click.pass_context
def generation_get(ctx, job_id):
    try:
        emit(ctx, client(ctx).request("GET", f"/generations/{job_id}"))
    except Exception as exc:
        fail(exc)


@generations.command("wait")
@click.argument("job_id")
@click.option("--interval", type=click.FloatRange(0.2, 60), default=2.0, show_default=True)
@click.option("--timeout", type=click.IntRange(1, 86400), default=900, show_default=True)
@click.pass_context
def generation_wait(ctx, job_id, interval, timeout):
    try:
        api, deadline = client(ctx), time.monotonic() + timeout
        while True:
            value = api.request("GET", f"/generations/{job_id}")
            if value.get("state") in {"succeeded", "failed"}:
                emit(ctx, value)
                if value["state"] == "failed":
                    raise click.ClickException("Generation failed")
                return
            if time.monotonic() >= deadline:
                raise click.ClickException("Timed out waiting for generation")
            time.sleep(interval)
    except click.ClickException:
        raise
    except Exception as exc:
        fail(exc)


@generations.command("download")
@click.argument("job_id")
@click.option("--output", "output_path", required=True, type=click.Path(dir_okay=False))
@click.pass_context
def generation_download(ctx, job_id, output_path):
    try:
        emit(ctx, client(ctx).download(job_id, output_path), lambda v: f'Downloaded {v["bytes"]} bytes to {v["path"]}.')
    except Exception as exc:
        fail(exc)


def repl():
    skin = ReplSkin("veyrnox", __version__)
    skin.print_banner()
    while True:
        try:
            line = input(skin.prompt()).strip()
        except (EOFError, KeyboardInterrupt):
            click.echo()
            break
        if not line:
            continue
        if line in {"quit", "exit"}:
            break
        args = ["--help"] if line == "help" else shlex.split(line)
        try:
            cli.main(args=args, prog_name="veyrnox", standalone_mode=False)
        except (click.ClickException, click.UsageError) as exc:
            skin.error(exc.format_message())
        except click.Abort:
            skin.error("Aborted")
    skin.print_goodbye()


def main():
    cli()
