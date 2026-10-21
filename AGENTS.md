# Project Overview

Personal blog and software engineering portfolio.

The project is in its initial development stage.
Technology choices and architecture are not finalized.

## Development Principles

- Prefer simple, maintainable solutions.
- Avoid premature abstraction and overengineering.
- Follow existing project conventions.
- Do not introduce dependencies without a clear reason.
- Explain significant architectural decisions and trade-offs.
- Ask for clarification when requirements are ambiguous.

## Implementation Guidelines

- Inspect relevant code before making changes.
- Keep changes small and focused.
- Add appropriate tests for new functionality.
- Run relevant tests before reporting completion.
- Clearly report unverified behavior and limitations.

## Cloud Sessions

- Cloud sessions are for development and testing only. The author publishes from the local CMS.
- `Hack-Ray/personal-blog-content` holds the live site's content. Read it to build or test with real content; never commit or push to it. The next deploy builds its HEAD, so any change there goes live.
- Never start the `Deploy site` workflow by hand (`workflow_dispatch`) from a cloud session.
- A merge into `main` deploys the site. Merge a PR from a cloud session only when the user has authorized it and CI has passed on the PR's head commit. `deploy.yml` runs CI again and deploys only if it passes.

## Safety

- Never commit secrets or credentials.
- Do not modify unrelated files.
- Do not push, deploy, or perform destructive operations without approval.
