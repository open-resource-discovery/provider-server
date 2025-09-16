export const OCTOKIT = jest.fn().mockImplementation(() => ({
  rest: {
    repos: {
      getContent: jest.fn().mockResolvedValue({
        data: {
          type: "dir",
          content: [],
        },
      }),
      get: jest.fn().mockResolvedValue({
        data: {
          default_branch: "main",
        },
      }),
    },
    git: {
      getTree: jest.fn().mockResolvedValue({
        data: {
          tree: [],
        },
      }),
    },
  },
  request: jest.fn(),
}));
