const assert = require('assert');
const path = require('path');
const { workspaceFileFor } = require('../../src/services/location');

const neverExists = () => false;

assert.strictEqual(
  workspaceFileFor('/tmp/OrchestrAI projects', 'Release plan', { existsSync: neverExists, pathApi: path.posix }),
  '/tmp/OrchestrAI projects/Release plan.orchestrai.json',
);
assert.strictEqual(
  workspaceFileFor('C:\\Users\\Ada\\OrchestrAI projects', 'Release plan', { existsSync: neverExists, pathApi: path.win32 }),
  'C:\\Users\\Ada\\OrchestrAI projects\\Release plan.orchestrai.json',
);
assert.strictEqual(
  workspaceFileFor('/tmp/projects', '../client\\api:*?', { existsSync: neverExists, pathApi: path.posix }),
  '/tmp/projects/.._client_api___.orchestrai.json',
);
assert.strictEqual(
  workspaceFileFor('/tmp/projects', '   ', { existsSync: neverExists, pathApi: path.posix }),
  '/tmp/projects/workspace.orchestrai.json',
);

const existing = new Set([
  '/tmp/projects/Agent Lab.orchestrai.json',
  '/tmp/projects/Agent Lab (2).orchestrai.json',
]);
assert.strictEqual(
  workspaceFileFor('/tmp/projects', 'Agent Lab', { existsSync: (file) => existing.has(file), pathApi: path.posix }),
  '/tmp/projects/Agent Lab (3).orchestrai.json',
);

console.log('location: all passed');
