(() => {
  'use strict';

  const imageInput = document.getElementById('imageInput');
  const brightnessInput = document.getElementById('brightness');
  const contrastInput = document.getElementById('contrast');
  const asciiWidthInput = document.getElementById('asciiWidth');
  const characterSetSelect = document.getElementById('characterSet');
  const invertInput = document.getElementById('invert');
  const resetButton = document.getElementById('resetButton');
  const downloadButton = document.getElementById('downloadButton');
  const brightnessValue = document.getElementById('brightnessValue');
  const contrastValue = document.getElementById('contrastValue');
  const asciiWidthValue = document.getElementById('asciiWidthValue');
  const status = document.getElementById('status');
  const asciiSize = document.getElementById('asciiSize');
  const asciiOutput = document.getElementById('asciiOutput');
  const workCanvas = document.getElementById('workCanvas');
  const previewCanvas = document.getElementById('previewCanvas');

  const workContext = workCanvas.getContext('2d', { willReadFrequently: true });
  const previewContext = previewCanvas.getContext('2d', { willReadFrequently: true });

  const characterSets = {
    dense: '@%#*+=-:. ',
    classic: '@#S%?*+;:,. ',
    blocks: '█▓▒░ ',
    simple: '#*:. '
  };

  let sourceImage = null;
  let sourceObjectUrl = null;
  let currentAscii = '';
  let renderFrame = 0;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function signedLabel(value) {
    const n = Number(value);
    return n > 0 ? `+${n}` : String(n);
  }

  function updateControlLabels() {
    brightnessValue.textContent = signedLabel(brightnessInput.value);
    contrastValue.textContent = signedLabel(contrastInput.value);
    asciiWidthValue.textContent = asciiWidthInput.value;
  }

  function adjustChannel(channel, brightness, contrast) {
    const brightnessOffset = brightness * 2.55;
    const contrast255 = contrast * 2.55;
    const contrastFactor =
      (259 * (contrast255 + 255)) /
      (255 * (259 - contrast255));

    const brightened = channel + brightnessOffset;
    return clamp(contrastFactor * (brightened - 128) + 128, 0, 255);
  }

  function adjustedRgb(data, index, brightness, contrast) {
    return {
      r: adjustChannel(data[index], brightness, contrast),
      g: adjustChannel(data[index + 1], brightness, contrast),
      b: adjustChannel(data[index + 2], brightness, contrast),
      a: data[index + 3]
    };
  }

  function toLuminance(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function buildAscii() {
    if (!sourceImage) return;

    const columns = clamp(Number.parseInt(asciiWidthInput.value, 10) || 90, 20, 200);
    const sourceAspect = sourceImage.naturalHeight / sourceImage.naturalWidth;

    // Monospace characters are normally taller than they are wide.
    // About 0.5 keeps the reconstructed image close to the source proportions.
    const characterAspectCorrection = 0.5;
    const rows = clamp(
      Math.round(columns * sourceAspect * characterAspectCorrection),
      1,
      240
    );

    workCanvas.width = columns;
    workCanvas.height = rows;
    workContext.clearRect(0, 0, columns, rows);
    workContext.drawImage(sourceImage, 0, 0, columns, rows);

    const imageData = workContext.getImageData(0, 0, columns, rows);
    const data = imageData.data;
    const brightness = Number(brightnessInput.value);
    const contrast = Number(contrastInput.value);
    const baseCharacters = characterSets[characterSetSelect.value] || characterSets.dense;
    const characters = invertInput.checked
      ? [...baseCharacters].reverse().join('')
      : baseCharacters;

    const lines = new Array(rows);

    for (let y = 0; y < rows; y += 1) {
      let line = '';

      for (let x = 0; x < columns; x += 1) {
        const index = (y * columns + x) * 4;
        const pixel = adjustedRgb(data, index, brightness, contrast);

        // Fully transparent pixels are treated as white/background.
        const luminance = pixel.a < 13
          ? 255
          : toLuminance(pixel.r, pixel.g, pixel.b);

        const characterIndex = clamp(
          Math.round((luminance / 255) * (characters.length - 1)),
          0,
          characters.length - 1
        );

        line += characters[characterIndex];
      }

      lines[y] = line;
    }

    currentAscii = lines.join('\n');
    asciiOutput.textContent = currentAscii;
    asciiSize.textContent = `${columns} × ${rows} 字符`;
    downloadButton.disabled = false;
  }

  function drawPreview() {
    if (!sourceImage) return;

    const maxDimension = 520;
    const scale = Math.min(
      1,
      maxDimension / Math.max(sourceImage.naturalWidth, sourceImage.naturalHeight)
    );

    const width = Math.max(1, Math.round(sourceImage.naturalWidth * scale));
    const height = Math.max(1, Math.round(sourceImage.naturalHeight * scale));

    previewCanvas.width = width;
    previewCanvas.height = height;
    previewContext.clearRect(0, 0, width, height);
    previewContext.drawImage(sourceImage, 0, 0, width, height);

    const frame = previewContext.getImageData(0, 0, width, height);
    const data = frame.data;
    const brightness = Number(brightnessInput.value);
    const contrast = Number(contrastInput.value);

    for (let index = 0; index < data.length; index += 4) {
      data[index] = adjustChannel(data[index], brightness, contrast);
      data[index + 1] = adjustChannel(data[index + 1], brightness, contrast);
      data[index + 2] = adjustChannel(data[index + 2], brightness, contrast);
    }

    previewContext.putImageData(frame, 0, 0);
  }

  function render() {
    updateControlLabels();

    if (!sourceImage) return;

    drawPreview();
    buildAscii();
  }

  function scheduleRender() {
    updateControlLabels();

    if (!sourceImage) return;
    if (renderFrame) cancelAnimationFrame(renderFrame);

    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      render();
    });
  }

  function loadImage(file) {
    if (!file || !file.type.startsWith('image/')) {
      status.textContent = '請選擇有效的圖片檔案。';
      return;
    }

    if (sourceObjectUrl) {
      URL.revokeObjectURL(sourceObjectUrl);
    }

    sourceObjectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.addEventListener('load', () => {
      sourceImage = image;
      status.textContent =
        `已載入 ${image.naturalWidth} × ${image.naturalHeight}。` +
        ' 調整滑杆會即時重新產生 ASCII。';
      render();
    });

    image.addEventListener('error', () => {
      sourceImage = null;
      currentAscii = '';
      downloadButton.disabled = true;
      asciiSize.textContent = '—';
      asciiOutput.textContent = '圖片讀取失敗。';
      status.textContent = '無法讀取這個圖片檔案。';
    });

    image.src = sourceObjectUrl;
  }

  function resetControls() {
    brightnessInput.value = '0';
    contrastInput.value = '0';
    asciiWidthInput.value = '90';
    characterSetSelect.value = 'dense';
    invertInput.checked = false;
    render();
  }

  function downloadAscii() {
    if (!currentAscii) return;

    const blob = new Blob([currentAscii], {
      type: 'text/plain;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'ascii-art.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  imageInput.addEventListener('change', () => {
    const [file] = imageInput.files || [];
    if (file) loadImage(file);
  });

  brightnessInput.addEventListener('input', scheduleRender);
  contrastInput.addEventListener('input', scheduleRender);
  asciiWidthInput.addEventListener('input', scheduleRender);
  characterSetSelect.addEventListener('change', scheduleRender);
  invertInput.addEventListener('change', scheduleRender);
  resetButton.addEventListener('click', resetControls);
  downloadButton.addEventListener('click', downloadAscii);

  window.addEventListener('beforeunload', () => {
    if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl);
  });

  updateControlLabels();
})();
