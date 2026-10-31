from datetime import UTC, datetime, timedelta

import pytest
from botocore.exceptions import ClientError

from blog import infra

NOW = datetime(2026, 10, 31, 12, 0, tzinfo=UTC)


def day(n: int) -> datetime:
    return datetime(2026, 10, n, tzinfo=UTC)


class FakeCloudWatch:
    def __init__(self):
        self.calls = []
        self.points = {
            "CPUUtilization": [{"Timestamp": day(30), "Average": 3.5, "Maximum": 41.0}, {"Timestamp": day(31), "Average": 2.0, "Maximum": 9.0}],
            "NetworkIn": [{"Timestamp": day(30), "Sum": 1_000.0}, {"Timestamp": day(31), "Sum": 500.0}],
            "NetworkOut": [{"Timestamp": day(30), "Sum": 2_000.0}],
            "StatusCheckFailed": [{"Timestamp": day(31), "Sum": 2.0}],
            "BucketSizeBytes": [{"Timestamp": day(29), "Average": 10.0}, {"Timestamp": day(30), "Average": 4_000_000.0}],
            "NumberOfObjects": [{"Timestamp": day(30), "Average": 12.0}],
        }

    def get_metric_statistics(self, **kw):
        self.calls.append(kw)
        return {"Datapoints": self.points[kw["MetricName"]]}


class FakeS3:
    def __init__(self, objects):
        self.objects = objects

    def get_paginator(self, name):
        assert name == "list_objects_v2"
        return self

    def paginate(self, Bucket, Prefix):
        assert (Bucket, Prefix) == ("blog-backups", "cms/")
        yield {"Contents": self.objects[:1]}
        yield {"Contents": self.objects[1:]}


@pytest.fixture(autouse=True)
def empty_cache():
    infra._cache.clear()
    yield
    infra._cache.clear()


@pytest.fixture
def aws(configure, monkeypatch):
    configure(aws_instance_id="i-0123456789abcdef0", aws_region="ap-northeast-1", backup_bucket="blog-backups")
    cloudwatch = FakeCloudWatch()
    s3 = FakeS3(
        [
            {"Key": "cms/blog-20261030T033000Z.dump", "Size": 1_700_000, "LastModified": day(30)},
            {"Key": "cms/blog-20261031T033000Z.dump", "Size": 1_800_000, "LastModified": day(31)},
            {"Key": "cms/blog-20261031T033000Z.dump.sha256", "Size": 90, "LastModified": day(31) + timedelta(seconds=1)},
        ]
    )
    monkeypatch.setattr(infra, "_clients", lambda settings: (cloudwatch, s3))
    return cloudwatch


def test_not_configured_never_calls_aws(client, monkeypatch):
    monkeypatch.setattr(infra, "_clients", lambda settings: pytest.fail("called AWS"))
    body = client.get("/api/infrastructure?days=7").json()
    assert body["configured"] is False
    assert body["host"] == []


def test_reports_host_days_bucket_and_latest_backup(client, aws, monkeypatch):
    monkeypatch.setattr(infra, "datetime", type("Clock", (), {"now": staticmethod(lambda tz: NOW), "combine": datetime.combine}))
    body = client.get("/api/infrastructure?days=7").json()
    assert body["error"] is None
    assert body["start"] == "2026-10-25" and body["end"] == "2026-10-31"
    assert body["host"] == [
        {"day": "2026-10-30", "cpu_average": 3.5, "cpu_maximum": 41.0, "network_in": 1000, "network_out": 2000, "status_check_failures": 0},
        {"day": "2026-10-31", "cpu_average": 2.0, "cpu_maximum": 9.0, "network_in": 500, "network_out": 0, "status_check_failures": 2},
    ]
    assert body["bucket_bytes"] == 4_000_000, "the newest daily storage datapoint"
    assert body["bucket_objects"] == 12
    assert body["latest_backup"]["key"] == "cms/blog-20261031T033000Z.dump", "checksum files are not backups"
    assert {c["Dimensions"][0]["Value"] for c in aws.calls if c["Namespace"] == "AWS/EC2"} == {"i-0123456789abcdef0"}


def test_answers_from_cache_until_refresh(client, aws):
    client.get("/api/infrastructure?days=7")
    calls = len(aws.calls)
    client.get("/api/infrastructure?days=7")
    assert len(aws.calls) == calls
    client.get("/api/infrastructure?days=7&refresh=true")
    assert len(aws.calls) == 2 * calls


def test_without_a_bucket_only_the_host_is_read(client, aws, configure):
    configure(backup_bucket=None)
    body = client.get("/api/infrastructure?days=28").json()
    assert body["bucket"] is None and body["latest_backup"] is None
    assert all(c["Namespace"] == "AWS/EC2" for c in aws.calls)


def test_aws_errors_are_shown_and_not_cached(client, aws, monkeypatch):
    def denied(**kw):
        raise ClientError({"Error": {"Code": "AccessDenied", "Message": "not allowed"}}, "GetMetricStatistics")

    monkeypatch.setattr(aws, "get_metric_statistics", denied)
    body = client.get("/api/infrastructure?days=7").json()
    assert body["configured"] is True and "AccessDenied" in body["error"]
    assert infra._cache == {}


def test_rejects_other_ranges(client, aws):
    assert client.get("/api/infrastructure?days=30").status_code == 422
