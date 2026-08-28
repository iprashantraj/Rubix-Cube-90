from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Anchored to this file, not the working directory. A relative ".env" silently resolves
# against wherever the process happened to start, so the API would fall back to every
# default and then fail on the first database call with a connection error that says
# nothing about the real cause.
ENV_FILE = Path(__file__).resolve().parent / ".env"


class Settings(BaseSettings):
    """Every secret comes from the environment. Nothing here has a usable default."""

    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    # Runtime connection. On Supabase this is the TRANSACTION pooler (port 6543) — it is
    # what survives a lot of short-lived serverless-ish connections. See db.py for the two
    # settings pgbouncer forces on us.
    database_url: str = "postgresql+psycopg://kaarigar:kaarigar@localhost:5432/kaarigar"

    # Migrations need a different connection. Alembic takes advisory locks and runs long
    # DDL transactions, and neither survives transaction-mode pooling — so migrations go
    # through the SESSION pooler (port 5432) or a direct connection. Defaults to
    # database_url so a plain local Postgres needs no second setting.
    database_migration_url: str = ""

    redis_url: str = "redis://localhost:6379/0"

    @property
    def migration_url(self) -> str:
        return self.database_migration_url or self.database_url

    # AI service. web/ calls ai/ over HTTP and never imports across that line — they are
    # separate deploy units and the AI box has a GPU that this one does not.
    ai_base_url: str = "http://localhost:8001"

    # Where uploaded chunks are assembled and kept.
    #
    # Local filesystem, not S3, and deliberately so for now: `ai/` has to be able to open
    # the URL that `POST /uploads/{id}/complete` hands back, and in dev both services run
    # on one machine. The url is a `file://` URI. Swapping this for S3 is a change to
    # `routers/uploads.py::_store` and nothing else — every caller only ever sees the url.
    #
    # Anchored to this file rather than the working directory, for the same reason ENV_FILE
    # is: a relative default silently resolves against wherever the process was started.
    storage_dir: str = str(Path(__file__).resolve().parent / ".storage")

    # Object storage for raw and enhanced images.
    s3_endpoint: str = "http://localhost:9000"
    # Two buckets, because "public" is a property of a BUCKET, not of a key prefix. A public
    # bucket serves every object in it to anyone with the URL, so raw originals cannot live
    # in the same one as the marketplace variants no matter how the keys are named.
    s3_bucket: str = "kaarigar"
    s3_raw_bucket: str = "kaarigar-raw"
    # Supabase ignores the value but the S3 signature requires one.
    s3_region: str = "us-east-1"
    s3_access_key: str = ""
    s3_secret_key: str = ""
    # Supabase's second S3 auth mode: access key = project ref, secret = anon key, and this
    # JWT carries the actual authority. Empty for MinIO and for a generated S3 key pair,
    # which authenticate on the pair alone.
    s3_session_token: str = ""

    # Bhashini (MeitY) — ASR, translation, TTS for Indian languages.
    bhashini_user_id: str = ""
    bhashini_api_key: str = ""
    bhashini_pipeline_url: str = "https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline"

    # Sarvam AI — ASR and TTS for Indian languages. Tried BEFORE Bhashini: it is one
    # documented REST call with one key, where Bhashini needs a pipeline-config round trip
    # first and its commercial terms are still unconfirmed (spec §18 item 5).
    #
    # Whichever is configured wins. With both, Sarvam leads and Bhashini is the fallback,
    # so losing a provider costs quality rather than going silent — and silence, for a user
    # who cannot read, is the app not working at all.
    sarvam_api_key: str = ""
    sarvam_base_url: str = "https://api.sarvam.ai"

    # Auth.
    jwt_secret: str = ""
    jwt_ttl_hours: int = 720  # long-lived on purpose: re-authenticating is a real burden
    otp_ttl_seconds: int = 300

    # 🔒 Wraps the only third-party credentials we ever hold: Amazon and Flipkart OAuth
    # refresh tokens (spec §14.2 exception). Fernet key, base64, 32 bytes.
    # Everything else about a channel is a boolean or a self-reported status.
    token_encryption_key: str = ""

    # Channel credentials. Absent in dev; the adapters fall back to dry-run.
    amazon_client_id: str = ""
    amazon_client_secret: str = ""
    flipkart_app_id: str = ""
    flipkart_app_secret: str = ""

    # ONDC. We register once as a Marketplace Seller Node; artisans are sub-sellers under
    # this subscriber id and never register themselves. See docs/decisions.md.
    ondc_subscriber_id: str = ""
    ondc_signing_private_key: str = ""
    ondc_encryption_private_key: str = ""
    ondc_registry_url: str = "https://staging.registry.ondc.org"

    environment: str = "dev"

    @property
    def is_dev(self) -> bool:
        return self.environment == "dev"


@lru_cache
def settings() -> Settings:
    return Settings()
