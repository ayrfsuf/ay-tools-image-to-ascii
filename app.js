(() => {
  const $ = (id) => document.getElementById(id);

  const refs = {
    fileInput: $('fileInput'),
    widthInput: $('widthInput'),
    aspectInput: $('aspectInput'),
    brightnessInput: $('brightnessInput'),
    contrastInput: $('contrastInput'),
    gammaInput: $('gammaInput'),
    blackPointInput: $('blackPointInput'),
    whitePointInput: $('whitePointInput'),
    detailInput: $('detailInput'),
    rampSelect: $('rampSelect'),
    fullwidthInput: $('fullwidthInput'),
    invertInput: $('invertInput'),
    autoButton: $('autoButton'),
    resetButton: $('resetButton'),
    copyButton: $('copyButton'),
    downloadButton: $('downloadButton'),
    asciiOutput: $('asciiOutput'),
    previewCanvas: $('previewCanvas'),
    workCanvas: $('workCanvas'),
    statusText: $('statusText'),
    sizeText: $('sizeText'),
    widthValue: $('widthValue'),
    aspectValue: $('aspectValue'),
    brightnessValue: $('brightnessValue'),
    contrastValue: $('contrastValue'),
    gammaValue: $('gammaValue'),
    blackPointValue: $('blackPointValue'),
    whitePointValue: $('whitePointValue'),
    detailValue: $('detailValue')
  };

  const workCtx = refs.workCanvas.getContext('2d', { willReadFrequently: true });
  const previewCtx = refs.previewCanvas.getContext('2d', { willReadFrequently: true });

  const rampPresets = {
    dense: {
      chars: ['@', '%', '#', '*', '+', '=', '-', ':', '.', ' '],
      densities: [0.95, 0.86, 0.76, 0.62, 0.51, 0.41, 0.27, 0.16, 0.08, 0.00]
    },
    classic: {
      chars: ['@', '#', 'S', '%', '?', '*', '+', ';', ':', ',', '.', ' '],
      densities: [0.95, 0.88, 0.82, 0.73, 0.66, 0.57, 0.48, 0.30, 0.20, 0.12, 0.06, 0.00]
    },
    blocks: {
      chars: ['█', '▓', '▒', '░', ' '],
      densities: [1.00, 0.78, 0.52, 0.25, 0.00]
    },
    simple: {
      chars: ['#', '*', ':', '.', ' '],
      densities: [0.90, 0.60, 0.24, 0.08, 0.00]
    }
  };

  const fullwidthMap = {
    '@': '＠', '%': '％', '#': '＃', '*': '＊', '+': '＋', '=': '＝', '-': '－', ':': '：', '.': '．', ' ': '　',
    'S': 'Ｓ', '?': '？', ';': '；', ',': '，', '█': '█', '▓': '▓', '▒': '▒', '░': '░'
  };

  const defaultState = {
    width: 72,
    aspect: 0.50,
    brightness: 0,
    contrast: 0,
    gamma: 1.00,
    blackPoint: 0,
    whitePoint: 255,
    detail: 0,
    ramp: 'dense',
    fullwidth: true,
    invert: false
  };

  let sourceImage = null;
  let currentText = '';
  let rafPending = false;
  let objectUrl = null;

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function updateUiLabels() {
    refs.widthValue.textContent = refs.widthInput.value;
    refs.aspectValue.textContent = Number(refs.aspectInput.value).toFixed(2);
    refs.brightnessValue.textContent = formatSigned(refs.brightnessInput.value);
    refs.contrastValue.textContent = formatSigned(refs.contrastInput.value);
    refs.gammaValue.textContent = Number(refs.gammaInput.value).toFixed(2);
    refs.blackPointValue.textContent = refs.blackPointInput.value;
    refs.whitePointValue.textContent = refs.whitePointInput.value;
    refs.detailValue.textContent = refs.detailInput.value;
  }

  function formatSigned(value) {
    const n = Number(value);
    return n > 0 ? `+${n}` : `${n}`;
  }

  function buildRamp() {
    const preset = rampPresets[refs.rampSelect.value] || rampPresets.dense;
    const chars = preset.chars.map((char) => refs.fullwidthInput.checked ? (fullwidthMap[char] || char) : char);
    return chars.map((char, idx) => ({ char, density: preset.densities[idx] }));
  }

  function adjustRgbToGray(r, g, b, brightness, contrast, blackPoint, whitePoint, gamma) {
    const shift = brightness * 2.55;
    const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    const rr = clamp(contrastFactor * (r + shift - 128) + 128, 0, 255);
    const gg = clamp(contrastFactor * (g + shift - 128) + 128, 0, 255);
    const bb = clamp(contrastFactor * (b + shift - 128) + 128, 0, 255);
    const grayRaw = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
    const white = Math.max(blackPoint + 1, whitePoint);
    let normalized = (grayRaw - blackPoint) / (white - blackPoint);
    normalized = clamp(normalized, 0, 1);
    normalized = Math.pow(normalized, 1 / gamma);
    return clamp(normalized, 0, 1);
  }

  function computeEdgeMap(grayMap, width, height) {
    const edges = new Float32Array(grayMap.length);
    let maxMag = 0;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const tl = grayMap[i - width - 1], tc = grayMap[i - width], tr = grayMap[i - width + 1];
        const ml = grayMap[i - 1], mr = grayMap[i + 1];
        const bl = grayMap[i + width - 1], bc = grayMap[i + width], br = grayMap[i + width + 1];

        const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
        const gy = tl + 2 * tc + tr - bl - 2 * bc - br;
        const mag = Math.sqrt(gx * gx + gy * gy);
        edges[i] = mag;
        if (mag > maxMag) maxMag = mag;
      }
    }

    if (maxMag > 0) {
      for (let i = 0; i < edges.length; i++) {
        edges[i] = clamp(edges[i] / maxMag, 0, 1);
      }
    }

    return edges;
  }

  function chooseGlyph(darkness, ramp) {
    let best = ramp[0].char;
    let bestDistance = Infinity;
    for (let i = 0; i < ramp.length; i++) {
      const distance = Math.abs(ramp[i].density - darkness);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = ramp[i].char;
      }
    }
    return best;
  }

  function buildProcessedGrayMap(ctx, width, height, settings) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const grayMap = new Float32Array(width * height);

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const alpha = data[i + 3] / 255;
      grayMap[p] = alpha < 0.05
        ? 1
        : adjustRgbToGray(
            data[i], data[i + 1], data[i + 2],
            settings.brightness,
            settings.contrast,
            settings.blackPoint,
            settings.whitePoint,
            settings.gamma
          );
    }

    if (settings.detail > 0) {
      const strength = settings.detail / 100;
      const edges = computeEdgeMap(grayMap, width, height);
      for (let i = 0; i < grayMap.length; i++) {
        grayMap[i] = clamp(grayMap[i] - edges[i] * strength * 0.60, 0, 1);
      }
    }

    return grayMap;
  }

  function drawPreview(settings) {
    const maxSize = 420;
    const scale = Math.min(1, maxSize / Math.max(sourceImage.naturalWidth, sourceImage.naturalHeight));
    const width = Math.max(1, Math.round(sourceImage.naturalWidth * scale));
    const height = Math.max(1, Math.round(sourceImage.naturalHeight * scale));
    refs.previewCanvas.width = width;
    refs.previewCanvas.height = height;
    previewCtx.clearRect(0, 0, width, height);
    previewCtx.drawImage(sourceImage, 0, 0, width, height);

    const grayMap = buildProcessedGrayMap(previewCtx, width, height, settings);
    const previewFrame = previewCtx.createImageData(width, height);

    for (let i = 0; i < grayMap.length; i++) {
      const v = Math.round(grayMap[i] * 255);
      const o = i * 4;
      previewFrame.data[o] = v;
      previewFrame.data[o + 1] = v;
      previewFrame.data[o + 2] = v;
      previewFrame.data[o + 3] = 255;
    }

    previewCtx.putImageData(previewFrame, 0, 0);
  }

  function getSettings() {
    const blackPoint = Number(refs.blackPointInput.value);
    const whitePointRaw = Number(refs.whitePointInput.value);
    const whitePoint = Math.max(blackPoint + 1, whitePointRaw);
    if (whitePoint !== whitePointRaw) {
      refs.whitePointInput.value = String(whitePoint);
    }

    return {
      width: Number(refs.widthInput.value),
      aspect: Number(refs.aspectInput.value),
      brightness: Number(refs.brightnessInput.value),
      contrast: Number(refs.contrastInput.value),
      gamma: Number(refs.gammaInput.value),
      blackPoint,
      whitePoint,
      detail: Number(refs.detailInput.value)
    };
  }

  function render() {
    updateUiLabels();
    if (!sourceImage) return;

    const settings = getSettings();
    const cols = clamp(settings.width, 20, 220);
    const aspect = sourceImage.naturalHeight / sourceImage.naturalWidth;
    const rows = clamp(Math.round(cols * aspect * settings.aspect), 1, 400);
    refs.workCanvas.width = cols;
    refs.workCanvas.height = rows;
    workCtx.clearRect(0, 0, cols, rows);
    workCtx.drawImage(sourceImage, 0, 0, cols, rows);

    const grayMap = buildProcessedGrayMap(workCtx, cols, rows, settings);
    const ramp = buildRamp();
    const lines = [];

    for (let y = 0; y < rows; y++) {
      let line = '';
      for (let x = 0; x < cols; x++) {
        const gray = grayMap[y * cols + x];
        const darkness = refs.invertInput.checked ? gray : 1 - gray;
        line += chooseGlyph(darkness, ramp);
      }
      lines.push(line);
    }

    currentText = lines.join('\n');
    refs.asciiOutput.textContent = currentText || '';
    refs.sizeText.textContent = `${cols} × ${rows} 字符`;
    refs.statusText.textContent = `${sourceImage.naturalWidth} × ${sourceImage.naturalHeight}`;
    refs.copyButton.disabled = !currentText;
    refs.downloadButton.disabled = !currentText;

    drawPreview(settings);
  }

  function scheduleRender() {
    updateUiLabels();
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      render();
    });
  }

  function applyDefaults() {
    refs.widthInput.value = String(defaultState.width);
    refs.aspectInput.value = String(defaultState.aspect);
    refs.brightnessInput.value = String(defaultState.brightness);
    refs.contrastInput.value = String(defaultState.contrast);
    refs.gammaInput.value = defaultState.gamma.toFixed(2);
    refs.blackPointInput.value = String(defaultState.blackPoint);
    refs.whitePointInput.value = String(defaultState.whitePoint);
    refs.detailInput.value = String(defaultState.detail);
    refs.rampSelect.value = defaultState.ramp;
    refs.fullwidthInput.checked = defaultState.fullwidth;
    refs.invertInput.checked = defaultState.invert;
    updateUiLabels();
  }

  function loadImage(file) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      sourceImage = img;
      scheduleRender();
    };
    img.onerror = () => {
      refs.statusText.textContent = '圖片讀取失敗';
    };
    img.src = objectUrl;
  }

  function autoOptimize() {
    if (!sourceImage) return;
    const sampleWidth = 220;
    const sampleHeight = Math.max(1, Math.round(sampleWidth * (sourceImage.naturalHeight / sourceImage.naturalWidth)));
    refs.workCanvas.width = sampleWidth;
    refs.workCanvas.height = sampleHeight;
    workCtx.clearRect(0, 0, sampleWidth, sampleHeight);
    workCtx.drawImage(sourceImage, 0, 0, sampleWidth, sampleHeight);
    const frame = workCtx.getImageData(0, 0, sampleWidth, sampleHeight).data;

    const values = [];
    for (let i = 0; i < frame.length; i += 4) {
      const alpha = frame[i + 3] / 255;
      if (alpha < 0.05) continue;
      const gray = 0.2126 * frame[i] + 0.7152 * frame[i + 1] + 0.0722 * frame[i + 2];
      values.push(gray);
    }

    if (!values.length) return;
    values.sort((a, b) => a - b);
    const q = (p) => values[Math.min(values.length - 1, Math.max(0, Math.floor(values.length * p)))];

    const black = Math.round(q(0.02));
    const white = Math.round(q(0.98));
    const median = clamp((q(0.50) - black) / Math.max(1, white - black), 0.05, 0.95);
    const gamma = clamp(Math.log(median) / Math.log(0.5), 0.40, 2.50);

    refs.blackPointInput.value = String(black);
    refs.whitePointInput.value = String(Math.max(black + 1, white));
    refs.gammaInput.value = gamma.toFixed(2);
    scheduleRender();
  }

  async function copyOutput() {
    if (!currentText) return;
    try {
      await navigator.clipboard.writeText(currentText);
      refs.statusText.textContent = '已複製 ASCII 文字';
    } catch {
      refs.statusText.textContent = '複製失敗';
    }
  }

  function downloadOutput() {
    if (!currentText) return;
    const blob = new Blob([currentText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ascii-art.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  refs.fileInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      refs.statusText.textContent = '請選擇有效的圖片';
      return;
    }
    loadImage(file);
  });

  [
    refs.widthInput,
    refs.aspectInput,
    refs.brightnessInput,
    refs.contrastInput,
    refs.gammaInput,
    refs.blackPointInput,
    refs.whitePointInput,
    refs.detailInput,
    refs.rampSelect,
    refs.fullwidthInput,
    refs.invertInput
  ].forEach((element) => {
    element.addEventListener('input', scheduleRender);
    element.addEventListener('change', scheduleRender);
  });

  refs.autoButton.addEventListener('click', autoOptimize);
  refs.resetButton.addEventListener('click', () => {
    applyDefaults();
    scheduleRender();
  });
  refs.copyButton.addEventListener('click', copyOutput);
  refs.downloadButton.addEventListener('click', downloadOutput);

  applyDefaults();
})();
