'use strict';
const startButton = document.querySelector('#start');
const loading = document.querySelector('#loading');
const progress = document.querySelector('#progress');
const statusText = document.querySelector('#status');
const errorText = document.querySelector('#error');
const objectUrls = [];

async function resolvePayload(entry) {
  if (entry.url) return entry.url;
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前浏览器版本较旧，请使用新版 Chrome、Edge 或 Safari 打开。');
  }
  let partIndex = 0;
  let currentReader;
  let received = 0;
  // Feed each compressed part into one continuous gzip stream. The original
  // compressed payload is never duplicated into a second in-memory buffer.
  const source = new ReadableStream({
    async pull(controller) {
      try {
        while (true) {
          if (!currentReader) {
            if (partIndex === entry.parts.length) { controller.close(); return; }
            const response = await fetch(entry.parts[partIndex++]);
            if (!response.ok) throw new Error(`资源下载失败（${response.status}），请刷新重试。`);
            currentReader = response.body.getReader();
          }
          const {done, value} = await currentReader.read();
          if (done) { currentReader.releaseLock(); currentReader = null; continue; }
          received += value.byteLength;
          progress.value = Math.min(.65, received / entry.bytes * .65);
          statusText.textContent = `正在下载资源 ${Math.round(received / 1048576)} / ${Math.ceil(entry.bytes / 1048576)} MB`;
          controller.enqueue(value);
          return;
        }
      } catch (error) { controller.error(error); }
    },
    async cancel(reason) { if (currentReader) await currentReader.cancel(reason); }
  });
  const decoded = source.pipeThrough(new DecompressionStream('gzip'));
  const blob = await new Response(decoded, {headers: {'Content-Type': entry.mime}}).blob();
  const url = URL.createObjectURL(blob);
  objectUrls.push(url);
  return url;
}

startButton.addEventListener('click', async () => {
  startButton.disabled = true;
  startButton.hidden = true;
  progress.hidden = false;
  errorText.textContent = '';
  try {
    const canvas = document.querySelector('#unity-canvas');
    if (!canvas.getContext('webgl2')) throw new Error('此设备未启用 WebGL 2，请换用新版浏览器。');
    statusText.textContent = '正在准备游戏…';
    const response = await fetch('build-manifest.json', {cache: 'no-cache'});
    if (!response.ok) throw new Error(`游戏配置加载失败（${response.status}）。`);
    const manifest = await response.json();
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = manifest.loader.url;
      script.onload = resolve;
      script.onerror = () => reject(new Error('游戏程序下载失败，请刷新重试。'));
      document.body.appendChild(script);
    });
    const config = {companyName: 'Private Study', productName: 'Bounce Garden', productVersion: '0.3.0',
      streamingAssetsUrl: 'StreamingAssets', autoSyncPersistentDataPath: true,
      devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      showBanner(message, type) { if (type === 'error') errorText.textContent = message; }};
    for (const key of ['dataUrl', 'frameworkUrl', 'codeUrl']) config[key] = await resolvePayload(manifest[key]);
    statusText.textContent = '正在启动游戏…';
    window.unityInstance = await createUnityInstance(canvas, config, value => {
      progress.value = .65 + value * .35;
    });
    for (const url of objectUrls.splice(0)) URL.revokeObjectURL(url);
    loading.hidden = true;
    canvas.focus();
    document.documentElement.dataset.gameReady = 'true';
  } catch (error) {
    console.error(error);
    for (const url of objectUrls.splice(0)) URL.revokeObjectURL(url);
    progress.hidden = true;
    statusText.textContent = '游戏未能启动';
    errorText.textContent = String(error.message || error);
    startButton.hidden = false;
    startButton.textContent = '刷新重试';
    startButton.disabled = false;
    startButton.onclick = () => location.reload();
    document.documentElement.dataset.gameError = 'true';
  }
}, {once: true});
