import { vi } from "vitest";
export const OCTOKIT = vi.fn().mockImplementation(() => ({
  rest: {
    repos: {
      getContent: vi.fn().mockResolvedValue({
        data: {
          type: "dir",
          content: [],
        },
      }),
      get: vi.fn().mockResolvedValue({
        data: {
          default_branch: "main",
        },
      }),
    },
    git: {
      getTree: vi.fn().mockResolvedValue({
        data: {
          tree: [],
        },
      }),
    },
  },
  request: vi.fn(),
}));
