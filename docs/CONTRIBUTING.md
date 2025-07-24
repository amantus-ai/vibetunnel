# Contributing to VibeTunnel

We love your input! We want to make contributing to VibeTunnel as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

## Development Setup

### Prerequisites

1. **macOS 14.0+** (Sonoma or later)
2. **Xcode 16.0+** with Swift 6.0 support
3. **Node.js 20+**: `brew install node`
4. **Bun runtime**: `curl -fsSL https://bun.sh/install | bash`
5. **Git**: For version control

### Getting Started

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/[your-username]/vibetunnel.git
   cd vibetunnel
   ```

2. **Set up development environment**
   ```bash
   # Install Node.js dependencies
   cd web
   pnpm install

   # Start the development server (keep this running)
   pnpm run dev
   ```

3. **Open the Xcode project**
   ```bash
   # From the root directory
   open mac/VibeTunnel-Mac.xcodeproj
   ```

4. **Configure code signing (optional for development)**
   - Copy `apple/Local.xcconfig.template` to `apple/Local.xcconfig`
   - Add your development team ID (or leave empty for ad-hoc signing)
   - This file is gitignored to keep your settings private

## Development Workflow

### Working with the Web Server

The web server (Node.js/TypeScript) runs in development mode with hot reloading:

```bash
cd web
pnpm run dev  # Keep this running in a separate terminal
```

**Custom Port Configuration** (if port 4020 is already in use):
```bash
# Option 1: Run server directly with custom port (cleanest approach)
pnpm run dev:server --port 4021

# Option 2: Using environment variable
PORT=4021 pnpm run dev

# Option 3: Using the full dev command with arguments (requires --)
pnpm run dev -- --port 4021
```

**Development Commands**:
- `pnpm run dev` - Run everything (server, client watcher, CSS, assets)
- `pnpm run dev:server` - Run just the server (accepts --port directly!)
- `pnpm run dev:client` - Run just client-side watchers

**Important**: Never manually build the web project - the development server handles all compilation automatically.

### Working with the macOS App

1. Open `mac/VibeTunnel.xcworkspace` in Xcode
2. Select the VibeTunnel scheme
3. Build and run (⌘R)

The app will automatically use the development server running on `http://localhost:4020`.

### Working with the iOS App

1. Open `ios/VibeTunnel.xcodeproj` in Xcode
2. Select your target device/simulator
3. Build and run (⌘R)

## Code Style Guidelines

### Swift Code

We use modern Swift 6.0 patterns with strict concurrency checking:

- **SwiftFormat**: Automated formatting with `.swiftformat` configuration
- **SwiftLint**: Linting rules in `.swiftlint.yml`
- Use `@MainActor` for UI-related code
- Use `@Observable` for SwiftUI state objects
- Prefer `async/await` over completion handlers

Run before committing:
```bash
cd mac
swiftformat .
swiftlint
```

### TypeScript/JavaScript Code

- **Biome**: For code formatting and linting (replaces ESLint + Prettier)
- **TypeScript**: Strict mode enabled

Run before committing:
```bash
cd web
pnpm run precommit   # Runs format + lint fixes + typecheck in one command
```

Or run individually if needed:
```bash
pnpm run format      # Format with Biome
pnpm run lint        # Check with Biome + TypeScript
pnpm run lint:fix    # Auto-fix Biome issues
pnpm run typecheck   # Check TypeScript types only
```

### Important Rules

- **NEVER use `setTimeout` in frontend code** unless explicitly necessary
- **Always fix ALL lint and type errors** before committing
- **Never commit without user testing** the changes
- **No hardcoded values** - use configuration files
- **No console.log in production code** - use proper logging

## Project Structure

```
vibetunnel/
├── mac/                    # macOS application
│   ├── VibeTunnel/        # Swift source code
│   │   ├── Core/          # Business logic
│   │   ├── Presentation/  # UI components
│   │   └── Utilities/     # Helper functions
│   ├── VibeTunnelTests/   # Unit tests
│   └── scripts/           # Build and release scripts
│
├── ios/                   # iOS companion app
│   └── VibeTunnel/        # Swift source code
│
├── web/                   # Web server and frontend
│   ├── src/
│   │   ├── server/        # Node.js server (TypeScript)
│   │   └── client/        # Web frontend (Lit/TypeScript)
│   └── public/            # Static assets
│
└── docs/                  # Documentation
```

## Testing

### macOS Tests

We use Swift Testing framework:

```bash
# Run tests in Xcode
xcodebuild test -workspace mac/VibeTunnel.xcworkspace -scheme VibeTunnel

# Or use Xcode UI (⌘U)
```

Test categories (tags):
- `.critical` - Must-pass tests
- `.networking` - Network-related tests
- `.concurrency` - Async operations
- `.security` - Security features

### Web Tests

We use Vitest for Node.js testing:

```bash
cd web
pnpm run test
```

### Writing Tests

- Write tests for all new features
- Include both positive and negative test cases
- Mock external dependencies
- Keep tests focused and fast

## Making a Pull Request

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Follow the code style guidelines
   - Write/update tests
   - Update documentation if needed

3. **Test your changes**
   - Run the test suite
   - Test manually in the app
   - Check both macOS and web components

4. **Commit your changes**
   ```bash
   # Web changes
   cd web && pnpm run precommit

   # Swift changes
   cd mac && swiftformat . && swiftlint

   # Commit
   git add .
   git commit -m "feat: add amazing feature"
   ```

5. **Push and create PR**
   ```bash
   git push origin feature/your-feature-name
   ```
   Then create a pull request on GitHub.

## Commit Message Convention

We follow conventional commits:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc)
- `refactor:` Code refactoring
- `test:` Test changes
- `chore:` Build process or auxiliary tool changes

## Debugging Tips

### macOS App
- Use Xcode's debugger (breakpoints, LLDB)
- Check Console.app for system logs
- Enable debug logging in Settings → Debug

### Web Server
- Use Chrome DevTools for frontend debugging
- Server logs appear in the terminal running `pnpm run dev`
- Use `--inspect` flag for Node.js debugging

### Common Issues

**"Port already in use"**
- Another instance might be running (e.g., production VibeTunnel app)
- Check Activity Monitor for `vibetunnel` processes
- Quick fix: `pnpm run dev:server --port 4021` (no -- needed!)
- Or use environment variable: `PORT=4021 pnpm run dev`
- See "Custom Port Configuration" section above for all options

**"Binary not found"**
- Run `cd web && node build-native.js` to build the Bun executable
- Check that `web/native/vibetunnel` exists

**WebSocket connection failures**
- Ensure the server is running (`pnpm run dev`)
- Check for CORS issues in browser console
- Verify the port matches between client and server

## Documentation

When adding new features:

1. Update the relevant documentation in `docs/`
2. Add JSDoc/Swift documentation comments
3. Update README.md if it's a user-facing feature
4. Include examples in your documentation

## Security Considerations

- Never commit secrets or API keys
- Use Keychain for sensitive data storage
- Validate all user inputs
- Follow principle of least privilege
- Test authentication and authorization thoroughly

## Getting Help

- Join our [Discord server](https://discord.gg/vibetunnel) (if available)
- Check existing issues on GitHub
- Read the [Technical Specification](spec.md)
- Ask questions in pull requests

## Code Review Process

All submissions require review before merging:

1. Automated checks must pass (linting, tests)
2. At least one maintainer approval required
3. Resolve all review comments
4. Keep PRs focused and reasonably sized

## License

By contributing, you agree that your contributions will be licensed under the MIT License. See [LICENSE](../LICENSE) for details.

## Thank You!

Your contributions make VibeTunnel better for everyone. We appreciate your time and effort in improving the project! 🎉
