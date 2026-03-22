/**
 * Node.js / Vercel サーバーレス環境用ポリフィル
 * pdfjs-dist が DOMMatrix を要求するが、Node.js には存在しない
 */

if (typeof globalThis.DOMMatrix === "undefined") {
  // @ts-expect-error Minimal DOMMatrix polyfill for pdfjs-dist text extraction
  globalThis.DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    m11 = 1; m12 = 0; m13 = 0; m14 = 0;
    m21 = 0; m22 = 1; m23 = 0; m24 = 0;
    m31 = 0; m32 = 0; m33 = 1; m34 = 0;
    m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    is2D = true;
    isIdentity = true;

    constructor(init?: string | number[]) {
      if (Array.isArray(init) && init.length === 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
        this.m11 = this.a; this.m12 = this.b;
        this.m21 = this.c; this.m22 = this.d;
        this.m41 = this.e; this.m42 = this.f;
      }
    }

    multiply() { return new DOMMatrix(); }
    inverse() { return new DOMMatrix(); }
    translate() { return new DOMMatrix(); }
    scale() { return new DOMMatrix(); }
    rotate() { return new DOMMatrix(); }
    transformPoint(p: Record<string, number>) { return p; }
    toFloat32Array() { return new Float32Array(16); }
    toFloat64Array() { return new Float64Array(16); }
  };
}

if (typeof globalThis.Path2D === "undefined") {
  // @ts-expect-error Minimal Path2D stub
  globalThis.Path2D = class Path2D {
    moveTo() {}
    lineTo() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
    arc() {}
    closePath() {}
    rect() {}
  };
}
