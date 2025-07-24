# OpenAPI Migration Plan for VibeTunnel

## Overview

This document outlines the plan to adopt OpenAPI 3.1 for VibeTunnel's REST API to achieve type safety and consistency between the TypeScript server and Swift clients.

## Goals

1. **Single source of truth** - Define API contracts once in OpenAPI spec
2. **Type safety** - Generate TypeScript and Swift types from the spec
3. **Eliminate inconsistencies** - Fix type mismatches between platforms
4. **API documentation** - Auto-generate API docs from the spec
5. **Gradual adoption** - Migrate endpoint by endpoint without breaking changes

## Current Issues

- Session types differ completely between Mac app and server
- Git repository types have different field names and optional/required mismatches
- No standardized error response format
- Manual type definitions duplicated across platforms
- Runtime parsing errors due to type mismatches

## Implementation Plan

### Phase 1: Setup and Infrastructure (Week 1)

#### 1.1 Install Dependencies

```bash
# In web directory
pnpm add -D @hey-api/openapi-ts @apidevtools/swagger-cli @stoplight/spectral-cli
```

#### 1.2 Create Initial OpenAPI Spec

Create `web/openapi/openapi.yaml`:

```yaml
openapi: 3.1.0
info:
  title: VibeTunnel API
  version: 1.0.0
  description: Terminal sharing and remote access API
servers:
  - url: http://localhost:4020
    description: Local development server
```

#### 1.3 Setup Code Generation

**TypeScript Generation** (`web/package.json`):
```json
{
  "scripts": {
    "generate:api": "openapi-ts -i openapi/openapi.yaml -o src/generated/api",
    "validate:api": "spectral lint openapi/openapi.yaml",
    "prebuild": "npm run generate:api"
  }
}
```

**Swift Generation** (Xcode Build Phase):
1. Add `swift-openapi-generator` to Package.swift
2. Add build phase to run before compilation:
```bash
cd "$SRCROOT/../web" && \
swift-openapi-generator generate \
  openapi/openapi.yaml \
  --mode types \
  --mode client \
  --output-directory "$SRCROOT/Generated/OpenAPI"
```

#### 1.4 Create Shared Components

Define reusable schemas in `web/openapi/components/`:

```yaml
# components/errors.yaml
ErrorResponse:
  type: object
  required: [error, timestamp]
  properties:
    error:
      type: string
      description: Human-readable error message
    code:
      type: string
      description: Machine-readable error code
      enum: [
        'INVALID_REQUEST',
        'NOT_FOUND',
        'UNAUTHORIZED',
        'SERVER_ERROR'
      ]
    timestamp:
      type: string
      format: date-time
```

### Phase 2: Migrate Git Endpoints (Week 2)

Start with Git endpoints as they're well-defined and isolated.

#### 2.1 Define Git Schemas

```yaml
# openapi/paths/git.yaml
/api/git/repository-info:
  get:
    operationId: getRepositoryInfo
    tags: [git]
    parameters:
      - name: path
        in: query
        required: true
        schema:
          type: string
    responses:
      '200':
        description: Repository information
        content:
          application/json:
            schema:
              $ref: '../components/schemas.yaml#/GitRepositoryInfo'

# components/schemas.yaml
GitRepositoryInfo:
  type: object
  required: [isGitRepo, hasChanges, modifiedCount, untrackedCount, stagedCount, addedCount, deletedCount, aheadCount, behindCount, hasUpstream]
  properties:
    isGitRepo:
      type: boolean
    repoPath:
      type: string
    currentBranch:
      type: string
      nullable: true
    remoteUrl:
      type: string
      nullable: true
    githubUrl:
      type: string
      nullable: true
    hasChanges:
      type: boolean
    modifiedCount:
      type: integer
      minimum: 0
    untrackedCount:
      type: integer
      minimum: 0
    stagedCount:
      type: integer
      minimum: 0
    addedCount:
      type: integer
      minimum: 0
    deletedCount:
      type: integer
      minimum: 0
    aheadCount:
      type: integer
      minimum: 0
    behindCount:
      type: integer
      minimum: 0
    hasUpstream:
      type: boolean
```

#### 2.2 Update Server Implementation

```typescript
// src/server/routes/git.ts
import { paths } from '../../generated/api';

type GitRepositoryInfo = paths['/api/git/repository-info']['get']['responses']['200']['content']['application/json'];

router.get('/git/repository-info', async (req, res) => {
  const response: GitRepositoryInfo = {
    isGitRepo: true,
    repoPath: result.repoPath,
    // ... ensure all required fields are included
  };
  res.json(response);
});
```

#### 2.3 Update Mac Client

```swift
// Use generated types
import OpenAPIGenerated

let response = try await client.getRepositoryInfo(path: filePath)
let info = response.body.json // Fully typed!
```

### Phase 3: Migrate Session Endpoints (Week 3)

Session endpoints are more complex due to WebSocket integration.

#### 3.1 Standardize Session Types

```yaml
SessionInfo:
  type: object
  required: [id, name, workingDir, status, createdAt, pid]
  properties:
    id:
      type: string
      format: uuid
    name:
      type: string
    workingDir:
      type: string
    status:
      type: string
      enum: [starting, running, exited]
    exitCode:
      type: integer
      nullable: true
    createdAt:
      type: string
      format: date-time
    lastActivity:
      type: string
      format: date-time
    pid:
      type: integer
      nullable: true
    command:
      type: array
      items:
        type: string
```

#### 3.2 Create Session Operations

```yaml
/api/sessions:
  get:
    operationId: listSessions
    responses:
      '200':
        content:
          application/json:
            schema:
              type: array
              items:
                $ref: '#/components/schemas/SessionInfo'
  
  post:
    operationId: createSession
    requestBody:
      required: true
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/CreateSessionRequest'
    responses:
      '201':
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SessionInfo'
```

### Phase 4: Runtime Validation (Week 4)

#### 4.1 Add Request Validation Middleware

```typescript
// src/server/middleware/openapi-validator.ts
import { OpenAPIValidator } from 'express-openapi-validator';

export const openapiValidator = OpenAPIValidator.middleware({
  apiSpec: './openapi/openapi.yaml',
  validateRequests: true,
  validateResponses: true,
});

// Apply to routes
app.use('/api', openapiValidator);
```

#### 4.2 Add Response Validation in Development

```typescript
// src/server/utils/validated-response.ts
export function validatedJson<T>(res: Response, data: T): void {
  if (process.env.NODE_ENV === 'development') {
    // Validate against OpenAPI schema
    validateResponse(res.req, data);
  }
  res.json(data);
}
```

### Phase 5: Documentation and Testing (Week 5)

#### 5.1 Generate API Documentation

```bash
# Add to package.json
"docs:api": "npx @redocly/cli build-docs openapi/openapi.yaml -o dist/api-docs.html"
```

#### 5.2 Add Contract Tests

```typescript
// src/test/contract/git-api.test.ts
import { matchesSchema } from './schema-matcher';

test('GET /api/git/repository-info matches schema', async () => {
  const response = await request(app)
    .get('/api/git/repository-info')
    .query({ path: '/test/repo' });
    
  expect(response.body).toMatchSchema('GitRepositoryInfo');
});
```

## Migration Checklist

### Endpoints to Migrate

- [ ] **Git APIs** (Phase 2)
  - [ ] GET /api/git/repo-info
  - [ ] GET /api/git/repository-info
  - [ ] GET /api/git/remote
  - [ ] GET /api/git/status
  - [ ] POST /api/git/event
  - [ ] GET /api/git/follow

- [ ] **Session APIs** (Phase 3)
  - [ ] GET /api/sessions
  - [ ] POST /api/sessions
  - [ ] GET /api/sessions/:id
  - [ ] DELETE /api/sessions/:id
  - [ ] POST /api/sessions/:id/resize
  - [ ] POST /api/sessions/:id/input
  - [ ] GET /api/sessions/:id/stream (SSE)

- [ ] **Repository APIs** (Phase 4)
  - [ ] GET /api/repositories/discover
  - [ ] GET /api/repositories/branches

- [ ] **Worktree APIs** (Phase 4)
  - [ ] GET /api/worktrees
  - [ ] POST /api/worktrees
  - [ ] DELETE /api/worktrees/:branch
  - [ ] POST /api/worktrees/switch

## Success Metrics

1. **Zero runtime type errors** between Mac app and server
2. **100% API documentation** coverage
3. **Contract tests** for all endpoints
4. **Reduced code** - Remove manual type definitions
5. **Developer velocity** - Faster API development with code generation

## Long-term Considerations

### Future Enhancements

1. **GraphQL Gateway** - Add GraphQL layer on top of REST for complex queries
2. **API Versioning** - Use OpenAPI to manage v1/v2 migrations
3. **Client SDKs** - Generate SDKs for other platforms (iOS, CLI tools)
4. **Mock Server** - Use OpenAPI spec to run mock server for testing

### Breaking Changes

When making breaking changes:
1. Version the API (e.g., /api/v2/)
2. Deprecate old endpoints with sunset dates
3. Generate migration guides from schema differences

## Resources

- [OpenAPI 3.1 Specification](https://spec.openapis.org/oas/v3.1.0)
- [OpenAPI TypeScript Generator](https://github.com/hey-api/openapi-ts)
- [Swift OpenAPI Generator](https://github.com/apple/swift-openapi-generator)
- [Spectral Linting](https://stoplight.io/open-source/spectral)
- [ReDoc Documentation](https://redocly.com/docs/redoc)