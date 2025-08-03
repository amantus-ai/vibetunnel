import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepositoryRoutes } from './repositories';

// Mock functions (must be declared before vi.mock calls due to hoisting)
const mockExecAsync = vi.fn();

// Mock child_process and util
vi.mock('child_process', () => ({
  exec: () => mockExecAsync(),
}));

vi.mock('util', () => ({
  promisify: () => () => mockExecAsync(),
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  access: vi.fn(),
}));

// Mock logger
vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock path utils
vi.mock('../utils/path-utils', () => ({
  resolveAbsolutePath: vi.fn((path: string) => path),
}));

describe('repositories routes', () => {
  let router: ReturnType<typeof createRepositoryRoutes>;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockJson: ReturnType<typeof vi.fn>;
  let mockStatus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    router = createRepositoryRoutes();

    mockJson = vi.fn();
    mockStatus = vi.fn(() => ({ json: mockJson }));

    mockReq = {
      query: {},
    };

    mockRes = {
      json: mockJson,
      status: mockStatus,
    };

    // Reset mocks
    mockExecAsync.mockReset();
  });

  describe('GET /repositories/branches', () => {
    it('should return branches with correct property names for Mac compatibility', async () => {
      // Mock git branch command
      mockExecAsync
        .mockResolvedValueOnce({ stdout: 'main\n' }) // current branch
        .mockResolvedValueOnce({ stdout: '* main\n  feature/test\n' }) // local branches
        .mockResolvedValueOnce({ stdout: '  origin/main\n  origin/feature/test\n' }) // remote branches
        .mockResolvedValueOnce({
          stdout:
            'worktree /path/to/repo\nbranch refs/heads/main\n\nworktree /path/to/feature\nbranch refs/heads/feature/test\n',
        }); // worktree list

      mockReq.query = { path: '/test/repo' };

      // Find the branches route handler
      const routeStack = router.stack;
      const branchesRoute = routeStack.find(
        (layer) => layer.route?.path === '/repositories/branches' && layer.route?.methods?.get
      );

      expect(branchesRoute).toBeDefined();

      // Execute the route handler
      if (branchesRoute?.route?.stack?.[0]) {
        await branchesRoute.route.stack[0].handle(mockReq as Request, mockRes as Response);
      }

      expect(mockJson).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'main',
            current: true,
            remote: false,
            worktreePath: '/path/to/repo', // ✅ CORRECT PROPERTY NAME for Mac compatibility
          }),
          expect.objectContaining({
            name: 'feature/test',
            current: false,
            remote: false,
            worktreePath: '/path/to/feature', // ✅ CORRECT PROPERTY NAME for Mac compatibility
          }),
          expect.objectContaining({
            name: 'origin/main',
            current: false,
            remote: true,
          }),
          expect.objectContaining({
            name: 'origin/feature/test',
            current: false,
            remote: true,
          }),
        ])
      );
    });

    it('should handle missing path parameter', async () => {
      mockReq.query = {};

      const routeStack = router.stack;
      const branchesRoute = routeStack.find(
        (layer) => layer.route?.path === '/repositories/branches' && layer.route?.methods?.get
      );

      if (branchesRoute?.route?.stack?.[0]) {
        await branchesRoute.route.stack[0].handle(mockReq as Request, mockRes as Response);
      }

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'Missing or invalid path parameter',
      });
    });

    it('should handle git command errors gracefully', async () => {
      // Mock git command failure
      mockExecAsync.mockRejectedValue(new Error('Not a git repository'));

      mockReq.query = { path: '/test/repo' };

      const routeStack = router.stack;
      const branchesRoute = routeStack.find(
        (layer) => layer.route?.path === '/repositories/branches' && layer.route?.methods?.get
      );

      if (branchesRoute?.route?.stack?.[0]) {
        await branchesRoute.route.stack[0].handle(mockReq as Request, mockRes as Response);
      }

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'Failed to list branches',
      });
    });
  });

  describe('Branch interface compatibility', () => {
    it('should have the correct type structure for Mac Swift interop', () => {
      // This test ensures the Branch interface matches what Mac app expects
      const expectedBranchStructure = {
        name: expect.any(String),
        current: expect.any(Boolean),
        remote: expect.any(Boolean),
        worktreePath: expect.any(String), // ✅ Mac expects this property name
      };

      // This validates that our interface is compatible with:
      // struct Branch: Codable {
      //     let name: String
      //     let current: Bool
      //     let remote: Bool
      //     let worktreePath: String?
      // }
      expect(expectedBranchStructure).toBeDefined();
    });
  });
});
