// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CameraProvider, CameraPanel, CameraAction } from './CameraPanel';
import { CameraController } from './controller';
afterEach(cleanup);
function fixture(denied = false) {
  const stop = vi.fn();
  const track = { stop, onended: null, readyState: 'live' };
  const acquire = vi.fn(async () => {
    if (denied) throw new Error('Permission denied');
    return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  });
  const end = vi.fn(async () => {});
  const source = { ready: Promise.resolve(), frame: () => null, reset: vi.fn(), dispose: vi.fn() };
  const controller = new CameraController({ acquire, end, source: () => source, begin: async () => 'test', submit: async (frame) => frame.sequence, now: () => performance.now() });
  return { controller, acquire, stop, end };
}
test('sheet closure and view content changes preserve capture; unmount releases it', async () => {
  const f = fixture();
  const page = (open: boolean, view: string) => (
    <CameraProvider controller={f.controller}>
      <main>
        {view}
        <CameraAction />
      </main>
      <CameraPanel open={open} onClose={() => {}} />
    </CameraProvider>
  );
  const mounted = render(page(true, 'Home'));
  expect(f.acquire).not.toHaveBeenCalled();
  expect(screen.getByRole('slider', { name: 'Camera opacity' }).getAttribute('aria-valuenow')).toBe('0');
  expect(screen.getByRole('slider', { name: 'Outline opacity' }).getAttribute('aria-valuenow')).toBe('65');
  fireEvent.click(screen.getByRole('button', { name: 'Enable camera' }));
  await waitFor(() => expect(f.controller.state.status).toBe('active'));
  mounted.rerender(page(false, 'Live'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(f.stop).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Camera on: open controls' })).toBeTruthy();
  mounted.rerender(page(true, 'Home'));
  fireEvent.click(screen.getByRole('button', { name: 'Bring my outline back' }));
  expect(f.controller.state.settings).toMatchObject({ outlineOpacity: 1, cameraOpacity: 0, feedMix: 0.3 });
  mounted.unmount();
  expect(f.stop).toHaveBeenCalledOnce();
  expect(f.end).toHaveBeenCalledWith('test');
});
test('denial is visible and opening the sheet never requests camera', async () => {
  const f = fixture(true);
  render(
    <CameraProvider controller={f.controller}>
      <CameraPanel open onClose={() => {}} />
    </CameraProvider>,
  );
  expect(f.acquire).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Enable camera' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Permission denied');
});
test('pagehide releases capture without changing existing UI settings', async () => {
  const f = fixture();
  render(
    <CameraProvider controller={f.controller}>
      <CameraPanel open onClose={() => {}} />
    </CameraProvider>,
  );
  await act(() => f.controller.start());
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(f.stop).toHaveBeenCalledOnce();
  expect(f.controller.state.settings.outlineOpacity).toBe(0.65);
});
