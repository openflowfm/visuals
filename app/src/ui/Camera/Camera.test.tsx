// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CameraPanel, CameraProvider, CameraAction } from './Camera';
import { cameraFixture } from './fixture';
afterEach(cleanup);
test('host controller persists across panels, separate opacity controls and source choice', async () => {
  const controller = cameraFixture();
  const stop = vi.spyOn(controller, 'stop');
  const start = vi.spyOn(controller, 'start');
  const page = (open: boolean) => (
    <CameraProvider controller={controller}>
      <CameraAction />
      <CameraPanel open={open} onClose={() => {}} />
    </CameraProvider>
  );
  const mounted = render(page(true));
  expect(start).not.toHaveBeenCalled();
  for (const name of ['Source', 'Appearance', 'Motion']) expect(screen.getByRole('group', { name })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Camera device' }), {
    key: 'End',
  });
  expect(controller.snapshot().deviceId).toBe('brio');
  fireEvent.keyDown(screen.getByRole('slider', { name: 'Camera opacity' }), {
    key: 'End',
  });
  await waitFor(() => expect(controller.snapshot().settings.cameraOpacity).toBe(1));
  expect(controller.snapshot().settings.outlineOpacity).toBe(0.65);
  fireEvent.click(screen.getByRole('switch', { name: 'Enable camera' }));
  expect(controller.snapshot().status).toBe('active');
  mounted.rerender(page(false));
  expect(stop).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Camera on: open controls' }).querySelector('svg[data-icon="camera"]')).toBeTruthy();
  mounted.unmount();
  expect(stop).toHaveBeenCalledOnce();
});
test('denial is visible; absent adapter is disabled', () => {
  const mounted = render(
    <CameraProvider controller={cameraFixture(true)}>
      <CameraPanel open onClose={() => {}} />
    </CameraProvider>,
  );
  fireEvent.click(screen.getByRole('switch', { name: 'Enable camera' }));
  expect(screen.getByRole('alert').textContent).toBe('Camera permission denied.');
  mounted.unmount();
  render(
    <CameraProvider>
      <CameraPanel open onClose={() => {}} />
    </CameraProvider>,
  );
  expect(screen.getByRole('switch', { name: 'Enable camera' }).hasAttribute('disabled')).toBe(true);
});
