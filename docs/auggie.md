# Auggie CLI

VibeTunnel can monitor and control Augment Code's Auggie CLI like other terminal-based coding agents. Auggie sessions are recognized as AI assistant sessions in both the web dashboard and macOS menu, including the action that asks the agent to update its terminal title.

## Install Auggie

Auggie requires Node.js 20 or later. Install the CLI from npm:

```bash
npm install -g @augmentcode/auggie
```

Authenticate once:

```bash
auggie login
```

See Augment's [installation](https://docs.augmentcode.com/cli/setup-auggie/install-auggie-cli) and [authentication](https://docs.augmentcode.com/cli/setup-auggie/authentication) guides for current requirements.

## Run with VibeTunnel

Start an interactive Auggie session through the `vt` wrapper:

```bash
cd /path/to/project
vt auggie
```

You can also pass an initial prompt:

```bash
vt auggie "Review the current changes"
```

The session then appears in VibeTunnel's web, macOS, and mobile clients. Terminal input, output, reconnection, and session controls work the same as for other interactive CLI tools.

## Quick Start

`auggie` is included in the default Quick Start command list. Existing customized lists are preserved; add `auggie` in **Settings > Quick Start** or reset the list to defaults to expose the button.

## Terminal Titles

For an active Auggie session, use the wand action in the web dashboard or macOS menu. VibeTunnel sends a prompt asking Auggie to run:

```bash
vt title "Brief description of current task"
```

This replaces a generic process name with the agent's current task in session lists.
