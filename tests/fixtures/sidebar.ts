// DOM fixture modelled on what was verified live (aside#ds-sidebar > nav[data-slot=sidebar-history]) plus
// UNVERIFIED row markup (<a href="/c/<uuid>"> with the title inside). Titles are synthetic.

export const ID = {
  ts: '11111111-1111-4111-8111-111111111111',
  meeting: '22222222-2222-4222-8222-222222222222',
  recipe: '33333333-3333-4333-8333-333333333333',
  plain: '44444444-4444-4444-8444-444444444444',
  project: '55555555-5555-4555-8555-555555555555',
  gpt: '66666666-6666-4666-8666-666666666666',
  main: '99999999-9999-4999-8999-999999999999',
};

export const ROWS: [string, string][] = [
  [`/c/${ID.ts}`, 'Fix TypeScript bug in parser'],
  [`/c/${ID.meeting}`, 'Client meeting notes'],
  [`/c/${ID.recipe}`, 'Weeknight recipe ideas'],
  [`/c/${ID.plain}`, 'Hello there'],
  [`/g/g-p-0123456789abcdef0123456789abcdef-side-project/c/${ID.project}`, 'Project: urgent launch checklist'],
  [`/g/g-AbCdEf123-code-helper/c/${ID.gpt}`, 'Research paper summary'],
];

export function row(href: string, title: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.className = 'x1abc x2def';
  const t = document.createElement('div');
  t.className = 'truncate';
  t.textContent = title;
  a.append(t);
  return a;
}

export function buildSidebar(rows: [string, string][] = ROWS): { aside: HTMLElement; list: HTMLElement } {
  const aside = document.createElement('aside');
  aside.id = 'ds-sidebar';
  const nav = document.createElement('nav');
  nav.dataset.slot = 'sidebar-history';
  nav.setAttribute('aria-label', 'Chat history');
  const shortcuts = document.createElement('nav');
  shortcuts.setAttribute('aria-label', 'Sidebar');
  const links: [string, string][] = [
    ['/images', 'Images'],
    ['/gpts', 'GPTs'],
    ['/g/g-p-0123456789abcdef0123456789abcdef-side-project/project', 'Project'],
    ['/', 'New chat'],
  ];
  for (const [href, label] of links) shortcuts.append(row(href, label));
  const list = document.createElement('div');
  list.id = 'list';
  for (const [h, t] of rows) list.append(row(h, t));
  nav.append(shortcuts, list);
  aside.append(nav);
  return { aside, list };
}

/** Full page: sidebar + main area that also contains a conversation link (must be ignored). */
export function mountPage(): { aside: HTMLElement; list: HTMLElement; main: HTMLElement } {
  const root = document.createElement('div');
  root.id = 'web-mobile-root';
  const { aside, list } = buildSidebar();
  const main = document.createElement('main');
  main.append(row(`/c/${ID.main}`, 'Fix TypeScript bug (link in a message)'));
  root.append(aside, main);
  document.body.append(root);
  return { aside, list, main };
}

/**
 * Mirrors the VERIFIED logged-in structure (diagnostics, 2026-10-29):
 * aside[data-app-shell-left-panel-appearance] > … > [role=list] >
 *   div[role=listitem][data-sidebar-cycle-item][data-thread-title-trigger] > a[href][aria-current] + menu button.
 * The open chat's link carries aria-current="page". Titles synthetic.
 */
export function mountLivePage(openId: string = ID.meeting): { aside: HTMLElement; list: HTMLElement; main: HTMLElement } {
  const aside = document.createElement('aside');
  aside.setAttribute('data-app-shell-left-panel-appearance', 'expanded');
  const list = document.createElement('div');
  list.setAttribute('role', 'list');
  for (const [href, title] of ROWS) {
    const item = document.createElement('div');
    item.setAttribute('role', 'listitem');
    item.setAttribute('data-sidebar-cycle-item', '');
    item.setAttribute('data-thread-title-trigger', '');
    const a = row(href, title);
    if (href.endsWith(openId)) a.setAttribute('aria-current', 'page');
    const menu = document.createElement('button');
    menu.type = 'button';
    menu.setAttribute('aria-label', 'Open conversation options');
    item.append(a, menu);
    list.append(item);
  }
  aside.append(list);
  const main = document.createElement('main');
  main.append(row(`/c/${ID.main}`, 'Fix TypeScript bug (link in a message)'));
  document.body.append(aside, main);
  return { aside, list, main };
}

export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
/** Mutation observer callbacks are microtasks; then our rAF batch. */
export const settle = async () => {
  await Promise.resolve();
  await nextFrame();
};
