/**
 * Webcam "look" filter (one GPU pass):
 *  1. Skin smoothing: an edge-preserving average (neighbours of similar colour
 *     count more), applied only where the colour is in the skin-tone range, so
 *     eyes, eyebrows, hair and edges stay sharp.
 *  2. Face brightening (skin tones only) and sharpening (unsharp mask).
 *  3. Colour grade: brightness, contrast, saturation, warmth, tint, sepia, fade.
 *  4. Vignette.
 * Parameters come from resolveGrade() (presets + sliders), see shared/effects/webcamStyle.ts.
 */
import { defaultFilterVert, Filter, GlProgram } from "pixi.js";
import type { Grade } from "@shared/effects/webcamStyle";

const fragment = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform float uSmooth;
uniform float uBrighten;
uniform float uSharpen;
uniform float uBrightness;
uniform float uContrast;
uniform float uSaturation;
uniform float uTemperature;
uniform float uTint;
uniform float uSepia;
uniform float uFade;
uniform float uVignette;
uniform float uRadius;

vec3 unpremul(vec4 c) { return c.a > 0.0 ? c.rgb / c.a : vec3(0.0); }

/* 0..1: how much this colour looks like skin (YCbCr range, soft edges). */
float skin(vec3 c) {
  float y  = dot(c, vec3(0.299, 0.587, 0.114));
  float cb = 0.5 - 0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b;
  float cr = 0.5 + 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b;
  float m = smoothstep(0.28, 0.31, cb) * (1.0 - smoothstep(0.49, 0.52, cb))
          * smoothstep(0.51, 0.54, cr) * (1.0 - smoothstep(0.67, 0.70, cr));
  return m * smoothstep(0.12, 0.2, y);
}

void main(void) {
  vec4 src = texture(uTexture, vTextureCoord);
  vec3 c = unpremul(src);
  vec2 px = uInputSize.zw;

  // 1. Edge-preserving smoothing on two rings of 8 samples.
  if (uSmooth > 0.001 || uSharpen > 0.001) {
    vec3 sum = c;
    float wsum = 1.0;
    vec3 blur = c;
    for (int ring = 1; ring <= 2; ring++) {
      float r = uRadius * float(ring);
      for (int i = 0; i < 8; i++) {
        float a = 6.2831853 * float(i) / 8.0 + float(ring) * 0.39;
        vec3 n = unpremul(texture(uTexture, vTextureCoord + vec2(cos(a), sin(a)) * px * r));
        vec3 d = n - c;
        float w = exp(-dot(d, d) * 60.0);
        sum += n * w;
        wsum += w;
        blur += n;
      }
    }
    vec3 smoothC = sum / wsum;
    blur /= 17.0;
    c = mix(c, smoothC, uSmooth * skin(c));
    // 2b. Unsharp mask (detail back), not on skin when smoothing.
    c += (c - blur) * uSharpen * 1.5 * (1.0 - 0.7 * uSmooth * skin(c));
  }

  // 2a. Brighten faces.
  c += uBrighten * 0.18 * skin(c) * (1.0 - c);

  // 3. Grade.
  c += uBrightness * 0.25;
  c = (c - 0.5) * (1.0 + uContrast) + 0.5;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.0 + uSaturation);
  c += vec3(uTemperature * 0.08, uTint * -0.06, -uTemperature * 0.08);
  c.rb += uTint * 0.04;
  vec3 sep = vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131)));
  c = mix(c, sep, uSepia);
  c = mix(c, c * 0.85 + 0.12, uFade);

  // 4. Vignette (position inside the webcam picture).
  vec2 uv = vTextureCoord * uInputSize.xy / uOutputFrame.zw;
  float v = smoothstep(0.85, 0.25, length(uv - 0.5) * 1.3);
  c *= mix(1.0, v, uVignette);

  c = clamp(c, 0.0, 1.0);
  finalColor = vec4(c * src.a, src.a);
}
`;

export class LookFilter extends Filter {
  constructor() {
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: "tdr-webcam-look" }),
      resources: {
        lookUniforms: {
          uSmooth: { value: 0, type: "f32" },
          uBrighten: { value: 0, type: "f32" },
          uSharpen: { value: 0, type: "f32" },
          uBrightness: { value: 0, type: "f32" },
          uContrast: { value: 0, type: "f32" },
          uSaturation: { value: 0, type: "f32" },
          uTemperature: { value: 0, type: "f32" },
          uTint: { value: 0, type: "f32" },
          uSepia: { value: 0, type: "f32" },
          uFade: { value: 0, type: "f32" },
          uVignette: { value: 0, type: "f32" },
          uRadius: { value: 2, type: "f32" },
        },
      },
    });
  }

  /** radiusPx: smoothing reach in texture pixels (scaled with the webcam's resolution). */
  set(beauty: { smooth: number; brighten: number; sharpen: number }, g: Grade, radiusPx: number): this {
    const u = this.resources.lookUniforms.uniforms;
    u.uSmooth = beauty.smooth;
    u.uBrighten = beauty.brighten;
    u.uSharpen = beauty.sharpen;
    u.uBrightness = g.brightness;
    u.uContrast = g.contrast;
    u.uSaturation = g.saturation;
    u.uTemperature = g.temperature;
    u.uTint = g.tint;
    u.uSepia = g.sepia;
    u.uFade = g.fade;
    u.uVignette = g.vignette;
    u.uRadius = radiusPx;
    return this;
  }
}

/** True when the look changes nothing (the filter is skipped entirely). */
export const isNeutralLook = (beauty: { smooth: number; brighten: number; sharpen: number }, g: Grade): boolean =>
  beauty.smooth === 0 && beauty.brighten === 0 && beauty.sharpen === 0 && Object.values(g).every((v) => v === 0);
