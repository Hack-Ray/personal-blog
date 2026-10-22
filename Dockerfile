# The CMS (backend + built admin UI) as one image. The public site is built
# by GitHub Actions and does not use this image.
#
#   docker build -t blog-cms .
#   docker run --env-file backend/.env -p 127.0.0.1:8000:8000 blog-cms
#
# DATABASE_URL must reach the database from inside the container, where
# 127.0.0.1 is the container itself. Use host.docker.internal (on Linux, also
# pass --add-host=host.docker.internal:host-gateway), or --network host on
# Linux. With --network host, -p does nothing and uvicorn listens on every
# interface of the machine: append
# "uvicorn blog.api:app --host 127.0.0.1 --port 8000 --proxy-headers" to the
# docker run line to keep it local. Behind a proxy, set FORWARDED_ALLOW_IPS to the
# proxy's address as the container sees it, so sign-in limits count real
# client addresses.
#
# 更新網站 does not work from this image yet: it needs the content repo
# clone, a git identity and push credentials, which wait on the publish
# method and GitHub credential decisions in docs/backlog.md.
#
# Run one container at a time. Before starting a new image, back up and
# migrate with one-off containers, stopping if either fails:
#
#   mkdir -p backend/backups
#   docker run --rm --env-file backend/.env -v "$PWD/backend/backups:/app/backend/backups" \
#     blog-cms sh -c 'scripts/backup.sh --url "$DATABASE_URL"'
#   docker run --rm --env-file backend/.env blog-cms alembic upgrade head
#
# The image has no aws CLI, so back up to a mounted folder as above.

FROM node:22-slim AS cms
WORKDIR /src/cms
COPY cms/package.json cms/package-lock.json ./
RUN npm ci
COPY cms/ ./
RUN npm run build

FROM python:3.13-slim-bookworm
# git publishes to the content repo. pg_dump must match the database's major
# version, so the client comes from the PostgreSQL apt repository.
ARG PG_MAJOR=16
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-$PG_MAJOR \
 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv==0.11.32
RUN useradd --create-home --uid 1000 cms
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY backend/ ./
RUN mkdir backups && chown cms backups
COPY --from=cms /src/cms/dist /app/cms/dist
# UV_NO_SYNC stops the scripts' `uv run` from installing dev dependencies.
ENV PATH=/app/backend/.venv/bin:$PATH CMS_DIST=/app/cms/dist UV_NO_SYNC=1
USER cms
EXPOSE 8000
CMD ["uvicorn", "blog.api:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
