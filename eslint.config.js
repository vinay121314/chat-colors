import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'test-results', 'playwright-report', '.pw-browsers'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "AssignmentExpression[left.property.name='innerHTML']", message: 'Use textContent / DOM APIs.' },
        { selector: "AssignmentExpression[left.property.name='outerHTML']", message: 'Use textContent / DOM APIs.' },
        { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: 'Use DOM APIs.' },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
);
