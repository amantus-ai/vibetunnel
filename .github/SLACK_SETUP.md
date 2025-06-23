# Setting up Slack Notifications for CI

## Prerequisites

1. A Slack workspace where you want to receive CI notifications
2. Admin permissions to create webhooks in your Slack workspace

## Setup Steps

1. **Create a Slack Webhook**:
   - Go to https://api.slack.com/apps
   - Click "Create New App" > "From scratch"
   - Name it "VibeTunnel CI" and select your workspace
   - Click "Incoming Webhooks" in the left sidebar
   - Toggle "Activate Incoming Webhooks" to ON
   - Click "Add New Webhook to Workspace"
   - Select the channel where you want CI notifications
   - Copy the webhook URL (starts with `https://hooks.slack.com/services/...`)

2. **Add the Webhook to GitHub**:
   - Go to your repository settings on GitHub
   - Navigate to Settings > Secrets and variables > Actions
   - Click "New repository secret"
   - Name: `SLACK_WEBHOOK_URL`
   - Value: Paste the webhook URL from step 1
   - Click "Add secret"

## What Gets Notified

The Slack integration will send notifications for:
- ✅ All CI runs on the `main` branch (both success and failure)
- 🔄 All CI runs on pull requests
- ❌ Failed jobs with direct links to the failing job logs

## Notification Format

Each notification includes:
- CI status (success/failure)
- Branch or PR number
- Commit SHA and author
- Number of passed/failed jobs
- Direct links to failed jobs (if any)
- Link to the full workflow run

## Testing

To test the integration:
1. Make a small change and push to main
2. Check your Slack channel for the notification
3. The notification should appear within a few seconds of CI completion