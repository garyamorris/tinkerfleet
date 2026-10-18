/** Lesson 3: use the application's actual validator, not a permissive lesson copy. */
import assert from 'node:assert/strict';
import {
  validateAction,
  validateRelativePath,
  isExcludedPath,
} from '../src/server/runner-policy.js';

const input = { kind: 'command', executable: 'node', args: ['--test', 'sum.test.js'] };
const action = validateAction(input);
assert.deepEqual(action, input);

// Validation returns a detached copy; changing the caller's input changes nothing.
input.args[0] = '--version';
assert.deepEqual(action, { kind: 'command', executable: 'node', args: ['--test', 'sum.test.js'] });
assert.equal(validateRelativePath('src/sum.js'), 'src/sum.js');
assert.ok(isExcludedPath('node_modules/dependency.js'));
assert.ok(isExcludedPath('.env'));
assert.throws(() => validateRelativePath('../outside.js'));
assert.throws(() => validateRelativePath('/etc/passwd'));
assert.deepEqual(
  validateAction({ kind: 'command', executable: 'sh', args: ['-c', 'printf approved'] }),
  { kind: 'command', executable: 'sh', args: ['-c', 'printf approved'] },
);
assert.throws(() =>
  validateAction({ kind: 'command', executable: 'node', args: ['bad\0argument'] }),
);
assert.throws(() =>
  validateAction({ kind: 'edit', path: 'sum.js', content: 'safe', bypassApproval: true }),
);
assert.deepEqual(
  validateAction({ kind: 'edit', path: 'sum.js', content: 'export const answer = 42;\n' }),
  {
    kind: 'edit',
    path: 'sum.js',
    content: 'export const answer = 42;\n',
  },
);

console.log(
  '3. Tools: accepted exact structured input; rejected file traversal, invalid arguments, and extra fields.',
);
console.log(
  'Nothing was read or executed. A valid command still needs your approval; a selected folder is not an OS sandbox.',
);
console.log(
  'Exercise: add a failing assertion for an absolute edit path. Why must an explicit sh -c command show the full script in its approval?',
);
