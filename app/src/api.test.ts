import { describe, expect, it, vi } from 'vitest';

const invoke = vi.fn((..._args: unknown[]) => Promise.resolve(null));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const api = await import('./api.ts');

describe('the library commands', () => {
  it('ask for the index and the user data by their command names', async () => {
    await api.libraryIndex();
    await api.libraryData();
    expect(invoke.mock.calls).toEqual([['library_index'], ['library_data']]);
  });

  it('send a change with the keys it applies to', async () => {
    invoke.mockClear();
    await api.librarySet(['cream-of-the-crop/Dancer/x.milk'], { star: true, add_tags: ['warm up'] });
    expect(invoke).toHaveBeenCalledWith('library_set', { keys: ['cream-of-the-crop/Dancer/x.milk'], change: { star: true, add_tags: ['warm up'] } });
  });

  it('save a smart playlist by its name and filter', async () => {
    invoke.mockClear();
    await api.smartPlaylistSave('Chill', { groups: { speed: ['low'] }, text: '' });
    expect(invoke).toHaveBeenCalledWith('smart_playlist_save', { name: 'Chill', query: { groups: { speed: ['low'] }, text: '' }, starter: null });
  });

  it('save a smart playlist that a starter came from', async () => {
    invoke.mockClear();
    await api.smartPlaylistSave('Chill', { groups: { speed: ['low'] }, text: '' }, 'starter-chill');
    expect(invoke).toHaveBeenCalledWith('smart_playlist_save', { name: 'Chill', query: { groups: { speed: ['low'] }, text: '' }, starter: 'starter-chill' });
  });
});
