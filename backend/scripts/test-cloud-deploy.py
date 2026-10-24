"""Run without Docker: python scripts/test-cloud-deploy.py."""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("deploy-cloud.sh")

DOCKER = """#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
root = pathlib.Path(os.environ["STUB_ROOT"])
with (root / "calls").open("a") as log: log.write(json.dumps(args) + "\\n")
state = root / "running"
exists = root / "exists"
if args[0] == "inspect":
    if not exists.exists(): sys.exit(1)
    if "-f" in args: print("true" if state.exists() else "false")
elif args[0] in ("start", "stop", "rm"):
    if args[0] == "start": state.touch()
    else: state.unlink(missing_ok=True)
    if args[0] == "rm": exists.unlink(missing_ok=True)
elif args[0] == "run":
    if "scripts/backup.sh" in args and os.environ.get("FAIL_STAGE") == "backup": sys.exit(7)
    if "alembic" in args and os.environ.get("FAIL_STAGE") == "migration": sys.exit(8)
    if "-d" in args: exists.touch(); state.touch(); print("container-id")
elif args[0] == "exec" and os.environ.get("FAIL_STAGE") == "backup": sys.exit(7)
"""


class DeploymentTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.backups = self.root / "backup files"
        self.backups.mkdir()
        self.secrets = self.root / "secret files"
        self.secrets.mkdir()
        self.env_file = self.root / "cms.env"
        self.env_file.write_text("CMS_ENV=cloud\nCMS_GITHUB_TOKEN=never-print-this\n")
        for name, body in (("docker", DOCKER), ("curl", "#!/bin/sh\nexit 0\n")):
            file = self.bin / name
            file.write_text(body)
            file.chmod(0o755)
        (self.root / "exists").touch()
        (self.root / "running").touch()
        self.env = {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}", "STUB_ROOT": str(self.root)}

    def deploy(self, *extra, fail=""):
        return subprocess.run(
            [
                "bash",
                str(SCRIPT),
                "--image",
                "ghcr.io/example/cms@sha256:123",
                "--env-file",
                str(self.env_file),
                "--backup-dir",
                str(self.backups),
                "--secrets-dir",
                str(self.secrets),
                *extra,
            ],
            env={**self.env, "FAIL_STAGE": fail},
            capture_output=True,
            text=True,
        )

    def calls(self):
        log = self.root / "calls"
        return [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []

    def test_success_stops_writer_then_backs_up_migrates_and_starts_loopback_only(self):
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.calls()
        stop = next(i for i, call in enumerate(calls) if call[0] == "stop")
        backup = next(i for i, call in enumerate(calls) if "scripts/backup.sh" in call)
        migration = next(i for i, call in enumerate(calls) if "alembic" in call)
        start = next(i for i, call in enumerate(calls) if "-d" in call)
        self.assertLess(stop, backup)
        self.assertLess(backup, migration)
        self.assertLess(migration, start)
        self.assertIn("127.0.0.1", calls[start])
        self.assertIn(f"type=bind,source={self.secrets},target=/run/secrets,readonly", calls[start])
        self.assertNotIn("never-print-this", result.stdout + result.stderr)
        for call in (calls[backup], calls[migration], calls[start]):
            for flag in ("--read-only", "--cap-drop", "no-new-privileges", "type=volume,target=/tmp"):
                self.assertIn(flag, call)
        self.assertIn("max-size=10m", calls[start])
        self.assertNotIn("--memory", calls[start])

    def test_memory_limit_and_cloudwatch_logs_apply_to_the_cms(self):
        result = self.deploy("--memory", "768m", "--log-group", "/blog/cms", "--log-region", "ap-northeast-1")
        self.assertEqual(result.returncode, 0, result.stderr)
        start = next(call for call in self.calls() if "-d" in call)
        self.assertEqual(start[start.index("--memory") + 1], "768m")
        self.assertEqual(start[start.index("--log-driver") + 1], "awslogs")
        self.assertIn("awslogs-group=/blog/cms", start)
        self.assertIn("awslogs-region=ap-northeast-1", start)

    def test_log_group_without_region_is_rejected_before_docker(self):
        result = self.deploy("--log-group", "/blog/cms")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.calls(), [])

    def test_backup_failure_restarts_old_cms_without_migration(self):
        result = self.deploy(fail="backup")
        self.assertEqual(result.returncode, 7)
        self.assertFalse(any("alembic" in call for call in self.calls()))
        self.assertIn(["start", "blog-cms"], self.calls())

    def test_migration_failure_keeps_old_cms_stopped(self):
        result = self.deploy(fail="migration")
        self.assertEqual(result.returncode, 8)
        self.assertFalse(any("-d" in call or call[0] == "start" for call in self.calls()))
        self.assertFalse((self.root / "running").exists())

    def test_dry_run_does_not_invoke_docker(self):
        result = self.deploy("--dry-run")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), [])

    def test_invalid_configuration_does_not_stop_cms(self):
        result = self.deploy("--port", "0")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.calls(), [])

    def test_scheduled_backup_uploads_only_after_successful_backup(self):
        aws = self.bin / "aws"
        aws.write_text("#!/bin/sh\nprintf '%s\\n' aws >> \"$STUB_ROOT/uploaded\"\n")
        aws.chmod(0o755)
        result = subprocess.run(
            ["bash", str(SCRIPT.with_name("cloud-maintenance.sh")), "backup", "blog-cms", str(self.backups), "s3://test/cms"],
            env=self.env,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), [["exec", "blog-cms", "scripts/backup.sh", "--env", "--out", "/backup"]])
        self.assertTrue((self.root / "uploaded").exists())

    def test_failed_scheduled_backup_is_not_uploaded(self):
        aws = self.bin / "aws"
        aws.write_text('#!/bin/sh\ntouch "$STUB_ROOT/uploaded"\n')
        aws.chmod(0o755)
        result = subprocess.run(
            ["bash", str(SCRIPT.with_name("cloud-maintenance.sh")), "backup", "blog-cms", str(self.backups), "s3://test/cms"],
            env={**self.env, "FAIL_STAGE": "backup"},
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 7)
        self.assertFalse((self.root / "uploaded").exists())


class SsmEnvironmentTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "bin").mkdir()
        aws = self.root / "bin" / "aws"
        aws.write_text('#!/bin/sh\nprintf "%s\\n" "$*" > "$STUB_ROOT/aws-args"\ncat "$STUB_ROOT/parameters.json"\n')
        aws.chmod(0o755)
        self.env_file = self.root / "cms.env"
        self.env_file.write_text("CMS_ENV=cloud\nOLD=1\n")

    def render(self, parameters, *extra):
        (self.root / "parameters.json").write_text(json.dumps({"Parameters": [{"Name": f"/blog/cms/{k}", "Value": v} for k, v in parameters.items()]}))
        return subprocess.run(
            ["bash", str(SCRIPT.with_name("ssm-env.sh")), "--path", "/blog/cms", "--env-file", str(self.env_file), *extra],
            env={**os.environ, "PATH": f"{self.root / 'bin'}:{os.environ['PATH']}", "STUB_ROOT": str(self.root)},
            capture_output=True,
            text=True,
        )

    def test_writes_private_env_file_from_parameters(self):
        result = self.render({"CMS_GITHUB_TOKEN": "never-print-this", "CMS_ENV": "cloud"}, "--region", "ap-northeast-1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.env_file.read_text(), "CMS_ENV=cloud\nCMS_GITHUB_TOKEN=never-print-this\n")
        self.assertEqual(self.env_file.stat().st_mode & 0o777, 0o600)
        self.assertIn("--with-decryption", (self.root / "aws-args").read_text())
        self.assertIn("--region ap-northeast-1", (self.root / "aws-args").read_text())
        self.assertNotIn("never-print-this", result.stdout + result.stderr)

    def test_invalid_parameters_keep_the_previous_file(self):
        for parameters in ({"CMS_ENV": "cloud", "KEY": "a\nb"}, {"CMS_ENV": "local"}, {"CMS_ENV": "cloud", "bad-name": "x"}):
            result = self.render(parameters)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(self.env_file.read_text(), "CMS_ENV=cloud\nOLD=1\n")
        self.assertEqual([p.name for p in self.root.iterdir() if p.name.startswith(".cms.env")], [])


if __name__ == "__main__":
    unittest.main()
