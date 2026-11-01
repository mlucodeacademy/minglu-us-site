/**
 * Make Me a Hanzi - Modern Standalone Web App
 * Based on Make Me a Hanzi by Shaunak Kishore (public domain / LGPL)
 */

(() => {
  'use strict';

  // --- Geometry & Matcher Utilities ---
  const util = {
    distance2: (p1, p2) => util.norm2(util.subtract(p1, p2)),
    norm2: (p) => p[0] * p[0] + p[1] * p[1],
    round: (p) => p.map(Math.round),
    subtract: (p1, p2) => [p1[0] - p2[0], p1[1] - p2[1]],
  };

  const coerce = (x, y) => (x == null ? y : x);

  const filterMedian = (median, n) => {
    const result = [];
    let total = 0;
    for (let i = 0; i < median.length - 1; i++) {
      total += Math.sqrt(util.distance2(median[i], median[i + 1]));
    }
    let index = 0;
    let position = median[0];
    let total_so_far = 0;
    for (let i = 0; i < n - 1; i++) {
      const target = (i * total) / (n - 1);
      while (total_so_far < target) {
        const step = Math.sqrt(util.distance2(position, median[index + 1]));
        if (total_so_far + step < target) {
          index += 1;
          position = median[index];
          total_so_far += step;
        } else {
          const t = (target - total_so_far) / step;
          position = [
            (1 - t) * position[0] + t * median[index + 1][0],
            (1 - t) * position[1] + t * median[index + 1][1],
          ];
          total_so_far = target;
        }
      }
      result.push(util.round(position));
    }
    result.push(median[median.length - 1]);
    return result;
  };

  const getAffineTransform = (source, target) => {
    const sdiff = util.subtract(source[1], source[0]);
    const tdiff = util.subtract(target[1], target[0]);
    const ratio = [tdiff[0] / sdiff[0], tdiff[1] / sdiff[1]];
    return (point) => [
      Math.round(ratio[0] * (point[0] - source[0][0]) + target[0][0]),
      Math.round(ratio[1] * (point[1] - source[0][1]) + target[0][1]),
    ];
  };

  const getBounds = (medians) => {
    const min = [Infinity, Infinity];
    const max = [-Infinity, -Infinity];
    medians.forEach((median) => {
      median.forEach((point) => {
        min[0] = Math.min(min[0], point[0]);
        min[1] = Math.min(min[1], point[1]);
        max[0] = Math.max(max[0], point[0]);
        max[1] = Math.max(max[1], point[1]);
      });
    });
    return [min, max];
  };

  const normalizeBounds = (bounds, max_ratio, min_width) => {
    bounds = bounds.map(util.round);
    let diff = util.subtract(bounds[1], bounds[0]);
    if (diff[0] < 0 || diff[1] < 0) return bounds;
    if (diff[0] < min_width) {
      const extra = Math.ceil((min_width - diff[0]) / 2);
      bounds[0][0] -= extra;
      bounds[1][0] += extra;
    }
    if (diff[1] < min_width) {
      const extra = Math.ceil((min_width - diff[1]) / 2);
      bounds[0][1] -= extra;
      bounds[1][1] += extra;
    }
    if (max_ratio > 0) {
      diff = util.subtract(bounds[1], bounds[0]);
      if (diff[0] < diff[1] / max_ratio) {
        const extra = Math.ceil((diff[1] / max_ratio - diff[0]) / 2);
        bounds[0][0] -= extra;
        bounds[1][0] += extra;
      } else if (diff[1] < diff[0] / max_ratio) {
        const extra = Math.ceil((diff[0] / max_ratio - diff[1]) / 2);
        bounds[0][1] -= extra;
        bounds[1][1] += extra;
      }
    }
    return bounds;
  };

  const preprocessMedians = (medians, params) => {
    if (medians.length === 0 || medians.some((m) => m.length === 0)) {
      return [];
    }
    const n = params.side_length;
    const source = normalizeBounds(getBounds(medians), params.max_ratio, params.min_width);
    const target = [[0, 0], [params.side_length - 1, params.side_length - 1]];
    const transform = getAffineTransform(source, target);

    return medians.map((median) => {
      const result = filterMedian(median.map(transform), params.points);
      const diff = util.subtract(result[result.length - 1], result[0]);
      const angle = Math.atan2(diff[1], diff[0]);
      const normalized = Math.round(((angle + Math.PI) * n) / (2 * Math.PI)) % n;
      const length = Math.round(Math.sqrt(util.norm2(diff) / 2));
      return [].concat(...result).concat([normalized, length]);
    });
  };

  const scoreMatch = (source, target, params) => {
    let score = 0;
    const n = params.points;
    for (let i = 0; i < source.length; i++) {
      const m1 = source[i];
      const m2 = target[i];
      for (let j = 0; j < n; j++) {
        score -= Math.abs(m1[2 * j] - m2[2 * j]);
        score -= Math.abs(m1[2 * j + 1] - m2[2 * j + 1]);
      }
      const angle = Math.abs(m1[2 * n] - m2[2 * n]);
      const ratio = (m1[2 * n + 1] + m2[2 * n + 1]) / params.side_length;
      score -= 4 * n * ratio * Math.min(angle, params.side_length - angle);
    }
    return score;
  };

  class Matcher {
    constructor(entries, params) {
      params = params || {};
      params.points = coerce(params.points, 4);
      params.max_ratio = coerce(params.max_ratio, 1);
      params.min_width = coerce(params.min_width, 8);
      params.side_length = coerce(params.side_length, 256);

      this._medians = entries;
      this._params = params;

      // Group entries by stroke count for instant O(1) stroke bucket lookup
      this._byStrokeCount = new Map();
      for (const entry of entries) {
        const strokeCount = entry[1].length;
        if (!this._byStrokeCount.has(strokeCount)) {
          this._byStrokeCount.set(strokeCount, []);
        }
        this._byStrokeCount.get(strokeCount).push(entry);
      }
    }

    match(rawStrokes, n = 8) {
      if (!rawStrokes || rawStrokes.length === 0) return [];
      const medians = preprocessMedians(rawStrokes, this._params);
      if (!medians || medians.length === 0) return [];

      const pool = this._byStrokeCount.get(medians.length) || [];
      const candidates = [];
      const scores = [];

      for (let k = 0; k < pool.length; k++) {
        const entry = pool[k];
        const score = scoreMatch(medians, entry[1], this._params);
        let i = scores.length;
        while (i > 0 && score > scores[i - 1]) {
          i -= 1;
        }
        if (i < n) {
          candidates.splice(i, 0, entry[0]);
          scores.splice(i, 0, score);
          if (candidates.length > n) {
            candidates.pop();
            scores.pop();
          }
        }
      }
      return candidates;
    }
  }

  // --- Binary Medians Loader ---
  const decodeMedian = (buffer, i) => {
    const character = String.fromCodePoint(buffer[i] + (buffer[i + 1] << 8));
    const medians = [];
    const num_medians = buffer[i + 2];
    i += 3;
    for (let j = 0; j < num_medians; j++) {
      const length = buffer[i];
      const median = [];
      for (let k = 0; k < length; k++) {
        median.push(buffer[i + k + 1]);
      }
      medians.push(median);
      i += length + 1;
    }
    return [[character, medians], i];
  };

  async function loadMediansBin(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${url}: ${res.statusText}`);
    const arrayBuffer = await res.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);
    const entries = [];
    let i = 0;
    while (i < buffer.length) {
      const [entry, nextI] = decodeMedian(buffer, i);
      entries.push(entry);
      i = nextI;
    }
    return entries;
  }

  // --- Character Data Partition Loader ---
  const partCache = new Map();

  async function lookupCharacter(char) {
    if (!char) return null;
    const part = Math.floor(char.charCodeAt(0) / 256);
    if (!partCache.has(part)) {
      partCache.set(
        part,
        fetch(`characters/part-${part}.txt`)
          .then((res) => {
            if (!res.ok) throw new Error(`Part ${part} not found`);
            return res.json();
          })
          .catch((err) => {
            console.warn(`Could not load part-${part}.txt:`, err);
            return [];
          })
      );
    }
    const list = await partCache.get(part);
    return list.find((item) => item.character === char) || null;
  }

  // --- Ideographic Description Sequence (IDS) Decomposition Tree ---
  const IDS_DATA = {
    '⿰': { label: 'Left-to-right (左右)', arity: 2 },
    '⿱': { label: 'Top-to-bottom (上下)', arity: 2 },
    '⿴': { label: 'Full surround (全包围)', arity: 2 },
    '⿵': { label: 'Surround-from-above (上三包围)', arity: 2 },
    '⿶': { label: 'Surround-from-below (下三包围)', arity: 2 },
    '⿷': { label: 'Surround-from-left (左三包围)', arity: 2 },
    '⿸': { label: 'Surround-upper-left (左上包围)', arity: 2 },
    '⿹': { label: 'Surround-upper-right (右上包围)', arity: 2 },
    '⿺': { label: 'Surround-lower-left (左下包围)', arity: 2 },
    '⿻': { label: 'Overlaid / embedded (穿插相交)', arity: 2 },
    '⿳': { label: 'Top-mid-bottom (上中下)', arity: 3 },
    '⿲': { label: 'Left-mid-right (左中右)', arity: 3 },
  };

  function parseSubtree(decomposition, index) {
    if (index.val >= decomposition.length) {
      return { type: 'character', value: '?' };
    }
    const current = decomposition[index.val];
    index.val += 1;
    if (IDS_DATA[current]) {
      const result = { type: 'compound', value: current, children: [] };
      for (let i = 0; i < IDS_DATA[current].arity; i++) {
        result.children.push(parseSubtree(decomposition, index));
      }
      return result;
    } else if (current === '？') {
      return { type: 'character', value: '?' };
    }
    // Variant annotations like [1]
    if (decomposition[index.val] === '[') {
      index.val += 3;
    }
    return { type: 'character', value: current };
  }

  function convertDecompositionToTree(decomposition) {
    if (!decomposition) return null;
    const index = { val: 0 };
    return parseSubtree(decomposition, index);
  }

  // --- SVG Stroke Animator ---
  class StrokeAnimator {
    constructor(svgElement, strokes, medians, options = {}) {
      this.svg = svgElement;
      this.strokes = strokes || [];
      this.medians = medians || [];
      this.delay = options.delay || 350; // ms
      this.speed = options.speed || 1.0;
      this.currentStroke = 0;
      this.animating = false;
      this.reqId = null;
      this.onProgress = options.onProgress || (() => {});

      this.initDOM();
    }

    initDOM() {
      // Clear SVG contents except calligraphic grid lines
      this.svg.innerHTML = `
        <defs></defs>
        <!-- Traditional Calligraphy Grid (米字格) -->
        <g class="grid" stroke="rgba(226, 75, 75, 0.28)" stroke-width="2" stroke-dasharray="4,4">
          <rect x="0" y="0" width="1024" height="1024" fill="none" stroke="rgba(226, 75, 75, 0.45)" stroke-width="4" stroke-dasharray="none" />
          <line x1="0" y1="0" x2="1024" y2="1024"></line>
          <line x1="1024" y1="0" x2="0" y2="1024"></line>
          <line x1="512" y1="0" x2="512" y2="1024"></line>
          <line x1="0" y1="512" x2="1024" y2="512"></line>
        </g>
        <!-- Character Glyphs -->
        <g class="character-strokes" transform="scale(1, -1) translate(0, -900)"></g>
      `;

      const defs = this.svg.querySelector('defs');
      const g = this.svg.querySelector('.character-strokes');

      // Create incomplete background outlines and clip paths
      this.strokePaths = [];
      this.clipPaths = [];
      this.animatedPaths = [];

      this.strokes.forEach((d, i) => {
        // Base faint outline path
        const basePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        basePath.setAttribute('d', d);
        basePath.setAttribute('class', 'stroke-base stroke-incomplete');
        g.appendChild(basePath);
        this.strokePaths.push(basePath);

        // Clip path for animation
        const clip = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
        clip.setAttribute('id', `anim_clip_${i}`);
        const clipShape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        clipShape.setAttribute('d', d);
        clip.appendChild(clipShape);
        defs.appendChild(clip);
        this.clipPaths.push(clip);

        // Animated median brush stroke
        const median = this.medians[i] || [];
        const mPathStr = median.length > 0
          ? median.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ')
          : '';
        const animPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        animPath.setAttribute('d', mPathStr);
        animPath.setAttribute('clip-path', `url(#anim_clip_${i})`);
        animPath.setAttribute('class', 'stroke-brush');
        g.appendChild(animPath);
        this.animatedPaths.push(animPath);
      });
    }

    renderUpTo(index) {
      this.currentStroke = Math.max(0, Math.min(index, this.strokes.length));
      this.strokePaths.forEach((path, i) => {
        if (i < this.currentStroke) {
          path.setAttribute('class', 'stroke-base stroke-complete');
        } else {
          path.setAttribute('class', 'stroke-base stroke-incomplete');
        }
      });
      this.animatedPaths.forEach((anim) => {
        anim.style.display = 'none';
      });
      this.onProgress(this.currentStroke, this.strokes.length);
    }

    play() {
      if (this.animating) return;
      this.animating = true;
      if (this.currentStroke >= this.strokes.length) {
        this.currentStroke = 0;
        this.renderUpTo(0);
      }
      this.animateNextStroke();
    }

    pause() {
      this.animating = false;
      if (this.reqId) cancelAnimationFrame(this.reqId);
    }

    animateNextStroke() {
      if (!this.animating) return;
      if (this.currentStroke >= this.strokes.length) {
        this.animating = false;
        this.onProgress(this.strokes.length, this.strokes.length);
        return;
      }

      const i = this.currentStroke;
      const animPath = this.animatedPaths[i];
      const median = this.medians[i];
      if (!median || median.length < 2) {
        // Fallback for missing medians
        this.currentStroke += 1;
        this.renderUpTo(this.currentStroke);
        setTimeout(() => this.animateNextStroke(), this.delay / this.speed);
        return;
      }

      animPath.style.display = 'block';
      let length = 0;
      for (let j = 0; j < median.length - 1; j++) {
        length += Math.hypot(median[j + 1][0] - median[j][0], median[j + 1][1] - median[j][1]);
      }
      const totalLen = length + 128;
      animPath.setAttribute('stroke-dasharray', `${totalLen} ${2 * totalLen}`);
      animPath.setAttribute('stroke-dashoffset', `${totalLen}`);

      let start = null;
      const duration = Math.max(220, (totalLen / 1.1) / this.speed);

      const step = (timestamp) => {
        if (!this.animating) return;
        if (!start) start = timestamp;
        const progress = Math.min((timestamp - start) / duration, 1.0);
        const offset = totalLen * (1 - progress);
        animPath.setAttribute('stroke-dashoffset', `${offset}`);

        if (progress < 1.0) {
          this.reqId = requestAnimationFrame(step);
        } else {
          // Completed this stroke
          animPath.style.display = 'none';
          this.currentStroke += 1;
          this.renderUpTo(this.currentStroke);
          setTimeout(() => {
            if (this.animating) this.animateNextStroke();
          }, this.delay / this.speed);
        }
      };

      this.reqId = requestAnimationFrame(step);
    }

    restart() {
      this.pause();
      this.currentStroke = 0;
      this.renderUpTo(0);
      this.play();
    }

    stepForward() {
      this.pause();
      if (this.currentStroke < this.strokes.length) {
        this.currentStroke += 1;
        this.renderUpTo(this.currentStroke);
      }
    }

    stepBackward() {
      this.pause();
      if (this.currentStroke > 0) {
        this.currentStroke -= 1;
        this.renderUpTo(this.currentStroke);
      }
    }
  }

  // --- Smooth Handwriting Canvas ---
  class HandwritingCanvas {
    constructor(canvas, onStrokesChange) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.onStrokesChange = onStrokesChange || (() => {});
      this.strokes = []; // Array of arrays of [x, y]
      this.currentStroke = [];
      this.isDrawing = false;

      this.setupDPI();
      this.bindEvents();
      this.draw();

      window.addEventListener('resize', () => {
        this.setupDPI();
        this.draw();
      });
    }

    setupDPI() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.width = rect.width;
      this.height = rect.height;
      this.canvas.width = Math.round(rect.width * dpr);
      this.canvas.height = Math.round(rect.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    bindEvents() {
      const getPos = (e) => {
        const rect = this.canvas.getBoundingClientRect();
        return [e.clientX - rect.left, e.clientY - rect.top];
      };

      this.canvas.addEventListener('pointerdown', (e) => {
        this.canvas.setPointerCapture(e.pointerId);
        this.isDrawing = true;
        const p = getPos(e);
        this.currentStroke = [p];
        this.draw();
      });

      this.canvas.addEventListener('pointermove', (e) => {
        if (!this.isDrawing) return;
        const p = getPos(e);
        const last = this.currentStroke[this.currentStroke.length - 1];
        if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 2) {
          this.currentStroke.push(p);
          this.draw();
        }
      });

      const endStroke = (e) => {
        if (!this.isDrawing) return;
        this.isDrawing = false;
        if (this.currentStroke.length > 0) {
          this.strokes.push(this.currentStroke);
          this.currentStroke = [];
          this.draw();
          this.onStrokesChange(this.strokes);
        }
      };

      this.canvas.addEventListener('pointerup', endStroke);
      this.canvas.addEventListener('pointercancel', endStroke);
    }

    clear() {
      this.strokes = [];
      this.currentStroke = [];
      this.draw();
      this.onStrokesChange(this.strokes);
    }

    undo() {
      if (this.strokes.length > 0) {
        this.strokes.pop();
        this.draw();
        this.onStrokesChange(this.strokes);
      }
    }

    draw() {
      const { ctx, width, height } = this;
      ctx.clearRect(0, 0, width, height);

      // Draw traditional calligraphy guide lines (米字格)
      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.28)';
      ctx.setLineDash([4, 4]);

      // Diagonals
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(width, height);
      ctx.moveTo(width, 0);
      ctx.lineTo(0, height);
      // Mid lines
      ctx.moveTo(width / 2, 0);
      ctx.lineTo(width / 2, height);
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();

      // Outer border
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)';
      ctx.strokeRect(0, 0, width, height);
      ctx.restore();

      // Draw all confirmed strokes + current active stroke
      const allStrokes = [...this.strokes];
      if (this.currentStroke.length > 0) {
        allStrokes.push(this.currentStroke);
      }

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = Math.max(6, Math.min(12, width / 45));

      for (const stroke of allStrokes) {
        if (stroke.length === 0) continue;
        ctx.beginPath();
        if (stroke.length === 1) {
          ctx.arc(stroke[0][0], stroke[0][1], ctx.lineWidth / 2, 0, 2 * Math.PI);
          ctx.fillStyle = '#1e293b';
          ctx.fill();
        } else {
          ctx.moveTo(stroke[0][0], stroke[0][1]);
          for (let i = 1; i < stroke.length - 1; i++) {
            const xc = (stroke[i][0] + stroke[i + 1][0]) / 2;
            const yc = (stroke[i][1] + stroke[i + 1][1]) / 2;
            ctx.quadraticCurveTo(stroke[i][0], stroke[i][1], xc, yc);
          }
          const last = stroke[stroke.length - 1];
          ctx.lineTo(last[0], last[1]);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  // --- UI & Application Controller ---
  class MakeAHanziApp {
    constructor() {
      this.matcher = null;
      this.animator = null;
      this.hwCanvas = null;
      this.activeChar = null;

      this.cacheDOM();
      this.bindEvents();
      this.init();
    }

    cacheDOM() {
      // Views
      this.viewSearch = document.getElementById('view-search');
      this.viewCharacter = document.getElementById('view-character');
      this.loadingOverlay = document.getElementById('loading-overlay');

      // Search view elements
      this.canvasEl = document.getElementById('handwriting-canvas');
      this.btnUndo = document.getElementById('btn-undo');
      this.btnClear = document.getElementById('btn-clear');
      this.candidatesContainer = document.getElementById('candidates-list');
      this.strokeCountDisplay = document.getElementById('stroke-count-display');
      this.inputQuickSearch = document.getElementById('input-quick-search');
      this.btnQuickSearch = document.getElementById('btn-quick-search');

      // Character view elements
      this.navBackBtn = document.getElementById('nav-back-btn');
      this.charDisplay = document.getElementById('char-display');
      this.charPinyin = document.getElementById('char-pinyin');
      this.charRadical = document.getElementById('char-radical');
      this.charStrokes = document.getElementById('char-strokes');
      this.charDefinition = document.getElementById('char-definition');
      this.charFormation = document.getElementById('char-formation');
      this.formationContainer = document.getElementById('formation-container');
      this.decompositionTree = document.getElementById('decomposition-tree');
      this.svgOrder = document.getElementById('svg-order');

      // Animator controls
      this.btnPlay = document.getElementById('btn-anim-play');
      this.btnRestart = document.getElementById('btn-anim-restart');
      this.btnPrev = document.getElementById('btn-anim-prev');
      this.btnNext = document.getElementById('btn-anim-next');
      this.speedSelect = document.getElementById('anim-speed');
      this.animStatus = document.getElementById('anim-status');
    }

    bindEvents() {
      // Clear & Undo
      this.btnClear.addEventListener('click', () => this.hwCanvas?.clear());
      this.btnUndo.addEventListener('click', () => this.hwCanvas?.undo());

      // Return to search
      this.navBackBtn.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.hash = '#/';
      });

      // Quick Search input
      const handleQuickSearch = () => {
        const val = this.inputQuickSearch.value.trim();
        if (!val) return;
        // If single Hanzi, jump directly
        if (/[\u3400-\u9FBF]/.test(val)) {
          const char = val.match(/[\u3400-\u9FBF]/)[0];
          window.location.hash = `#/char/${encodeURIComponent(char)}`;
          this.inputQuickSearch.value = '';
        } else {
          // Alert or feedback
          this.searchByKeyword(val);
        }
      };

      this.btnQuickSearch.addEventListener('click', handleQuickSearch);
      this.inputQuickSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleQuickSearch();
      });

      // Animator buttons
      this.btnPlay.addEventListener('click', () => {
        if (!this.animator) return;
        if (this.animator.animating) {
          this.animator.pause();
          this.btnPlay.textContent = '▶ Play';
        } else {
          this.animator.play();
          this.btnPlay.textContent = '⏸ Pause';
        }
      });
      this.btnRestart.addEventListener('click', () => {
        this.animator?.restart();
        this.btnPlay.textContent = '⏸ Pause';
      });
      this.btnPrev.addEventListener('click', () => {
        this.animator?.stepBackward();
        this.btnPlay.textContent = '▶ Play';
      });
      this.btnNext.addEventListener('click', () => {
        this.animator?.stepForward();
        this.btnPlay.textContent = '▶ Play';
      });
      this.speedSelect.addEventListener('change', (e) => {
        if (this.animator) {
          this.animator.speed = parseFloat(e.target.value);
        }
      });

      // Hash Routing
      window.addEventListener('hashchange', () => this.handleRoute());
    }

    async init() {
      // Initialize handwriting canvas
      this.hwCanvas = new HandwritingCanvas(this.canvasEl, (strokes) => {
        this.onStrokesChanged(strokes);
      });

      // Load medians.bin
      try {
        const entries = await loadMediansBin('medians.bin');
        this.matcher = new Matcher(entries);
        this.loadingOverlay.classList.add('hidden');
        console.log(`Loaded ${entries.length} characters in stroke matcher.`);
      } catch (err) {
        console.error('Failed to load medians.bin:', err);
        this.loadingOverlay.innerHTML = `
          <div class="error-box">
            <h3>Failed to load dictionary index</h3>
            <p>${err.message}</p>
          </div>
        `;
        return;
      }

      // Initial route
      this.handleRoute();
    }

    onStrokesChanged(strokes) {
      this.strokeCountDisplay.textContent = `${strokes.length} stroke${strokes.length === 1 ? '' : 's'}`;
      if (!this.matcher || strokes.length === 0) {
        this.candidatesContainer.innerHTML = `<span class="empty-hint">Draw a Chinese character stroke by stroke above</span>`;
        return;
      }

      const matches = this.matcher.match(strokes, 12);
      if (matches.length === 0) {
        this.candidatesContainer.innerHTML = `<span class="empty-hint">No matches with ${strokes.length} strokes. Try drawing the next stroke or click Undo.</span>`;
        return;
      }

      this.candidatesContainer.innerHTML = '';
      matches.forEach((char) => {
        const a = document.createElement('a');
        a.className = 'candidate-card';
        a.href = `#/char/${encodeURIComponent(char)}`;
        a.textContent = char;
        a.title = `Inspect ${char}`;
        this.candidatesContainer.appendChild(a);
      });
    }

    async searchByKeyword(keyword) {
      // Provide instant feedback or jump to matching character
      this.loadingOverlay.classList.remove('hidden');
      this.loadingOverlay.querySelector('.loading-text').textContent = `Searching for "${keyword}"...`;

      // Search across a few common part files or test if codepoint
      let found = null;
      for (let part = 78; part <= 159; part++) {
        const list = await fetch(`characters/part-${part}.txt`)
          .then((r) => r.json())
          .catch(() => []);
        const match = list.find(
          (item) =>
            item.character === keyword ||
            (item.pinyin && item.pinyin.some((p) => p.toLowerCase().includes(keyword.toLowerCase()))) ||
            (item.definition && item.definition.toLowerCase().includes(keyword.toLowerCase()))
        );
        if (match) {
          found = match.character;
          break;
        }
      }

      this.loadingOverlay.classList.add('hidden');
      if (found) {
        window.location.hash = `#/char/${encodeURIComponent(found)}`;
      } else {
        alert(`No character found matching "${keyword}". Try drawing it on the canvas!`);
      }
    }

    handleRoute() {
      const hash = window.location.hash || '#/';
      if (hash.startsWith('#/char/') || hash.startsWith('#/codepoint/')) {
        let char = '';
        if (hash.startsWith('#/char/')) {
          char = decodeURIComponent(hash.slice(7));
        } else {
          const cp = parseInt(hash.slice(12), 10);
          char = String.fromCodePoint(cp);
        }
        this.showCharacterView(char);
      } else {
        this.showSearchView();
      }
    }

    showSearchView() {
      this.viewCharacter.classList.add('hidden');
      this.viewSearch.classList.remove('hidden');
      this.navBackBtn.classList.add('hidden');
      if (this.animator) {
        this.animator.pause();
      }
      // Re-trigger layout on canvas
      setTimeout(() => this.hwCanvas?.setupDPI(), 50);
    }

    async showCharacterView(char) {
      this.viewSearch.classList.add('hidden');
      this.viewCharacter.classList.remove('hidden');
      this.navBackBtn.classList.remove('hidden');

      this.charDisplay.textContent = char;
      this.charPinyin.textContent = '...';
      this.charRadical.textContent = '...';
      this.charStrokes.textContent = '...';
      this.charDefinition.textContent = 'Loading character data...';
      this.decompositionTree.innerHTML = 'Loading...';

      const data = await lookupCharacter(char);
      if (!data) {
        this.charDefinition.textContent = 'Character data not found in Make Me a Hanzi database.';
        this.decompositionTree.innerHTML = '';
        return;
      }

      // Populate Metadata
      this.charPinyin.textContent = (data.pinyin || []).join(', ') || '(unknown)';
      this.charRadical.textContent = data.radical || '-';
      this.charStrokes.textContent = `${data.strokes ? data.strokes.length : 0} strokes`;
      this.charDefinition.textContent = data.definition || '(no definition available)';

      // Etymology
      if (data.etymology) {
        this.formationContainer.classList.remove('hidden');
        let formationText = `<strong>${data.etymology.type}</strong>`;
        if (data.etymology.type === 'pictophonetic') {
          formationText += `: Semantic <em>${data.etymology.semantic || '?'}</em> (${data.etymology.hint || ''}) gives meaning, phonetic <em>${data.etymology.phonetic || '?'}</em> gives sound.`;
        } else if (data.etymology.hint) {
          formationText += `: ${data.etymology.hint}`;
        }
        this.charFormation.innerHTML = this.linkifyHanzi(formationText);
      } else {
        this.formationContainer.classList.add('hidden');
      }

      // Decomposition Tree
      this.renderDecomposition(data);

      // Stroke Animation
      if (data.strokes && data.medians) {
        this.animator = new StrokeAnimator(this.svgOrder, data.strokes, data.medians, {
          delay: 350,
          speed: parseFloat(this.speedSelect.value) || 1.0,
          onProgress: (current, total) => {
            this.animStatus.textContent = `${current} / ${total} strokes`;
            if (current >= total) {
              this.btnPlay.textContent = '▶ Replay';
            }
          },
        });
        this.animator.play();
        this.btnPlay.textContent = '⏸ Pause';
      }
    }

    renderDecomposition(data) {
      if (!data.decomposition) {
        this.decompositionTree.innerHTML = '<span class="empty-hint">None</span>';
        return;
      }

      const tree = convertDecompositionToTree(data.decomposition);
      this.decompositionTree.innerHTML = '';
      this.decompositionTree.appendChild(this.buildTreeDOM(tree, data.dependencies || {}));
    }

    buildTreeDOM(node, dependencies) {
      const container = document.createElement('div');
      container.className = 'tree-node';

      const tag = document.createElement('div');
      tag.className = 'node-badge';

      if (node.type === 'compound') {
        const meta = IDS_DATA[node.value] || { label: node.value };
        tag.classList.add('badge-compound');
        tag.innerHTML = `<span class="ids-symbol">${node.value}</span> <span class="ids-label">${meta.label}</span>`;
        container.appendChild(tag);

        if (node.children && node.children.length > 0) {
          const childrenWrapper = document.createElement('div');
          childrenWrapper.className = 'tree-children';
          node.children.forEach((child) => {
            childrenWrapper.appendChild(this.buildTreeDOM(child, dependencies));
          });
          container.appendChild(childrenWrapper);
        }
      } else {
        tag.classList.add('badge-char');
        const char = node.value;
        const gloss = dependencies[char] || '';
        tag.innerHTML = `<a href="#/char/${encodeURIComponent(char)}" class="char-link">${char}</a> ${gloss ? `<span class="gloss-text">${gloss}</span>` : ''}`;
        container.appendChild(tag);
      }

      return container;
    }

    linkifyHanzi(str) {
      return str.replace(/[\u3400-\u9FBF]/g, (match) => {
        return `<a href="#/char/${encodeURIComponent(match)}" class="inline-char-link">${match}</a>`;
      });
    }
  }

  // Launch when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    new MakeAHanziApp();
  });
})();
