"""The CMS host and its backup bucket as CloudWatch and S3 see them.

Nothing is stored: CloudWatch keeps daily datapoints for 15 months, so each
report asks it again and keeps the answer in memory for CACHE_FOR. Only
free-tier calls are used (GetMetricStatistics, ListObjectsV2); the host has
no CloudWatch agent, so memory and disk are not available.
"""

import threading
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from blog import config

CACHE_FOR = timedelta(minutes=5)
DAY = 86400
BACKUP_PREFIX = "cms/"


@dataclass(frozen=True)
class HostDay:
    day: date
    cpu_average: float | None
    cpu_maximum: float | None
    network_in: int
    network_out: int
    status_check_failures: int


@dataclass(frozen=True)
class Backup:
    key: str
    size: int
    modified: datetime


@dataclass(frozen=True)
class Infrastructure:
    configured: bool
    start: date
    end: date
    fetched_at: datetime | None = None
    error: str | None = None
    instance_id: str | None = None
    host: tuple[HostDay, ...] = ()
    bucket: str | None = None
    bucket_bytes: int | None = None
    bucket_objects: int | None = None
    latest_backup: Backup | None = None


_cache: dict[int, tuple[datetime, Infrastructure]] = {}
_lock = threading.Lock()


def _clients(settings: config.Settings) -> tuple[Any, Any]:
    cfg = Config(region_name=settings.aws_region, connect_timeout=5, read_timeout=15, retries={"max_attempts": 2})
    return boto3.client("cloudwatch", config=cfg), boto3.client("s3", config=cfg)


def _by_day(points: list[dict], stat: str) -> dict[date, float]:
    return {p["Timestamp"].astimezone(UTC).date(): p[stat] for p in points}


def _metric(cloudwatch: Any, namespace: str, name: str, dimensions: dict[str, str], stats: list[str], start: datetime, end: datetime) -> list[dict]:
    return cloudwatch.get_metric_statistics(
        Namespace=namespace,
        MetricName=name,
        Dimensions=[{"Name": k, "Value": v} for k, v in dimensions.items()],
        StartTime=start,
        EndTime=end,
        Period=DAY,
        Statistics=stats,
    )["Datapoints"]


def _host(cloudwatch: Any, instance_id: str, start: date, end: date, now: datetime) -> tuple[HostDay, ...]:
    since = datetime.combine(start, time(), UTC)
    ec2 = {"InstanceId": instance_id}
    cpu = _metric(cloudwatch, "AWS/EC2", "CPUUtilization", ec2, ["Average", "Maximum"], since, now)
    received = _by_day(_metric(cloudwatch, "AWS/EC2", "NetworkIn", ec2, ["Sum"], since, now), "Sum")
    sent = _by_day(_metric(cloudwatch, "AWS/EC2", "NetworkOut", ec2, ["Sum"], since, now), "Sum")
    failed = _by_day(_metric(cloudwatch, "AWS/EC2", "StatusCheckFailed", ec2, ["Sum"], since, now), "Sum")
    average, maximum = _by_day(cpu, "Average"), _by_day(cpu, "Maximum")
    days = sorted(average.keys() | received.keys() | sent.keys() | failed.keys())
    return tuple(
        HostDay(
            day=d,
            cpu_average=average.get(d),
            cpu_maximum=maximum.get(d),
            network_in=int(received.get(d, 0)),
            network_out=int(sent.get(d, 0)),
            status_check_failures=int(failed.get(d, 0)),
        )
        for d in days
        if start <= d <= end
    )


def _latest_metric(cloudwatch: Any, name: str, bucket: str, storage: str, now: datetime) -> int | None:
    # S3 publishes storage metrics once a day, about a day late.
    points = _metric(cloudwatch, "AWS/S3", name, {"BucketName": bucket, "StorageType": storage}, ["Average"], now - timedelta(days=3), now)
    return int(max(points, key=lambda p: p["Timestamp"])["Average"]) if points else None


def _latest_backup(s3: Any, bucket: str) -> Backup | None:
    latest = None
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=BACKUP_PREFIX):
        for o in page.get("Contents", []):
            if o["Key"].endswith(".dump") and (latest is None or o["LastModified"] > latest["LastModified"]):
                latest = o
    return Backup(latest["Key"], latest["Size"], latest["LastModified"]) if latest else None


def _fetch(settings: config.Settings, start: date, end: date, now: datetime) -> Infrastructure:
    assert settings.aws_instance_id
    cloudwatch, s3 = _clients(settings)
    result = Infrastructure(
        configured=True,
        start=start,
        end=end,
        fetched_at=now,
        instance_id=settings.aws_instance_id,
        host=_host(cloudwatch, settings.aws_instance_id, start, end, now),
    )
    if not (bucket := settings.backup_bucket):
        return result
    return replace(
        result,
        bucket=bucket,
        bucket_bytes=_latest_metric(cloudwatch, "BucketSizeBytes", bucket, "StandardStorage", now),
        bucket_objects=_latest_metric(cloudwatch, "NumberOfObjects", bucket, "AllStorageTypes", now),
        latest_backup=_latest_backup(s3, bucket),
    )


def report(days: int, now: datetime, refresh: bool = False) -> Infrastructure:
    """The last `days` UTC days, from cache unless it is older than CACHE_FOR or `refresh` is set."""
    end = now.astimezone(UTC).date()
    start = end - timedelta(days=days - 1)
    settings = config.settings
    if not settings.aws_instance_id:
        return Infrastructure(configured=False, start=start, end=end)
    with _lock:
        cached = _cache.get(days)
        if cached and not refresh and now - cached[0] < CACHE_FOR:
            return cached[1]
        try:
            result = _fetch(settings, start, end, now)
        except (BotoCoreError, ClientError) as e:
            # Errors are not cached, so the next view tries again.
            return Infrastructure(configured=True, start=start, end=end, error=str(e)[:300])
        _cache[days] = (now, result)
        return result
