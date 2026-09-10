// Just enough of the DOM for terrain.js to run under Node.
//
// The balance harness only cares about the collision mask, never the painted
// texture, so every 2D context call is a no-op and getImageData hands back a
// correctly sized zero buffer. If Terrain ever starts making decisions from
// pixel data this shim has to grow teeth.

class FakeImageData {
  constructor(w, h) {
    this.width = w;
    this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
}

const NOOP = () => {};

function fakeContext(canvas) {
  const ctx = {
    canvas,
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    imageSmoothingEnabled: false,
    createImageData: (w, h) => new FakeImageData(w, h),
    getImageData: (x, y, w, h) => new FakeImageData(Math.max(1, w | 0), Math.max(1, h | 0)),
    putImageData: NOOP,
    createPattern: () => ({}),
    createLinearGradient: () => ({ addColorStop: NOOP }),
    createRadialGradient: () => ({ addColorStop: NOOP }),
  };
  for (const m of ['save', 'restore', 'translate', 'scale', 'rotate', 'beginPath',
    'closePath', 'moveTo', 'lineTo', 'arc', 'ellipse', 'fill', 'stroke', 'clip',
    'fillRect', 'strokeRect', 'clearRect', 'drawImage', 'setLineDash', 'fillText',
    'measureText', 'setTransform', 'rect']) {
    ctx[m] = m === 'measureText' ? (() => ({ width: 0 })) : NOOP;
  }
  return ctx;
}

export function installDomShim() {
  if (globalThis.document) return;
  globalThis.document = {
    createElement(tag) {
      if (tag !== 'canvas') return {};
      const cv = { width: 0, height: 0, tagName: 'CANVAS' };
      cv.getContext = () => fakeContext(cv);
      return cv;
    },
  };
  globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
  globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');
}
