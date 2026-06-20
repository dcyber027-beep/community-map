"""
Critical security & data-behaviour tests (Phase 1 hardening).

Covered:
  - admin endpoints reject unauthenticated requests
  - rate limits trigger (429)
  - user text is stored/returned verbatim (the backend never executes it; the
    frontend escapes via escapeHtml/DOMPurify — see frontend/app.js)
  - expired street notes disappear; 'forever' notes persist
  - private contact info is not exposed unless the author opted in
  - moderation: reported content can be hidden and is removed from public feeds
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

from pymongo import MongoClient


def _make_incident(client, description="hello world"):
    res = client.post(
        "/api/incidents",
        json={
            "category": "other",
            "urgency": "low",
            "description": description,
            "latitude": -37.84,
            "longitude": 145.11,
        },
    )
    assert res.status_code == 200, res.text
    return res.json()


# ── Admin auth ────────────────────────────────────────────────────────────────
class TestAdminAuthRequired:
    def test_admin_incidents_requires_auth(self, client):
        assert client.get("/api/admin/incidents").status_code == 401

    def test_admin_delete_requires_auth(self, client):
        assert client.delete(f"/api/admin/incidents/{uuid.uuid4()}").status_code == 401

    def test_admin_reports_queue_requires_auth(self, client):
        assert client.get("/api/admin/reports").status_code == 401

    def test_admin_report_action_requires_auth(self, client):
        res = client.post(
            f"/api/admin/reports/{uuid.uuid4()}/action", json={"action": "hide"}
        )
        assert res.status_code == 401

    def test_invalid_token_rejected(self, client):
        res = client.get(
            "/api/admin/incidents",
            headers={"Authorization": "Bearer not-a-real-token"},
        )
        assert res.status_code == 401

    def test_valid_token_allows_access(self, client, auth_headers):
        res = client.get("/api/admin/incidents", headers=auth_headers)
        assert res.status_code == 200


# ── Rate limiting ───────────────────────────────────────────────────────────--
class TestRateLimits:
    def test_admin_verify_rate_limited(self, client):
        # 5 allowed per minute; the 6th must be throttled.
        statuses = []
        for _ in range(6):
            r = client.post(
                "/api/admin/verify", json={"account": "x", "pin": "000000"}
            )
            statuses.append(r.status_code)
        assert statuses[:5] == [401] * 5
        assert statuses[5] == 429
        # Throttled responses must tell the client how long to wait.
        last = client.post("/api/admin/verify", json={"account": "x", "pin": "000000"})
        assert last.status_code == 429
        assert int(last.headers["Retry-After"]) > 0

    def test_incident_create_rate_limited(self, client):
        # 10 allowed per minute; the 11th must be throttled.
        codes = []
        for _ in range(11):
            r = client.post(
                "/api/incidents",
                json={
                    "category": "other",
                    "urgency": "low",
                    "description": "rl",
                    "latitude": -37.84,
                    "longitude": 145.11,
                },
            )
            codes.append(r.status_code)
        assert codes[:10] == [200] * 10
        assert codes[10] == 429


# ── Stored-XSS payload handling ───────────────────────────────────────────────
class TestXssPayloadStoredAsText:
    def test_incident_description_returned_verbatim(self, client):
        payload = "<script>alert('xss')</script><img src=x onerror=alert(1)>"
        created = _make_incident(client, payload)
        feed = client.get("/api/incidents").json()
        match = next((i for i in feed if i["id"] == created["id"]), None)
        assert match is not None
        # The backend stores/returns the raw text unchanged — it is treated as
        # data, never executed. The frontend is responsible for escaping it on
        # render (escapeHtml / DOMPurify), so it shows as literal text.
        assert match["description"] == payload


# ── Expiry behaviour ─────────────────────────────────────────────────────────-
class TestExpiry:
    def test_expired_note_is_removed_and_forever_note_persists(self, client):
        past = datetime.now(timezone.utc) - timedelta(hours=1)
        expired_id = str(uuid.uuid4())
        forever_id = str(uuid.uuid4())

        # Seed directly via pymongo so we can backdate expiry past the API
        # minimum (the create endpoint enforces a 1-hour floor).
        mc = MongoClient(os.environ["MONGO_URL"])
        try:
            notes_coll = mc[os.environ["DB_NAME"]].street_notes
            notes_coll.insert_many(
                [
                    {
                        "id": expired_id,
                        "text": "expired note",
                        "latitude": -37.8,
                        "longitude": 145.0,
                        "created_at": past,
                        "expires_at": past,  # real BSON date in the past
                        "forever": False,
                        "kind": "discovery",
                    },
                    {
                        "id": forever_id,
                        "text": "forever note",
                        "latitude": -37.8,
                        "longitude": 145.0,
                        "created_at": past,
                        "expires_at": None,  # permanent
                        "forever": True,
                        "kind": "discovery",
                    },
                ]
            )
        finally:
            mc.close()

        notes = client.get("/api/street-notes").json()
        ids = {n["id"] for n in notes}
        assert expired_id not in ids  # cleaned up on fetch
        assert forever_id in ids      # permanent note survives


# ── Private contact info privacy ──────────────────────────────────────────────
class TestContactPrivacy:
    def _post_note(self, client, contact_public):
        res = client.post(
            "/api/street-notes",
            json={
                "text": "Lost dog near park",
                "latitude": -37.8,
                "longitude": 145.0,
                "kind": "helping_hand",
                "contact_public": contact_public,
                "contact_name": "Alex",
                "contact_phone": "0400123456",
                "contact_email": "alex@example.com",
                "duration_hours": 12,
            },
        )
        assert res.status_code == 200, res.text
        return res.json()["note"]["id"]

    def test_contact_hidden_when_not_opted_in(self, client):
        note_id = self._post_note(client, contact_public=False)
        notes = client.get("/api/street-notes").json()
        note = next(n for n in notes if n["id"] == note_id)
        assert note.get("contact_phone") is None
        assert note.get("contact_email") is None

    def test_contact_shown_when_opted_in(self, client):
        note_id = self._post_note(client, contact_public=True)
        notes = client.get("/api/street-notes").json()
        note = next(n for n in notes if n["id"] == note_id)
        assert note.get("contact_phone") == "0400123456"
        assert note.get("contact_email") == "alex@example.com"


# ── Moderation ────────────────────────────────────────────────────────────────
class TestModeration:
    def test_report_then_hide_removes_from_public_feed(self, client, auth_headers):
        incident = _make_incident(client, "spammy content")
        iid = incident["id"]

        # Public report
        rep = client.post(
            "/api/reports",
            json={
                "target_type": "incident",
                "target_id": iid,
                "reason": "spam",
                "details": "obvious spam",
            },
        )
        assert rep.status_code == 200, rep.text

        # Appears in the admin queue with a content preview
        queue = client.get("/api/admin/reports", headers=auth_headers).json()
        report = next(r for r in queue["reports"] if r["target_id"] == iid)
        assert report["target"]["text"] == "spammy content"

        # Hide it
        act = client.post(
            f"/api/admin/reports/{report['id']}/action",
            headers=auth_headers,
            json={"action": "hide"},
        )
        assert act.status_code == 200

        # Gone from the public feed, still visible to admins
        public_ids = {i["id"] for i in client.get("/api/incidents").json()}
        assert iid not in public_ids
        admin_ids = {
            i["id"] for i in client.get("/api/admin/incidents", headers=auth_headers).json()
        }
        assert iid in admin_ids

    def test_report_unknown_target_404(self, client):
        res = client.post(
            "/api/reports",
            json={
                "target_type": "incident",
                "target_id": str(uuid.uuid4()),
                "reason": "spam",
            },
        )
        assert res.status_code == 404

    def test_invalid_report_reason_rejected(self, client):
        incident = _make_incident(client, "x")
        res = client.post(
            "/api/reports",
            json={
                "target_type": "incident",
                "target_id": incident["id"],
                "reason": "not-a-real-reason",
            },
        )
        assert res.status_code == 422
