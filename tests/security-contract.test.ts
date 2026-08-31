import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const builderConfig = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8');
const afterPack = readFileSync(new URL('../scripts/after-pack.cjs', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main/main.ts', import.meta.url), 'utf8');

describe('desktop security contract', () => {
  it('blocks embedded objects, base-url rewriting and form submissions in the renderer', () => {
    expect(indexHtml).toContain("object-src 'none'");
    expect(indexHtml).toContain("base-uri 'none'");
    expect(indexHtml).toContain("form-action 'none'");
    expect(indexHtml).not.toContain('localhost');
  });

  it('denies renderer navigation, popup windows and runtime permission prompts', () => {
    expect(mainSource).toContain("webContents.on('will-navigate'");
    expect(mainSource).toContain('webContents.setWindowOpenHandler');
    expect(mainSource).toContain('setPermissionRequestHandler');
    expect(mainSource).toContain('sandbox: true');
  });

  it('does not advertise unused camera, microphone, audio or Bluetooth access', () => {
    expect(builderConfig).toContain('afterPack: scripts/after-pack.cjs');
    expect(builderConfig).toContain('NSAudioCaptureUsageDescription: null');
    expect(builderConfig).toContain('NSBluetoothAlwaysUsageDescription: null');
    expect(builderConfig).toContain('NSBluetoothPeripheralUsageDescription: null');
    expect(builderConfig).toContain('NSCameraUsageDescription: null');
    expect(builderConfig).toContain('NSMicrophoneUsageDescription: null');
    expect(afterPack).toContain("'NSAppTransportSecurity'");
    expect(afterPack).toContain("'NSCameraUsageDescription'");
    expect(afterPack).toContain("'NSMicrophoneUsageDescription'");
  });
});
