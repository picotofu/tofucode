# Docker Implementation - Handoff Document

## Context

This document provides all necessary context for implementing Docker support for the tofucode web application. The goal is to enable users to run tofucode in a Docker container for enhanced security and isolation, particularly when using the `--root` restriction feature.

## Current State

### Application Architecture

**Stack:**
- Frontend: Vue 3 + Vite (SPA)
- Backend: Express 5 + WebSocket (ws library)
- AI: Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
- Node.js v24.9.0

**Key Components:**
- `server/index.js` - Express server with WebSocket support
- `src/` - Vue 3 frontend (builds to `dist/`)
- `bin/cli.js` - CLI entry point with daemon management

**Port:** Default 3000 (configurable via `--port`)

### Recent Security Hardening

We've just completed comprehensive security hardening of the `--root` CLI feature:

**Vulnerabilities Fixed:**
1. ✅ **CRITICAL**: Client-controlled `projectPath` in `get-git-diff.js`
2. ✅ **HIGH**: No root validation in `select-project.js`
3. ✅ **HIGH**: Session ID path traversal (delete/read/write operations)
4. ✅ **HIGH**: Claude SDK `cwd` not validated against root
5. ✅ **MEDIUM**: Symlink following in folders/files operations

**Security Measures Implemented:**
- Path validation using `path.resolve()` and `path.relative()`
- Session ID UUID format validation
- Symlink resolution with `fs.realpathSync()`
- Context-based path derivation (no client-controlled paths)

See commit: `b945006` - "Security: harden --root feature against path traversal attacks"

### Current `--root` Feature

**Purpose:** Best-effort path restriction for development/testing

**Known Limitations:**
- Terminal commands can still access absolute paths (documented as by-design)
- Not a security boundary - Docker recommended for production isolation

**Files Involved:**
- `server/events/files.js` - File operations validation
- `server/lib/folders.js` - Folder browsing validation
- `server/events/prompt.js` - Claude SDK cwd validation
- `server/events/select-project.js` - Project selection validation
- `server/events/terminal.js` - Terminal CWD validation

## Docker Implementation Requirements

### Goals

1. **Full Isolation**: Run tofucode in a secure Docker container
2. **Volume Mounting**: Allow mounting host directories for project access
3. **Easy Usage**: Simple `docker run` command or docker-compose setup
4. **Multi-arch**: Support both x64 and ARM64 (Apple Silicon)
5. **Small Image**: Optimize image size (Alpine Linux)

### Technical Considerations

#### 1. **File Permissions & UID/GID Mapping**

**Challenge:** Files created inside container owned by root, causing permission issues on host

**Solution Options:**
- Run as non-root user with matching host UID/GID
- Use `--user $(id -u):$(id -g)` flag in docker run
- Create user dynamically with matching UID/GID in entrypoint script

**Recommended Approach:**
```dockerfile
# Create user with configurable UID/GID (default 1000:1000)
ARG UID=1000
ARG GID=1000
RUN addgroup -g ${GID} tofucode && \
    adduser -D -u ${UID} -G tofucode tofucode
USER tofucode
```

#### 2. **Anthropic API Key Management**

**Current Behavior:** Claude SDK reads from `ANTHROPIC_API_KEY` environment variable or `~/.claude/config.json`

**Docker Options:**
1. Pass via `-e ANTHROPIC_API_KEY=xxx`
2. Mount config file: `-v ~/.claude:/home/tofucode/.claude:ro`
3. Docker secrets (for compose/swarm)

**Recommended:** Support all three for flexibility

#### 3. **Data Persistence**

**Directories to Persist:**
- `/home/tofucode/.claude/` - Config, sessions, project metadata
- `/workspace` or `/projects` - Mounted project directories

**Volume Strategy:**
```yaml
volumes:
  - ~/.claude:/home/tofucode/.claude
  - ./my-project:/workspace
```

#### 4. **WebSocket & Port Binding**

**Current:** Server listens on `0.0.0.0:3000` by default

**Docker Needs:**
- Expose port 3000
- Support custom port via `--port` flag
- Ensure WebSocket connections work through Docker networking

#### 5. **Node.js Version & Dependencies**

**Current Requirements:**
- Node.js v24.9.0 (or latest LTS)
- Native modules: None (pure JS)
- Build tools: Vite for frontend

**Docker Base Image Options:**
- `node:24-alpine` (smallest, ~120MB)
- `node:24-slim` (moderate, ~180MB)
- `node:24` (full, ~1GB)

**Recommended:** `node:24-alpine` for production

#### 6. **Multi-stage Build**

**Benefits:**
- Smaller final image
- Faster builds (caching)
- Separate build and runtime dependencies

**Strategy:**
```dockerfile
# Stage 1: Build frontend
FROM node:24-alpine AS frontend-builder
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Runtime
FROM node:24-alpine
COPY --from=frontend-builder /app/dist ./dist
COPY --from=frontend-builder /app/server ./server
COPY --from=frontend-builder /app/bin ./bin
COPY package*.json ./
RUN npm ci --only=production
```

#### 7. **Environment Variables**

**Required:**
- `ANTHROPIC_API_KEY` - API key for Claude

**Optional:**
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (default: production)

**CLI Arguments to Support:**
- `--port <number>` - Port to listen on
- `--root <path>` - Restrict to directory (path inside container)
- `--bypass-token <token>` - Auth bypass for automation

#### 8. **Entrypoint Script**

**Purpose:** Handle UID/GID mapping, environment setup, and graceful shutdown

**Responsibilities:**
- Set up non-root user if needed
- Validate required environment variables
- Handle SIGTERM/SIGINT for graceful shutdown
- Pass arguments to Node.js app

#### 9. **Health Checks**

**Docker Healthcheck:**
```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "require('http').get('http://localhost:3000/', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"
```

#### 10. **Security Best Practices**

- ✅ Run as non-root user
- ✅ Use read-only filesystem where possible
- ✅ Limit capabilities (drop all, add only needed ones)
- ✅ Use secrets for API keys (not ENV vars in production)
- ✅ Scan image for vulnerabilities
- ✅ Use minimal base image (Alpine)

## Implementation Plan

### Phase 1: Basic Dockerfile

1. Create `Dockerfile` in project root
2. Multi-stage build (frontend + runtime)
3. Non-root user (UID/GID 1000:1000)
4. Expose port 3000
5. Entrypoint: `node bin/cli.js`
6. Test: `docker build` and `docker run`

### Phase 2: Docker Compose

1. Create `docker-compose.yml`
2. Define services, volumes, environment
3. Add example `.env` file
4. Document usage in README

### Phase 3: Advanced Features

1. Custom entrypoint script for UID/GID mapping
2. Health checks
3. Multi-arch builds (x64 + ARM64)
4. Publish to Docker Hub or GitHub Container Registry
5. Add to CI/CD pipeline

### Phase 4: Documentation

1. Update README with Docker instructions
2. Create `docs/DOCKER.md` with advanced usage
3. Add troubleshooting guide
4. Document security considerations

## Example Usage (Target)

### Simple Run
```bash
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=xxx \
  -v $(pwd):/workspace \
  -v ~/.claude:/home/tofucode/.claude \
  tofucode/tofucode:latest \
  --root /workspace
```

### Docker Compose
```yaml
version: '3.8'
services:
  tofucode:
    image: tofucode/tofucode:latest
    ports:
      - "3000:3000"
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    volumes:
      - ./:/workspace
      - ~/.claude:/home/tofucode/.claude
    command: --root /workspace
```

## Testing Checklist

### Basic Functionality
- [ ] Container builds successfully
- [ ] Server starts and listens on port 3000
- [ ] Frontend accessible at http://localhost:3000
- [ ] WebSocket connection works
- [ ] Can create new session
- [ ] Claude SDK works (requires API key)

### File Operations
- [ ] Can browse mounted volume
- [ ] Can read files from mounted volume
- [ ] Can write files to mounted volume
- [ ] File permissions match host user
- [ ] Can edit files and save changes

### Security
- [ ] Runs as non-root user
- [ ] `--root` restriction works inside container
- [ ] Cannot access files outside mounted volumes
- [ ] Terminal CWD validation works
- [ ] File operations validate paths

### Advanced
- [ ] Health check passes
- [ ] Graceful shutdown on SIGTERM
- [ ] Persisted data survives container restart
- [ ] Works on both x64 and ARM64
- [ ] Image size reasonable (<500MB)

## Open Questions

1. **Registry:** Docker Hub, GitHub Container Registry, or self-hosted?
2. **Tagging Strategy:** latest, vX.Y.Z, dev, edge?
3. **Auto-build:** GitHub Actions or Docker Hub auto-build?
4. **Base User:** Create user dynamically or use fixed UID/GID?
5. **Volume Structure:** Single `/workspace` or multiple `/projects`, `/data`, `/config`?
6. **Dev Mode:** Support hot-reload for development containers?
7. **Reverse Proxy:** Document nginx/traefik setup for HTTPS?

## Related Files

### Files to Review
- `package.json` - Dependencies and scripts
- `bin/cli.js` - CLI entry point and argument parsing
- `server/index.js` - Express server setup
- `server/config.js` - Configuration and environment variables
- `vite.config.js` - Frontend build configuration
- `.env.example` - Environment variable template

### Files to Create
- `Dockerfile` - Container image definition
- `docker-compose.yml` - Compose configuration
- `.dockerignore` - Files to exclude from build context
- `docker-entrypoint.sh` - Entrypoint script (if needed)
- `docs/DOCKER.md` - Docker documentation

## References

### Useful Resources
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Node.js Docker Best Practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md)
- [Multi-arch Builds](https://docs.docker.com/build/building/multi-platform/)
- [Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html)

### Similar Projects
- [VS Code Server Docker](https://github.com/microsoft/vscode-dev-containers)
- [Jupyter Docker Stacks](https://github.com/jupyter/docker-stacks)
- [Gitpod Workspace Images](https://github.com/gitpod-io/workspace-images)

## Summary

Docker support will provide:
- ✅ Enhanced security through full container isolation
- ✅ Consistent environment across different systems
- ✅ Easy deployment and distribution
- ✅ Better `--root` security (combined with container isolation)
- ✅ Clean separation between host and application

The implementation should prioritize security, ease of use, and flexibility while maintaining the current application functionality.

---

**Status:** Ready for implementation
**Priority:** Medium-High (enhances security of `--root` feature)
**Estimated Effort:** 2-3 hours (basic) + 2-3 hours (advanced features)
