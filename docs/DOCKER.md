# Docker Guide

## Quick Start

```bash
docker pull picotofu/tofucode:latest

docker run -d \
  -p 3000:3000 \
  -v ~/.claude/.credentials.json:/home/node/.claude/.credentials.json:ro \
  -v $(pwd):/workspace \
  picotofu/tofucode:latest --root /workspace
```

Open http://localhost:3000

---

## Volume Mounts

### Required: API Authentication (choose one)

```bash
# Option 1: Mount credentials only (isolated, recommended)
-v ~/.claude/.credentials.json:/home/node/.claude/.credentials.json:ro

# Option 2: Mount full Claude folder (host interop)
-v ~/.claude:/home/node/.claude

# Option 3: Environment variable
-e ANTHROPIC_API_KEY=your_key_here
```

### Optional: Workspace

```bash
# Mount your project directory — always pair with --root
-v /path/to/project:/workspace
-v $(pwd):/workspace
```

> **Note:** Always pass `--root /workspace` (or wherever you mount your projects) so tofucode knows where to look. Without `--root`, it falls back to `$HOME` (`/home/node`), which is an empty directory unless you mount something there.

### Optional: Persistent Settings

```bash
# Web UI auth and settings
-v ~/.tofucode:/home/node/.tofucode

# Claude sessions (isolated)
-v tofucode-sessions:/home/node/.claude/projects

# Full Claude interop (shares everything with host)
-v ~/.claude:/home/node/.claude
```

### Optional: Git Credentials

`git` and `openssh-client` are included in the image. Mount your SSH key and git config to enable git operations inside Claude sessions:

```bash
-v ~/.ssh:/home/node/.ssh:ro \
-v ~/.gitconfig:/home/node/.gitconfig:ro \
```

---

## Environment Variables

```bash
-e PORT=3000
-e HOST=0.0.0.0
-e AUTH_DISABLED=true
-e DEBUG=true
-e ROOT_PATH=/workspace
-e DEBUG_TOKEN=your-bypass-token
-e ANTHROPIC_API_KEY=your_key_here
```

---

## CLI Arguments

```bash
docker run picotofu/tofucode:latest [args]

--port 8080
--host 0.0.0.0
--no-auth
--debug
--root /workspace
--config /config/config.json
--bypass-token your-token
```

---

## Configuration File

Mount a config.json:

```bash
-v ./config.json:/config/config.json:ro
```

```json
{
  "port": 8080,
  "host": "0.0.0.0",
  "auth": false,
  "debug": true,
  "root": "/workspace",
  "bypassToken": "your-secret-token"
}
```

Then run with: `--config /config/config.json`

---

## Build Arguments

```bash
docker build \
  --build-arg USER_ID=$(id -u) \
  --build-arg GROUP_ID=$(id -g) \
  -t tofucode:custom .
```

Default: `USER_ID=1000`, `GROUP_ID=1000`

---

## Complete Examples

### Development (Isolated)

```bash
docker run -d \
  --name tofucode \
  -p 3000:3000 \
  -v ~/.claude/.credentials.json:/home/node/.claude/.credentials.json:ro \
  -v $(pwd):/workspace \
  picotofu/tofucode:latest --root /workspace
```

### Development with Git

```bash
docker run -d \
  --name tofucode \
  -p 3000:3000 \
  -v ~/.claude/.credentials.json:/home/node/.claude/.credentials.json:ro \
  -v $(pwd):/workspace \
  -v ~/.ssh:/home/node/.ssh:ro \
  -v ~/.gitconfig:/home/node/.gitconfig:ro \
  picotofu/tofucode:latest --root /workspace
```

### Production with Persistent Sessions

```bash
docker volume create tofucode-sessions

docker run -d \
  --name tofucode \
  -p 8080:8080 \
  -e ANTHROPIC_API_KEY=your_key \
  -v ~/projects:/workspace \
  -v tofucode-sessions:/home/node/.claude/projects \
  picotofu/tofucode:latest --port 8080 --root /workspace
```

### Full Host Interop

```bash
docker run -d \
  --name tofucode \
  -p 3000:3000 \
  -v ~/.claude:/home/node/.claude \
  -v ~/projects:/workspace \
  picotofu/tofucode:latest --root /workspace
```

### CI/Automation (No Auth + Bypass Token)

```bash
docker run -d \
  --name tofucode-ci \
  -p 3000:3000 \
  -e ANTHROPIC_API_KEY=your_key \
  -e DEBUG_TOKEN=ci-token \
  -v /ci/workspace:/workspace \
  picotofu/tofucode:latest --no-auth --root /workspace
```

---

## Multi-Architecture

Supports `linux/amd64` and `linux/arm64`:

```bash
docker pull picotofu/tofucode:latest
docker pull --platform linux/amd64 picotofu/tofucode:latest
docker pull --platform linux/arm64 picotofu/tofucode:latest
```

---

## Port Mapping

```bash
-p 8080:3000           # Map host 8080 to container 3000
-p 127.0.0.1:8080:3000 # Bind to localhost only
```

---

## Build from Source

```bash
git clone https://github.com/picotofu/tofucode.git
cd tofucode
docker build -t tofucode:local .
docker run -p 3000:3000 -e ANTHROPIC_API_KEY=key tofucode:local
```

---

## Mount Summary

| Path | Type | Purpose |
|------|------|---------|
| `/home/node/.claude/.credentials.json` | Required* | API credentials only (isolated, recommended) |
| `/home/node/.claude` | Required* | Full Claude config, API key, sessions (host interop) |
| `ANTHROPIC_API_KEY` | Required* | API key via environment variable |
| `/home/node/.claude/projects` | Optional | Sessions only (isolated persistent) |
| `/home/node/.tofucode` | Optional | Web UI auth and settings |
| `/home/node/.ssh` | Optional | SSH key for git operations |
| `/home/node/.gitconfig` | Optional | Git user config for commits |
| `/workspace` | Optional | Your project files |
| `/config/config.json` | Optional | Configuration file |

*Only one API authentication method required

---

## Links

- **GitHub**: https://github.com/picotofu/tofucode
- **Issues**: https://github.com/picotofu/tofucode/issues
- **Docker Hub**: https://hub.docker.com/r/picotofu/tofucode
