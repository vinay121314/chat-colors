import { afterEach, describe, expect, it, vi } from 'vitest';
import { createColorizer } from '../../src/content/colorizer';
import { NEUTRAL, NONE, addStarterKeywords, defaultSettings, type Settings } from '../../src/core/schema';
import { ID, buildSidebar, mountLivePage, mountPage, row, settle } from '../fixtures/sidebar';

/** Opt-in rules + neutral fallback: the configuration these behaviours are tested against. */
const starter = (): Settings => ({ ...addStarterKeywords(defaultSettings()), fallback: NEUTRAL });
const PROJECT = 'g-p-0123456789abcdef0123456789abcdef'; // fixture project id
const GPT = 'g-AbCdEf123'; // fixture custom GPT id

const color = (id: string) =>
  document.querySelector<HTMLElement>(`#ds-sidebar [data-crc="${id}"]`)?.style.getPropertyValue('--crc-c') || null;
const BLUE = '#2f7de1'; // Development
const GREEN = '#16a34a'; // Work

let c: ReturnType<typeof createColorizer>;
afterEach(() => c?.stop());
const host = { write: vi.fn(), setFilter: vi.fn() };

function start(s: Settings = starter()) {
  c = createColorizer(host);
  c.update(s);
  return s;
}
const hidden = (id: string) => document.querySelector(`[data-crc="${id}"]`)!.hasAttribute('data-crc-hidden');

describe('colorizer on fixture sidebar', () => {
  it('decorates sidebar conversations (incl. Project and GPT chats) and ignores other links', () => {
    const { main } = mountPage();
    start();
    expect(color(ID.ts)).toBe(BLUE);
    expect(color(ID.meeting)).toBe(GREEN);
    expect(color(ID.plain)).toBe(NEUTRAL);
    expect(color(ID.project)).toBe('#e03131'); // "urgent" (project chat URL)
    expect(color(ID.gpt)).toBe('#0e9fb3'); // "research" (custom GPT chat URL)
    expect(main.querySelector('[data-crc]')).toBeNull();
    // Only the Project entry is decorated in the shortcuts nav (Images/GPTs/New chat are not).
    const shortcuts = [...document.querySelectorAll('#ds-sidebar nav[aria-label="Sidebar"] [data-crc]')];
    expect(shortcuts.map((e) => e.getAttribute('data-crc'))).toEqual([`group:${PROJECT}`]);
  });

  it('Project/GPT color applies to all its chats; precedence manual > group > rule', () => {
    mountPage();
    const s = starter();
    s.groups[PROJECT] = { color: '#b08900', name: 'Side project' };
    s.groups[GPT] = { color: '#d6336c', name: 'Code helper' };
    start(s);
    expect(color(ID.project)).toBe('#b08900'); // beats its "urgent" keyword rule
    expect(color(ID.gpt)).toBe('#d6336c');
    expect(color(`group:${PROJECT}`)).toBe('#b08900'); // the Project entry itself
    expect(color(ID.ts)).toBe(BLUE); // chats outside the Project unaffected
    c.update({ ...s, overrides: { [ID.project]: '#000000' } });
    expect(color(ID.project)).toBe('#000000'); // manual still wins
  });

  it('filter hides non-matching chats, shows a pill, and restores on clear', async () => {
    mountPage();
    start();
    c.setFilter(BLUE);
    expect(hidden(ID.ts)).toBe(false);
    expect(hidden(ID.meeting)).toBe(true);
    expect(hidden(`group:${PROJECT}`)).toBe(false); // Project entries are never hidden
    const bar = document.querySelector('.crc-filterbar')!;
    expect(bar.textContent).toContain('Showing Development · 1 chat');
    (bar.querySelector('button') as HTMLButtonElement).click();
    expect(host.setFilter).toHaveBeenCalledWith(null);
    c.setFilter(null);
    expect(document.querySelectorAll('[data-crc-hidden]')).toHaveLength(0);
    expect(document.querySelector('.crc-filterbar')).toBeNull();
  });

  it('marks the open chat (aria-current) and follows the marker when it moves', async () => {
    mountLivePage(ID.meeting);
    start();
    const active = () => [...document.querySelectorAll('[data-crc-active]')].map((e) => e.getAttribute('data-crc'));
    expect(active()).toEqual([ID.meeting]);
    document.querySelector(`a[href="/c/${ID.meeting}"]`)!.removeAttribute('aria-current');
    document.querySelector(`a[href="/c/${ID.ts}"]`)!.setAttribute('aria-current', 'page');
    await settle();
    expect(active()).toEqual([ID.ts]);
  });

  it('highlight can be turned off independently, and stop() removes it', () => {
    mountLivePage(ID.meeting);
    const s = start();
    expect(document.querySelectorAll('[data-crc-active]')).toHaveLength(1);
    c.update({ ...s, appearance: { ...s.appearance, highlight: false } });
    expect(document.querySelectorAll('[data-crc-active]')).toHaveLength(0);
    c.update(s);
    c.stop();
    expect(document.querySelectorAll('[data-crc-active]')).toHaveLength(0);
  });

  it('reports a legend of colors in use with labels and counts', () => {
    mountPage();
    start();
    const { legend } = c.current('/');
    expect(legend.find((l) => l.color === BLUE)).toEqual({ color: BLUE, label: 'Development', count: 1 });
    expect(legend.find((l) => l.color === NEUTRAL)?.count).toBe(1);
  });

  it('decorates rows loaded later (lazy load / infinite scroll)', async () => {
    const { list } = mountPage();
    start();
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    list.append(row(`/c/${id}`, 'python script'));
    await settle();
    expect(color(id)).toBe(BLUE);
  });

  it('reclassifies on title change; manual override survives rename', async () => {
    mountPage();
    const s = start();
    const a = document.querySelector<HTMLElement>(`[data-crc="${ID.plain}"]`)!;
    a.querySelector('.truncate')!.textContent = 'Client meeting';
    await settle();
    expect(color(ID.plain)).toBe(GREEN);

    s.overrides[ID.plain] = '#123456';
    c.update(s);
    a.querySelector('.truncate')!.textContent = 'python now';
    await settle();
    expect(color(ID.plain)).toBe('#123456');
  });

  it('handles characterData-only title edits', async () => {
    mountPage();
    start();
    const text = document.querySelector(`[data-crc="${ID.plain}"] .truncate`)!.firstChild as Text;
    text.data = 'urgent!';
    await settle();
    expect(color(ID.plain)).toBe('#e03131');
  });

  it('never creates duplicate controls under repeated mutations and updates', async () => {
    const { list } = mountPage();
    const s = start();
    for (let i = 0; i < 5; i++) {
      list.append(document.createElement('span'));
      c.update(s);
      await settle();
    }
    for (const a of document.querySelectorAll('#ds-sidebar [data-crc]')) expect(a.querySelectorAll('.crc-btn')).toHaveLength(1);
  });

  it('re-binds when the sidebar is removed and a new one inserted', async () => {
    const { aside } = mountPage();
    start();
    const parent = aside.parentElement!;
    aside.remove();
    await settle();
    const fresh = buildSidebar([[`/c/${ID.recipe}`, 'travel notes']]).aside;
    parent.prepend(fresh);
    await settle();
    expect(color(ID.recipe)).toBe('#e8590c'); // Personal
    // and keeps observing the new one
    fresh.querySelector('#list')!.append(row(`/c/${ID.ts}`, 'api design'));
    await settle();
    expect(color(ID.ts)).toBe(BLUE);
  });

  it('handles the sidebar appearing after start (collapsed -> expanded)', async () => {
    start();
    expect(document.querySelector('[data-crc]')).toBeNull();
    mountPage();
    await settle();
    expect(color(ID.ts)).toBe(BLUE);
  });

  it('updates a recycled row whose href changes, and undecorates non-conversation hrefs', async () => {
    mountPage();
    start();
    const a = document.querySelector<HTMLAnchorElement>(`[data-crc="${ID.plain}"]`)!;
    const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    a.setAttribute('href', `/c/${id}`);
    await settle();
    expect(a.getAttribute('data-crc')).toBe(id);
    a.setAttribute('href', '/gpts');
    await settle();
    expect(a.hasAttribute('data-crc')).toBe(false);
    expect(a.querySelector('.crc-btn')).toBeNull();
  });

  it('disable removes everything; enable restores it', () => {
    mountPage();
    const s = start();
    expect(document.getElementById('crc-vars')).not.toBeNull();
    c.update({ ...s, enabled: false });
    expect(document.querySelector('[data-crc], .crc-btn, #crc-vars, .crc-filterbar, [data-crc-hidden]')).toBeNull();
    c.update({ ...s, enabled: true });
    expect(color(ID.ts)).toBe(BLUE);
  });

  it('applies appearance settings as CSS variables', () => {
    mountPage();
    const s = start();
    c.update({ ...s, appearance: { mode: 'both', thickness: 2, opacity: 50, radius: 0, fill: 20, highlight: true } });
    expect(document.getElementById('crc-vars')!.textContent).toBe(':root{--crc-w:2px;--crc-o:0.5;--crc-r:0px;--crc-f:20%}');
    c.update({ ...s, appearance: { ...s.appearance, mode: 'bar' } });
    expect(document.getElementById('crc-vars')!.textContent).toContain('.crc-fill{display:none!important}');
    c.update({ ...s, appearance: { ...s.appearance, mode: 'fill' } });
    expect(document.getElementById('crc-vars')!.textContent).toContain('.crc-bar{display:none!important}');
  });

  it('manual NONE and fallback NONE leave rows uncolored but still controllable', () => {
    mountPage();
    const s = starter();
    s.fallback = NONE;
    s.overrides[ID.ts] = NONE;
    start(s);
    expect(color(ID.ts)).toBeNull();
    expect(color(ID.plain)).toBeNull();
    expect(document.querySelector(`[data-crc="${ID.ts}"] .crc-btn`)).not.toBeNull();
  });

  it('does nothing (and does not throw) on an unsupported layout', async () => {
    document.body.append(row(`/c/${ID.ts}`, 'python'));
    start();
    await settle();
    expect(document.querySelector('[data-crc]')).toBeNull();
  });

  it('reports the current conversation with its visible title', () => {
    mountPage();
    start();
    expect(c.current(`/c/${ID.meeting}`)).toMatchObject({ id: ID.meeting, title: 'Client meeting notes', group: null });
    expect(c.current(`/g/${PROJECT}-side-project/c/${ID.project}`)).toMatchObject({
      id: ID.project,
      group: { key: PROJECT, name: 'Project', kind: 'Project' }, // name from the sidebar entry's text
    });
    expect(c.current('/')).toMatchObject({ id: null, title: null });
    expect(c.current(`/c/${ID.main}`)).toMatchObject({ id: ID.main, title: null }); // not in sidebar
  });
});
