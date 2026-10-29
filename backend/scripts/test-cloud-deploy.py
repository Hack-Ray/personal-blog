"""Run without Docker: python scripts/test-cloud-deploy.py."""

import json
import os
import subprocess
import tempfile
import textwrap
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


SETUP_STUB = """#!/usr/bin/env python3
import json, os, pathlib, sys
tool, args = pathlib.Path(sys.argv[0]).name, sys.argv[1:]
root = pathlib.Path(os.environ["STUB_ROOT"])
with (root / "calls").open("a") as log: log.write(json.dumps([tool, *args]) + "\\n")
containers = root / "containers"
containers.mkdir(exist_ok=True)
if tool == "aws":
    print((root / ("parameters.json" if "get-parameters-by-path" in args else "token")).read_text())
elif tool == "docker":
    if args[0] == "inspect":
        box = containers / args[-1]
        if not box.exists(): sys.exit(1)
        if "-f" in args: print(box.read_text())
    elif args[0] == "run":
        name = args[args.index("--name") + 1]
        if "--env-file" in args:
            (root / f"{name}-env-file").write_text(pathlib.Path(args[args.index("--env-file") + 1]).read_text())
        (containers / name).write_text("postgres:16" if name == "blog-db" else args[args.index("tunnel") - 1])
    elif args[0] == "rm":
        (containers / args[-1]).unlink()
"""


class HostSetupTest(unittest.TestCase):
    PASSWORD = "never-print-this"

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        for tool in ("dnf", "systemctl", "docker", "aws", "chown"):
            file = self.bin / tool
            file.write_text(SETUP_STUB)
            file.chmod(0o755)
        self.host = self.root / "host"
        (self.host / "etc/dnf").mkdir(parents=True)
        (self.host / "etc/dnf/automatic.conf").write_text("[commands]\nupgrade_type = default\napply_updates = no\n")
        self.srv = self.root / "srv"
        (self.root / "token").write_text("tunnel-token-1")
        self.parameters(f"postgresql+psycopg://blog:{self.PASSWORD}@127.0.0.1:5432/blog")
        self.env = {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}", "STUB_ROOT": str(self.root), "HOST_PREFIX": str(self.host)}

    def parameters(self, database_url):
        values = {"CMS_ENV": "cloud", "DATABASE_URL": database_url}
        (self.root / "parameters.json").write_text(json.dumps({"Parameters": [{"Name": f"/blog/cms/{k}", "Value": v} for k, v in values.items()]}))

    def setup_host(self, *extra):
        return subprocess.run(
            ["bash", str(SCRIPT.with_name("cloud-host-setup.sh")), "--region", "ap-northeast-1", "--root", str(self.srv), *extra],
            env=self.env,
            capture_output=True,
            text=True,
        )

    def calls(self):
        return [json.loads(line) for line in (self.root / "calls").read_text().splitlines()]

    def docker_runs(self):
        return [call for call in self.calls() if call[:2] == ["docker", "run"]]

    def test_first_run_prepares_host_and_local_database(self):
        result = self.setup_host("--tunnel-token-param", "/blog/cloudflared-token")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("upgrade_type = security", (self.host / "etc/dnf/automatic.conf").read_text())
        self.assertIn("apply_updates = yes", (self.host / "etc/dnf/automatic.conf").read_text())
        self.assertIn(["systemctl", "enable", "--now", "docker", "crond", "dnf-automatic.timer"], self.calls())
        self.assertEqual((self.srv / "cms.env").stat().st_mode & 0o777, 0o600)
        self.assertTrue((self.srv / "cloud-maintenance.sh").exists())
        self.assertEqual((self.srv / "backups").stat().st_mode & 0o777, 0o750)
        self.assertIn(["chown", "1000:1000", str(self.srv / "backups"), str(self.srv / "secrets")], self.calls())
        db = next(call for call in self.docker_runs() if "blog-db" in call)
        self.assertIn("127.0.0.1:5432:5432", db)
        self.assertIn("type=volume,source=blog-pgdata,target=/var/lib/postgresql/data", db)
        self.assertEqual((self.root / "blog-db-env-file").read_text(), f"POSTGRES_USER=blog\nPOSTGRES_PASSWORD={self.PASSWORD}\nPOSTGRES_DB=blog\n")
        self.assertIn(["docker", "exec", "blog-db", "pg_isready", "-q", "-U", "blog"], self.calls())
        self.assertNotIn(self.PASSWORD, (self.root / "calls").read_text() + result.stdout + result.stderr)

    def test_rerun_keeps_database_and_tunnel(self):
        self.assertEqual(self.setup_host("--tunnel-token-param", "/blog/cloudflared-token").returncode, 0)
        (self.root / "calls").unlink()
        result = self.setup_host("--tunnel-token-param", "/blog/cloudflared-token")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.docker_runs(), [])
        self.assertFalse(any(call[:2] == ["docker", "rm"] for call in self.calls()))
        self.assertIn(["docker", "start", "blog-db"], self.calls())
        self.assertNotIn(self.PASSWORD, (self.root / "calls").read_text())

    def test_non_local_database_is_skipped(self):
        self.parameters(f"postgresql+psycopg://blog:{self.PASSWORD}@db.example.rds.amazonaws.com:5432/blog")
        result = self.setup_host()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("skipping the local PostgreSQL container", result.stdout)
        self.assertFalse(any("blog-db" in call for call in self.calls()))

    def test_cron_runs_maintenance_hourly_and_backup_daily(self):
        self.assertEqual(self.setup_host().returncode, 0)
        cron = (self.host / "etc/cron.d/blog-cms").read_text().splitlines()
        self.assertEqual(cron[0], "PATH=/usr/local/bin:/usr/bin:/bin")
        self.assertTrue(cron[1].startswith(f"0 * * * * root bash {self.srv}/cloud-maintenance.sh maintenance blog-cms {self.srv}/backups "))
        self.assertTrue(cron[2].startswith(f"0 3 * * * root bash {self.srv}/cloud-maintenance.sh backup blog-cms {self.srv}/backups 2>&1"))
        self.assertEqual(self.setup_host("--s3", "s3://bucket/cms/").returncode, 0)
        cron = (self.host / "etc/cron.d/blog-cms").read_text().splitlines()
        self.assertIn(f"backup blog-cms {self.srv}/backups s3://bucket/cms/ 2>&1", cron[2])

    def test_tunnel_token_is_private_and_off_argv(self):
        result = self.setup_host("--tunnel-token-param", "/blog/cloudflared-token")
        self.assertEqual(result.returncode, 0, result.stderr)
        token_file = self.host / "etc/cloudflared/token.env"
        self.assertEqual(token_file.read_text(), "TUNNEL_TOKEN=tunnel-token-1\n")
        self.assertEqual(token_file.stat().st_mode & 0o777, 0o600)
        run = next(call for call in self.docker_runs() if "blog-cloudflared" in call)
        self.assertEqual(run[-4:], ["cloudflare/cloudflared:2026.10.0", "tunnel", "--no-autoupdate", "run"])
        for flag in ("--network", "--read-only", "ALL", "no-new-privileges", str(token_file)):
            self.assertIn(flag, run)
        self.assertNotIn("tunnel-token-1", (self.root / "calls").read_text() + result.stdout + result.stderr)

    def test_tunnel_is_recreated_when_token_or_image_changes(self):
        self.assertEqual(self.setup_host("--tunnel-token-param", "/blog/cloudflared-token").returncode, 0)
        for change in ("token", "image"):
            with self.subTest(change=change):
                (self.root / "calls").unlink()
                extra = ["--cloudflared-image", "cloudflare/cloudflared:2026.10.5"] if change == "image" else []
                if change == "token":
                    (self.root / "token").write_text("tunnel-token-2")
                result = self.setup_host("--tunnel-token-param", "/blog/cloudflared-token", *extra)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn(["docker", "rm", "-f", "blog-cloudflared"], self.calls())
                self.assertEqual(len([call for call in self.docker_runs() if "blog-cloudflared" in call]), 1)

    def test_missing_region_fails_before_changing_the_host(self):
        result = subprocess.run(["bash", str(SCRIPT.with_name("cloud-host-setup.sh"))], env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertFalse((self.root / "calls").exists())


class PagesCodeHeadTest(unittest.TestCase):
    """Execute the workflow's code check against controlled GitHub tree responses."""

    def test_site_changes_block_older_builds_but_other_changes_do_not(self):
        import contextlib
        import io
        from unittest.mock import patch

        source = (SCRIPT.parents[2] / ".github/workflows/deploy.yml").read_text()
        block = source.split("      - id: latest-code\n", 1)[1].split("      - id: deployment\n", 1)[0]
        shell = textwrap.dedent(block.split("        run: |\n", 1)[1])
        script = shell.split("python3 - <<'PYCODE'\n", 1)[1].rsplit("PYCODE", 1)[0]
        self.assertIn("steps.latest.outputs.current == 'true' && steps.latest-code.outputs.current == 'true'", source)
        original = {"frontend": "front-v1", ".nvmrc": "node-v1", ".github/workflows/deploy.yml": "workflow-v1", "backend": "back-v1", "docs": "docs-v1"}
        cases = [("same", {}, "true"), ("non-site", {"backend": "back-v2", "docs": "docs-v2"}, "true")]
        cases += [(path, {path: "new"}, "false") for path in ("frontend", ".nvmrc", ".github/workflows/deploy.yml")]
        cases += [("truncated", {}, None), ("missing", {}, None), ("lookup-error", {}, None)]
        for name, changes, expected in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                output = Path(temp) / "output"
                latest = {**original, **changes}

                def response(tree, **extra):
                    return {"tree": [{"path": p, "sha": sha} for p, sha in tree.items()], **extra}

                data = response(latest)
                if name == "truncated":
                    data["truncated"] = True
                if name == "missing":
                    data = response({"frontend": "front-v1"})
                replies = [contextlib.closing(io.StringIO(json.dumps(response(original)))), contextlib.closing(io.StringIO(json.dumps(data)))]
                if name == "lookup-error":
                    replies = [OSError("lookup failed")]
                env = {
                    "CODE_TOKEN": "never-print-this",
                    "GITHUB_API_URL": "https://api.github.com",
                    "GITHUB_REPOSITORY": "example/blog",
                    "GITHUB_SHA": "built",
                    "GITHUB_OUTPUT": str(output),
                }
                log = io.StringIO()
                with patch.dict(os.environ, env), patch("urllib.request.urlopen", side_effect=replies), contextlib.redirect_stdout(log):
                    if expected is None:
                        with self.assertRaises((RuntimeError, OSError)):
                            exec(compile(script, "latest-code", "exec"), {})
                        self.assertFalse(output.exists())
                    else:
                        exec(compile(script, "latest-code", "exec"), {})
                        self.assertEqual(output.read_text(), f"current={expected}\n")
                self.assertNotIn("never-print-this", log.getvalue())


if __name__ == "__main__":
    unittest.main()
