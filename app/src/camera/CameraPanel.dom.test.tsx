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
  fireEvent.click(screen.getByRole('switch', { name: 'Enable camera' }));
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
  await waitFor(() => expect(f.end).toHaveBeenCalledWith('test'));
});
test('denial is visible and opening the sheet never requests camera', async () => {
  const f = fixture(true);
  render(
    <CameraProvider controller={f.controller}>
      <CameraPanel open onClose={() => {}} />
    </CameraProvider>,
  );
  expect(f.acquire).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('switch', { name: 'Enable camera' }));
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

test('source picker has safe default and anonymous labels; grouped controls and enable switch remain accessible', async () => {
  const f = fixture();
  f.controller.state = {
    ...f.controller.state,
    devices: [
      { deviceId: 'desk', label: '' },
      { deviceId: 'usb', label: 'USB camera' },
    ],
  };
  render(
    <CameraProvider controller={f.controller}>
      <CameraPanel open onClose={() => {}} />
    </CameraProvider>,
  );
  expect(screen.getByRole('combobox', { name: 'Camera device' }).textContent).toContain('System default camera');
  for (const name of ['Source', 'Appearance', 'Motion']) expect(screen.getByRole('region', { name })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Camera device' }), { key: 'ArrowDown' });
  expect(f.controller.state.deviceId).toBe('desk');
  expect(screen.getByRole('combobox').textContent).toContain('Camera 1');
  expect(f.acquire).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'End' });
  expect(f.controller.state.deviceId).toBe('usb');
  fireEvent.click(screen.getByRole('switch', { name: 'Enable camera' }));
  expect(screen.getByRole('switch', { name: 'Enable camera' }).getAttribute('aria-checked')).toBe('true');
  await waitFor(() => expect(f.acquire).toHaveBeenCalledWith('usb'));
  fireEvent.click(screen.getByRole('switch', { name: 'Enable camera' }));
  expect(screen.getByRole('switch', { name: 'Enable camera' }).getAttribute('aria-checked')).toBe('false');
  expect(f.controller.state.status).toBe('off');
});
test('enable toggle can cancel a pending permission request', async () => {
  const f = fixture();
  let resolve!: (stream: MediaStream) => void;
  f.acquire.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(
    <CameraProvider controller={f.controller}>
      <CameraPanel open onClose={() => {}} />
    </CameraProvider>,
  );
  fireEvent.click(screen.getByRole('switch', { name: 'Enable camera' }));
  expect(f.controller.state.status).toBe('starting');
  fireEvent.click(screen.getByRole('switch', { name: 'Enable camera' }));
  const stop = vi.fn();
  await act(async () => resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream));
  expect(stop).toHaveBeenCalledOnce();
  expect(f.controller.state.status).toBe('off');
});

test('header action uses the shared camera glyph and announces a dialog without starting capture', () => {
  const f = fixture();
  const open = vi.fn();
  window.addEventListener('vf-sheet', open);
  render(
    <CameraProvider controller={f.controller}>
      <CameraAction className="home-tool" />
    </CameraProvider>,
  );
  const action = screen.getByRole('button', { name: 'Camera controls' });
  expect(action.getAttribute('aria-haspopup')).toBe('dialog');
  expect(action.querySelector('svg[data-icon="camera"]')?.getAttribute('viewBox')).toBe('0 0 16 16');
  expect(action.classList.contains('home-tool')).toBe(true);
  fireEvent.click(action);
  expect(open).toHaveBeenCalledOnce();
  expect(f.acquire).not.toHaveBeenCalled();
  window.removeEventListener('vf-sheet', open);
});
