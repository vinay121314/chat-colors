import { afterEach, describe, expect, it, vi } from 'vitest';
import { createColorizer } from '../../src/content/colorizer';
import { NEUTRAL, NONE, defaultSettings, type Settings } from '../../src/core/schema';
import { ID, buildSidebar, mountPage, row, settle } from '../fixtures/sidebar';

const color = (id: string) =>
  document.querySelector<HTMLElement>(`#ds-sidebar [data-crc="${id}"]`)?.style.getPropertyValue('--crc-c') || null;
const BLUE = '#2f7de1'; // Development
const GREEN = '#16a34a'; // Work

let c: ReturnType<typeof createColorizer>;
afterEach(() => c?.stop());

function start(s: Settings = defaultSettings()) {
  c = createColorizer(vi.fn());
  c.update(s);
  return s;
}

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
    expect(document.querySelectorAll('#ds-sidebar nav[aria-label="Sidebar"] [data-crc]')).toHaveLength(0);
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
    expect(document.querySelector('[data-crc], .crc-btn, #crc-vars')).toBeNull();
    c.update({ ...s, enabled: true });
    expect(color(ID.ts)).toBe(BLUE);
  });

  it('applies appearance settings as CSS variables', () => {
    mountPage();
    const s = start();
    c.update({ ...s, appearance: { thickness: 2, opacity: 50, radius: 0 } });
    expect(document.getElementById('crc-vars')!.textContent).toBe(':root{--crc-w:2px;--crc-o:0.5;--crc-r:0px}');
  });

  it('manual NONE and fallback NONE leave rows uncolored but still controllable', () => {
    mountPage();
    const s = defaultSettings();
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
    expect(c.current(`/c/${ID.meeting}`)).toEqual({ id: ID.meeting, title: 'Client meeting notes' });
    expect(c.current(`/g/g-p-0123456789abcdef0123456789abcdef-side-project/c/${ID.project}`).id).toBe(ID.project);
    expect(c.current('/')).toEqual({ id: null, title: null });
    expect(c.current(`/c/${ID.main}`)).toEqual({ id: ID.main, title: null }); // not in sidebar
  });
});
