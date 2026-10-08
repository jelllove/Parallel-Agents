export function desktopTarget(platform = process.platform, arch = process.arch) {
  if (platform === 'win32' && arch === 'x64')
    return { asarSegments: ['win-unpacked', 'resources', 'app.asar'] };
  if (platform === 'linux' && arch === 'x64')
    return { asarSegments: ['linux-unpacked', 'resources', 'app.asar'] };
  if (platform === 'darwin' && arch === 'arm64')
    return {
      asarSegments: ['mac-arm64', 'Parallel Agents.app', 'Contents', 'Resources', 'app.asar'],
    };
  throw new Error(`Unsupported desktop target: ${platform}/${arch}.`);
}

export function providerShim(agent, platform) {
  if (!/^[a-z][a-z0-9-]*$/.test(agent)) throw new Error('Invalid provider shim name.');
  if (platform === 'win32')
    return { name: `${agent}.cmd`, content: '@echo off\r\necho SMOKE_AGENT\r\n', mode: 0o644 };
  if (platform !== 'darwin' && platform !== 'linux')
    throw new Error(`Unsupported provider shim platform: ${platform}.`);
  return { name: agent, content: '#!/bin/sh\nprintf "SMOKE_AGENT\\n"\n', mode: 0o755 };
}
