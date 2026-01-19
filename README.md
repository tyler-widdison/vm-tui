                                                                               ░████    
                                                 ░████                                  
     ░████   ░████ ░████████████               ░████████████ ░████   ░████ ░████████    
     ░████   ░████ ░████ ░██ ░██ ░████████████   ░████       ░████   ░████     ░████    
     ░████   ░████ ░████ ░██ ░██                 ░████       ░████   ░████     ░████    
       ░████████   ░████ ░██ ░██                 ░████       ░████   ░████     ░████    
         ░████     ░████ ░██ ░██                   ░████████   ░██████████ ░████████████
# vm-tui


To run:

```bash
git clone https://github.com/tyler-widdison/vm-tui.git
cd vm-tui

bun install
```



```bash
bun dev
```

This project was made with [Opentui](https://github.com/anomalyco/opentui)
The purpose is to provide users of volleymetrics an alternative method to gather video and dvw files.

## Contributing

### Commit Message Format

This project follows [Conventional Commits](https://www.conventionalcommits.org/) for clear and structured commit history:

- `feat:` - New features (e.g., `feat: add download progress bar`)
- `fix:` - Bug fixes (e.g., `fix: resolve authentication timeout`)
- `docs:` - Documentation changes (e.g., `docs: update installation guide`)
- `chore:` - Maintenance tasks (e.g., `chore: bump version to 0.2.0`)
- `refactor:` - Code refactoring (e.g., `refactor: simplify login flow`)
- `test:` - Test additions/changes (e.g., `test: add unit tests for downloader`)

### Versioning

This project uses [Semantic Versioning](https://semver.org/):

- **0.x.y** - Pre-release versions (current phase)
- **Patch** (0.1.x) - Bug fixes and minor changes
- **Minor** (0.x.0) - New features
- **Major** (1.0.0) - First stable release

### Creating a Release

To create a new release:

1. Update `CHANGELOG.md` with your changes
2. Bump the version using one of:
   ```bash
   bun run version:patch  # 0.1.0 → 0.1.1 (bug fixes)
   bun run version:minor  # 0.1.0 → 0.2.0 (new features)
   bun run version:major  # 0.x.x → 1.0.0 (stable release)
   ```
3. Push changes and tags:
   ```bash
   git push && git push --tags
   ```
4. GitHub Actions will automatically create the release 

## Prerequisites

This project uses **Bun**.
If you don't ahve Bun installed, install it first:

https://bun.com/docs/installation

### Quick install

**macOS / Linux**
```bash
curl -fsSL https://bun.sh/install | bash
```

**Windows**
```bash
powershell -c "irm bun.sh/install.ps1 | iex"
```
