"""
Pytest configuration for the backend test suite.

Tests run against a DEDICATED test database (community_map_test by default) on
the same MongoDB connection, so they never touch production data. The whole
test database is dropped at the end of the session.

Environment is configured BEFORE importing server.py, because server.py reads
configuration (MONGO_URL, DB_NAME, admin creds, JWT secret) at import time.
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent

# Load MONGO_URL (and friends) from backend/.env, then force a dev/test config.
load_dotenv(BACKEND_DIR / ".env", override=True)

os.environ["ENVIRONMENT"] = "development"
os.environ["DB_NAME"] = os.environ.get("TEST_DB_NAME", "community_map_test")
os.environ.setdefault("ADMIN_ACCOUNT", "admin")
os.environ.setdefault("ADMIN_PIN", "123456")
os.environ["ADMIN_JWT_SECRET"] = "test-secret-not-for-prod"
os.environ.setdefault("TRUSTED_PROXY_HOPS", "0")

sys.path.insert(0, str(BACKEND_DIR))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import server  # noqa: E402

ADMIN_ACCOUNT = os.environ["ADMIN_ACCOUNT"]
ADMIN_PIN = os.environ["ADMIN_PIN"]


@pytest.fixture(scope="session")
def client():
    # The context manager triggers FastAPI startup events (index/TTL creation
    # and the date migration) against the test database.
    with TestClient(server.app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def reset_rate_limit():
    """Clear the in-memory rate-limit buckets around every test so limits from
    one test never bleed into the next."""
    server._rate_store.clear()
    yield
    server._rate_store.clear()


@pytest.fixture
def admin_token(client):
    server._rate_store.clear()
    res = client.post(
        "/api/admin/verify",
        json={"account": ADMIN_ACCOUNT, "pin": ADMIN_PIN},
    )
    assert res.status_code == 200, res.text
    return res.json()["token"]


@pytest.fixture
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session", autouse=True)
def _clean_test_db_at_end():
    yield
    # Safety: only ever clean a database whose name clearly marks it as a test
    # DB. We empty each collection (a normal write) rather than dropDatabase,
    # which the Atlas app user is not permitted to do.
    db_name = os.environ["DB_NAME"]
    if not db_name.endswith("_test"):
        return
    from pymongo import MongoClient

    mc = MongoClient(os.environ["MONGO_URL"])
    try:
        test_db = mc[db_name]
        for coll_name in test_db.list_collection_names():
            test_db[coll_name].delete_many({})
    finally:
        mc.close()
