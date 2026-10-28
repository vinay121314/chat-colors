import { beforeEach } from 'vitest';
import { resetChrome } from './chrome-mock';

beforeEach(() => {
  resetChrome();
  document.head.replaceChildren();
  document.body.replaceChildren();
});
