# Agent-Web Interface Specification

## Overview

Add AI agent sessions to VibeTunnel's personal dashboard, allowing users to create chat-based AI coding sessions alongside their terminal sessions.

## Core Concept

**Terminal Sessions + AI Agent Sessions = Unified Dashboard**

Users can create both terminal sessions and AI agent sessions from the same dashboard, with AI agents having access to repository context and the ability to create/modify files.

## Dashboard Integration

### Current Dashboard (Terminal Sessions)
```
┌─────────────────────────────────────────────────────────────┐
│ VibeTunnel Dashboard                                        │
├─────────────────────────────────────────────────────────────┤
│ [+ New Session] [+ Share Session]                          │
│                                                             │
│ Active Sessions:                                            │
│ 🖥️  my-project (zsh) • ~/code/project • 2h ago             │
│ 🖥️  server-debug (bash) • /var/log • 30m ago               │
│ 🖥️  build-process (zsh) • ~/build • 5m ago                 │
└─────────────────────────────────────────────────────────────┘
```

### Enhanced Dashboard (Terminal + AI Sessions)
```
┌─────────────────────────────────────────────────────────────┐
│ VibeTunnel Dashboard                                        │
├─────────────────────────────────────────────────────────────┤
│ [+ New Terminal] [+ New AI Session] [+ Share Session]      │
│                                                             │
│ Active Sessions:                                            │
│ 🤖 auth-refactor (Claude) • github.com/user/app • 1h ago    │
│ 🖥️  my-project (zsh) • ~/code/project • 2h ago             │
│ 🤖 bug-analysis (Claude) • github.com/user/api • 30m ago    │
│ 🖥️  server-debug (bash) • /var/log • 30m ago               │
│ 🖥️  build-process (zsh) • ~/build • 5m ago                 │
└─────────────────────────────────────────────────────────────┘
```

## AI Session Creation Flow

### 1. Quick Start
```
User clicks [+ New AI Session]
↓
Modal appears:
┌─────────────────────────────────────────────────────┐
│ Create AI Session                                   │
│                                                     │
│ Repository URL:                                     │
│ [github.com/user/project________________] [Browse] │
│                                                     │
│ AI Agent:                                           │
│ ● Claude  ○ Gemini  ○ GPT-4                       │
│                                                     │
│ Session Name:                                       │
│ [auth-refactor_________________________]           │
│                                                     │
│           [Cancel] [Create Session]                 │
└─────────────────────────────────────────────────────┘
```

### 2. Session Initialization
```
After clicking [Create Session]:
1. Creates git worktree in /tmp/vt-ai-{session-id}
2. Spawns AI agent process
3. Opens chat interface
4. AI provides initial context about the repository
```

## AI Session Interface

### Layout
```
┌─────────────────────────────────────────────────────────────┐
│ 🤖 auth-refactor • github.com/user/app • Claude            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ 🤖 I've analyzed your repository. I can see this is a       │
│    React app with authentication issues. What would you     │
│    like to work on?                                         │
│                                                             │
│ 👤 Fix the login component - users can't authenticate       │
│                                                             │
│ 🤖 I found the issue in src/Login.tsx. The password         │
│    validation is using == instead of proper hashing:       │
│                                                             │
│    ┌─────────────────────────────────────────────────────┐ │
│    │ src/Login.tsx:42                                    │ │
│    │ - if (user.password == password) {                  │ │
│    │ + if (await bcrypt.compare(password, user.hash)) {  │ │
│    │                                                     │ │
│    │ [Apply] [Show Full File] [Explain] [Create PR]     │ │
│    └─────────────────────────────────────────────────────┘ │
│                                                             │
│ [Type your message...] [🎤] [📎] [⚙️]                     │
└─────────────────────────────────────────────────────────────┘
```

### Action Buttons
- **[Apply]** - Writes changes to the worktree
- **[Show Full File]** - Expands to show complete file with changes
- **[Explain]** - AI explains the reasoning behind the change
- **[Create PR]** - Opens GitHub with a pull request
- **[Run Tests]** - Executes test suite in the worktree
- **[Preview]** - If web app, shows live preview

## Core Features

### 1. Repository Integration
```typescript
interface AISession {
  id: string;
  name: string;
  repositoryUrl: string;
  worktreePath: string;
  agentType: 'claude' | 'gemini' | 'gpt4';
  createdAt: Date;
  lastActivity: Date;
  chatHistory: Message[];
  pendingChanges: FileChange[];
}
```

### 2. File Operations
```typescript
interface FileChange {
  filePath: string;
  lineNumber?: number;
  oldContent: string;
  newContent: string;
  status: 'pending' | 'applied' | 'reverted';
  description: string;
}
```

### 3. Smart Context
- AI automatically analyzes repository structure
- Provides relevant suggestions based on file types
- Maintains conversation context across session restarts
- Suggests next steps based on recent changes

## Mobile Experience

### Responsive Layout
```
Mobile (≤768px):
┌─────────────────────────────────┐
│ 🤖 auth-refactor                │
├─────────────────────────────────┤
│                                 │
│ [Chat messages scroll here]     │
│                                 │
│                                 │
├─────────────────────────────────┤
│ [Message input] [🎤] [📎]      │
└─────────────────────────────────┘

Code changes appear as bottom sheet:
┌─────────────────────────────────┐
│ ═══ Pull up to see changes ═══  │
│                                 │
│ src/Login.tsx                   │
│ - if (user.password == pass...  │
│ + if (await bcrypt.compare(...  │
│                                 │
│ [Apply] [Explain] [Show More]   │
└─────────────────────────────────┘
```

### Touch Interactions
- **Swipe left on message** → Copy to clipboard
- **Swipe right on message** → Quick reply with "explain more"
- **Long press on code** → Show file context
- **Pull up bottom sheet** → Full diff view

## Session Management

### Session List View
```typescript
const SessionList = () => {
  const sessions = useAISessions();
  
  return (
    <div className="session-list">
      {sessions.map(session => (
        <div key={session.id} className="session-card">
          <div className="session-header">
            <span className="session-type">🤖</span>
            <span className="session-name">{session.name}</span>
            <span className="session-agent">({session.agentType})</span>
          </div>
          
          <div className="session-details">
            <span className="repo-url">{session.repositoryUrl}</span>
            <span className="last-activity">{session.lastActivity}</span>
          </div>
          
          {session.pendingChanges.length > 0 && (
            <div className="pending-changes">
              {session.pendingChanges.length} pending changes
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
```

### Session Actions
- **Click to open** → Resume chat in same window
- **Share button** → Generate shareable link
- **Settings gear** → Change AI agent, repository branch
- **Delete X** → Cleanup worktree and remove session

## Advanced Features

### 1. Session Collaboration
```
Share AI session like terminal sessions:
- Generate unique URL: vibetunnel.com/ai/session-abc123
- Multiple people can view/participate in chat
- Real-time sync of messages and file changes
- Permissions: owner can apply changes, viewers can only chat
```

### 2. Cross-Session Context
```
AI can reference other sessions:
"I see you have a terminal session running tests in the same repo. 
 The tests are failing because of the auth change we just made."
```

### 3. Contextual Suggestions
```
Based on repository analysis:
- "I notice no tests for the auth module. Should we add some?"
- "This API endpoint looks vulnerable. Want me to fix it?"
- "Your dependencies are outdated. I can update them safely."
```

## Implementation Architecture

### Frontend Integration
```typescript
// Extend existing session management
interface Session {
  id: string;
  type: 'terminal' | 'ai';
  name: string;
  // ... existing fields
}

// Add AI-specific components
const AISessionView = ({ session }: { session: AISession }) => {
  return (
    <div className="ai-session">
      <ChatInterface session={session} />
      <FileChangesPanel changes={session.pendingChanges} />
    </div>
  );
};
```

### Backend Extension
```typescript
// Add AI session routes
app.post('/api/ai-sessions', createAISession);
app.get('/api/ai-sessions/:id', getAISession);
app.post('/api/ai-sessions/:id/chat', sendChatMessage);
app.post('/api/ai-sessions/:id/apply', applyFileChanges);
```

## Success Metrics

### Usability
- **Time to first AI response**: <5 seconds
- **Session creation time**: <30 seconds
- **File change application**: 1-click
- **Mobile task completion**: >90%

### Functionality
- **Repository analysis accuracy**: Detects framework/language correctly
- **Code change relevance**: >80% of suggestions are applicable
- **Session persistence**: Chat history survives browser refresh

## File Structure

```
web/src/
├── components/
│   ├── ai-session/
│   │   ├── AISessionList.tsx
│   │   ├── AISessionView.tsx
│   │   ├── ChatInterface.tsx
│   │   ├── FileChangesPanel.tsx
│   │   └── CreateAISessionModal.tsx
│   └── dashboard/
│       └── Dashboard.tsx (enhanced)
├── hooks/
│   ├── useAISessions.ts
│   └── useAIChat.ts
├── types/
│   └── ai-session.ts
└── utils/
    └── ai-agents.ts
```

## The Perfect User Flow

1. Developer has a bug to fix
2. Opens VibeTunnel dashboard
3. Clicks [+ New AI Session]
4. Pastes repository URL
5. AI immediately analyzes repo and provides context
6. Developer describes the bug
7. AI suggests specific code changes
8. Developer clicks [Apply] to make changes
9. AI suggests running tests
10. Developer clicks [Run Tests] to verify fix
11. AI suggests creating PR
12. Developer clicks [Create PR]
13. GitHub opens with pre-filled PR description

**Total time: 3-5 minutes from problem to pull request.**

## Key Principles

1. **Unified Experience** - AI sessions feel natural alongside terminal sessions
2. **Immediate Value** - AI provides useful context within seconds
3. **One-Click Actions** - Every AI suggestion has a button to execute it
4. **Mobile First** - Works perfectly on phones and tablets
5. **Collaborative** - Sessions can be shared like terminal sessions
6. **Persistent** - Sessions survive browser refresh and can be resumed
7. **Contextual** - AI understands the repository and provides relevant suggestions

This feature transforms VibeTunnel from a terminal sharing tool into a complete development environment where AI assistants work alongside traditional command-line tools.