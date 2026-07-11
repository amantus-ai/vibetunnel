# Build Requirements

The macOS build combines the Swift app, web server, and Rust native forwarder.

## Requirements

- **macOS**: 14.0 or later on Apple Silicon
- **Xcode**: 16.0 or later with command line tools
- **Node.js**: 22.12 through 24.x
- **pnpm**: Use the repository-pinned version through Corepack
- **Rustup**: `native/vt-fwd/rust-toolchain.toml` pins Rust 1.97.0 plus rustfmt and Clippy
- **Internet connection**: Required for the first dependency and toolchain download

## Build Process

When you build VibeTunnel in Xcode for the first time:

1. **Install Build Dependencies** prepares the supported Node.js and repository-pinned pnpm environment.

2. **Build Web Frontend** installs the pinned JavaScript dependencies and runs `pnpm build`. That build invokes Cargo in `native/vt-fwd`, then copies the server, browser assets, and `vibetunnel-fwd` into the app resources.

3. Xcode compiles the Swift application and packages the resources produced by the web build phase. There is no separate native-forwarder build phase.

## Benefits

- **Pinned native toolchain** - Rust version and components come from `native/vt-fwd/rust-toolchain.toml`
- **Integrated packaging** - Xcode receives the server and forwarder through one build pipeline
- **Cached builds** - JavaScript, Cargo, and Xcode reuse their normal build caches

## Troubleshooting

If the build fails:

1. Check internet connection (required for first build)
2. Run `rustup show` from `native/vt-fwd` if Cargo cannot select the pinned toolchain
3. Verify the repository-pinned pnpm is active with `pnpm --version`
4. Check Console.app for detailed error messages

## Clean Build

To perform a completely clean build:

```bash
cd mac
rm -rf .build-tools/
rm -rf ../web/node_modules/
rm -rf ../native/vt-fwd/target/
# Then build in Xcode
```
