# Changelog

All notable changes to tofucode.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-02-15

### Changed
- Rebranded from cc-web to tofucode
- Updated repository URL to https://github.com/picotofu/tofucode
- Updated PWA manifest with new app name
- Updated all branding references throughout UI and documentation
- Files tab breadcrumb header moved above toolbar for cleaner layout
- Changed dotfiles toggle icon to dot-circle for better clarity

### Added
- **Docker Support** - Multi-architecture images (amd64/arm64) with flexible volume mounting
- **Markdown Table of Contents** - Auto-generated sidebar with click-to-scroll navigation for MD files
- File statistics in editor header (size, lines, characters)
- Android back button support for Files tab navigation
- New tofu mascot logo (evening/morning variants)
- Docker authentication options: credentials file, full .claude folder, or env var
- Comprehensive Docker documentation with mount strategies and examples

### Fixed
- Symbol toolbar now properly triggers auto-save
- Symbol toolbar focus remains on cursor position after insertion
- File statistics aligned to right side of editor header
- Files tab header spacing and padding for consistent alignment

## [1.0.0] - 2026-02-15

Initial release as tofucode.

### Added
- **Chat Interface** - Full markdown rendering, syntax highlighting, collapsible tool outputs
- **Terminal Mode** - Run shell commands with output streaming, command history
- **Files Mode** - Browse and edit files with markdown editor, CSV spreadsheet editor, and image viewer
- **CSV Editor** - Interactive spreadsheet editing with Tabulator
- **Image Viewer** - Preview images (PNG, JPG, GIF, WebP, SVG, BMP, ICO)
- **Session Management** - Multiple sessions, rename, quick switcher (Ctrl+K)
- **Permission Modes** - Configure Claude's access (Default, Plan, Bypass, Skip)
- **Authentication** - Password protection with session tokens
- **Progressive Web App** - Installable as standalone application
- **Auto-Update** - Version checking with one-click upgrade
- **Settings** - Debug mode, auto-save files, customizable symbol toolbar
- **Keyboard Shortcuts** - Mode switching, terminal shortcuts, turn navigation
- **Git Diff Viewer** - Full-screen diff modal with file-by-file navigation
- **MCP Integration** - Auto-detection with three-level scope merging
- **Multi-tab Support** - Session warnings and per-tab isolation
