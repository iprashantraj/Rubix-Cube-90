#!/usr/bin/env python3
"""Turn one Supabase personal access token into a working .env.

Paste the token into web/api/.supabase-token, run this, done. Everything else — project
ref, region, pooler hostnames, storage credentials, the bucket itself — is derived or
created here, because every one of them is a value you would otherwise copy by hand out of
four different dashboard pages and get subtly wrong once.

Two things worth knowing before running it:

  * It ROTATES the database password. The Management API can set a password but cannot read
    one, so a password we generate is the only one we can put in a connection string. Any
    other place holding the old password stops working.

  * Storage auth uses the session-token form (access key = project ref, secret = anon key,
    session token = service_role JWT) rather than a generated S3 access-key pair, because
    the Management API has no endpoint that mints those pairs — they only exist behind a
    dashboard button. Same privileges, same bypass of RLS: keep it server-side.

Re-running is safe: it overwrites the same keys, and the bucket create tolerates 409.
"""

from __future__ import annotations

import json
import re
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOKEN_FILE = HERE / ".supabase-token"
ENV_FILE = HERE / ".env"
BUCKET = "kaarigar"
RAW_BUCKET = "kaarigar-raw"
API = "https://api.supabase.com"

MANAGED = (
    "DATABASE_URL",
    "DATABASE_MIGRATION_URL",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "S3_REGION",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "S3_SESSION_TOKEN",
    "S3_RAW_BUCKET",
)


def existing_password() -> str | None:
    """The password already in .env, URL-decoded, if a pooler URL is there."""
    if not ENV_FILE.exists():
        return None
    m = re.search(r"^DATABASE_URL=\w+\+?\w*://[^:]+:([^@]+)@.*pooler", ENV_FILE.read_text(), re.M)
    return urllib.parse.unquote(m.group(1)) if m else None


def die(msg: str) -> None:
    sys.exit(f"error: {msg}")


def call(method: str, url: str, token: str, body: dict | None = None, extra: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        # Cloudflare fronts api.supabase.com and rejects the default Python-urllib agent
        # with "error code: 1010", which reads like an auth failure and is not one.
        "User-Agent": "kaarigar-bootstrap/1.0",
    }
    headers.update(extra or {})
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:400]
        return e.code, detail
    except urllib.error.URLError as e:
        die(f"cannot reach {url}: {e.reason}")


def read_token() -> str:
    if not TOKEN_FILE.exists():
        die(f"{TOKEN_FILE} not found")
    for line in TOKEN_FILE.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and line != "sbp_PASTE_HERE":
            return line
    die(f"no token in {TOKEN_FILE} — paste the sbp_... value and save")


def pick_project(token: str) -> dict:
    status, projects = call("GET", f"{API}/v1/projects", token)
    if status == 401:
        die("token rejected (401). Generate a fresh one at supabase.com/dashboard/account/tokens")
    if status != 200:
        die(f"listing projects failed ({status}): {projects}")
    live = [p for p in projects if p.get("status") == "ACTIVE_HEALTHY"]
    if not live:
        die(f"no ACTIVE_HEALTHY project on this account (found {len(projects)} in other states)")
    # A ref on the command line, not a prompt: this script rotates a database password, and
    # picking the wrong entry from a list does that to somebody else's project.
    wanted = sys.argv[1] if len(sys.argv) > 1 else None
    if wanted:
        match = next((p for p in live if p["ref"] == wanted), None)
        return match or die(f"no ACTIVE_HEALTHY project with ref {wanted}")
    if len(live) == 1:
        return live[0]
    for p in live:
        print(f"  {p['ref']}  {p['name']} ({p['region']})")
    die("several projects — re-run as: python3 bootstrap_supabase.py <ref>")


def api_keys(token: str, ref: str) -> tuple[str, str]:
    """anon + service_role JWTs. Both are legacy-format keys on purpose.

    Storage's session-token auth does not accept the newer sb_publishable_/sb_secret_ keys
    (documented, not an oversight), so a project with legacy keys disabled cannot use this
    path at all — worth saying plainly rather than failing later inside boto3.
    """
    status, keys = call("GET", f"{API}/v1/projects/{ref}/api-keys?reveal=true", token)
    if status != 200:
        die(f"reading API keys failed ({status}): {keys}")
    by_name = {k.get("name"): k.get("api_key") for k in keys}
    anon, service = by_name.get("anon"), by_name.get("service_role")
    if not (anon and service):
        die(
            "this project has no legacy anon/service_role JWT keys. Supabase Storage's S3 "
            "session-token auth requires them: enable legacy keys in Project Settings -> "
            "API Keys, or paste an S3 access key pair into .env by hand."
        )
    return anon, service


def pooler_hosts(token: str, ref: str) -> tuple[str, str, str]:
    status, cfgs = call("GET", f"{API}/v1/projects/{ref}/config/database/pooler", token)
    if status != 200:
        die(f"reading pooler config failed ({status}): {cfgs}")
    # Runtime uses the transaction pooler; Alembic needs session mode (advisory locks and
    # long DDL transactions do not survive transaction pooling). See db.py.
    tx = next((c for c in cfgs if c.get("pool_mode") == "transaction"), cfgs[0])
    host, user = tx["db_host"], tx["db_user"]
    return host, user, tx.get("db_name", "postgres")


def rotate_password(token: str, ref: str) -> str:
    password = secrets.token_urlsafe(32)
    status, body = call(
        "PATCH", f"{API}/v1/projects/{ref}/database/password", token, {"password": password}
    )
    if status not in (200, 201, 204):
        die(f"setting database password failed ({status}): {body}")
    return password


def ensure_bucket(ref: str, service_key: str, name: str, public: bool) -> None:
    """Create the bucket, or force its public flag if it already exists.

    Public-read is a bucket-level property, so the raw/public split in storage.py needs two
    buckets — see its module docstring. Forcing the flag on an existing bucket matters in
    both directions: a private public-bucket makes every product image 400, and a public
    raw-bucket exposes the artisan's original photograph to anyone with the URL.
    """
    url = f"https://{ref}.supabase.co/storage/v1/bucket"
    auth = {"apikey": service_key}
    status, body = call("POST", url, service_key, {"id": name, "name": name, "public": public}, auth)
    if status in (200, 201):
        print(f"  bucket {name!r} created ({'public' if public else 'private'})")
        return
    if status == 409 or (isinstance(body, str) and "already exists" in body):
        status, body = call("PUT", f"{url}/{name}", service_key, {"public": public}, auth)
        if status not in (200, 204):
            die(f"bucket {name!r} exists but its public flag could not be set ({status}): {body}")
        print(f"  bucket {name!r} already existed, forced {'public' if public else 'private'}")
        return
    die(f"creating bucket {name!r} failed ({status}): {body}")


def write_env(values: dict[str, str]) -> None:
    old = ENV_FILE.read_text() if ENV_FILE.exists() else ""
    if old:
        # with_name, not with_suffix: ".env" is a dotfile with no suffix, so with_suffix
        # produces ".env.env.bak" — a name .gitignore does not cover. It holds credentials.
        backup = ENV_FILE.with_name(ENV_FILE.name + ".bak")
        backup.write_text(old)
        backup.chmod(0o600)
    kept = [ln for ln in old.splitlines() if not re.match(rf"^({'|'.join(MANAGED)})=", ln)]
    lines = "\n".join(kept).rstrip() + "\n\n# Written by bootstrap_supabase.py.\n"
    lines += "".join(f"{k}={v}\n" for k, v in values.items())
    ENV_FILE.write_text(lines)
    ENV_FILE.chmod(0o600)


def main() -> None:
    token = read_token()
    project = pick_project(token)
    ref, region = project["ref"], project["region"]
    print(f"project {project['name']} ({ref}, {region})")

    anon, service = api_keys(token, ref)
    host, user, dbname = pooler_hosts(token, ref)

    # Re-running to fix storage should not invalidate a password that already works.
    password = existing_password()
    if password:
        print("  reusing the database password already in .env")
    else:
        print("  rotating database password (the API cannot read the existing one)")
        password = rotate_password(token, ref)

    ensure_bucket(ref, service, BUCKET, public=True)
    ensure_bucket(ref, service, RAW_BUCKET, public=False)

    # The password is URL-encoded: generated ones contain characters that terminate a URI
    # userinfo field early, which surfaces as an authentication failure that looks like a
    # wrong password rather than a quoting bug.
    creds = f"{user}:{urllib.parse.quote(password, safe='')}@{host}"
    write_env(
        {
            "DATABASE_URL": f"postgresql+psycopg://{creds}:6543/{dbname}",
            "DATABASE_MIGRATION_URL": f"postgresql+psycopg://{creds}:5432/{dbname}",
            "S3_ENDPOINT": f"https://{ref}.supabase.co/storage/v1/s3",
            "S3_BUCKET": BUCKET,
            "S3_RAW_BUCKET": RAW_BUCKET,
            "S3_REGION": region,
            "S3_ACCESS_KEY": ref,
            "S3_SECRET_KEY": anon,
            "S3_SESSION_TOKEN": service,
        }
    )
    print(f"  wrote {ENV_FILE} (previous copy: .env.bak)")
    print("\nnext: alembic upgrade head")


if __name__ == "__main__":
    main()
