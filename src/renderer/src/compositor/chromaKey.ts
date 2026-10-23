/**
 * Green-screen (chroma key) filter for the webcam: pixels whose chroma (CbCr)
 * is close to the key color become transparent, with a soft edge and spill
 * suppression (the key color's tint is pulled out of the remaining edges).
 */
import { defaultFilterVert, Filter, GlProgram } from "pixi.js";

const fragment = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec3 uKey;
uniform float uSimilarity;
uniform float uSmoothness;
uniform float uSpill;

vec2 chroma(vec3 c) {
  return vec2(
    -0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b,
     0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b);
}

void main(void) {
  vec4 src = texture(uTexture, vTextureCoord);
  vec3 rgb = src.a > 0.0 ? src.rgb / src.a : vec3(0.0);
  float d = distance(chroma(rgb), chroma(uKey));
  float alpha = smoothstep(uSimilarity * 0.5, uSimilarity * 0.5 + uSmoothness, d);
  // Spill: desaturate pixels that still lean toward the key color.
  float spill = pow(clamp(1.0 - d / max(uSimilarity, 0.001), 0.0, 1.0), 1.5) * uSpill;
  float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = mix(rgb, vec3(luma), spill);
  float a = src.a * alpha;
  finalColor = vec4(rgb * a, a);
}
`;

export interface ChromaSettings {
  color: string;
  similarity: number;
  smoothness: number;
  spill: number;
}

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
};

export class ChromaKeyFilter extends Filter {
  constructor() {
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: "tdr-chroma-key" }),
      resources: {
        chromaUniforms: {
          uKey: { value: new Float32Array([0, 1, 0]), type: "vec3<f32>" },
          uSimilarity: { value: 0.4, type: "f32" },
          uSmoothness: { value: 0.08, type: "f32" },
          uSpill: { value: 0.3, type: "f32" },
        },
      },
    });
  }

  set(s: ChromaSettings): this {
    const u = this.resources.chromaUniforms.uniforms;
    u.uKey = new Float32Array(hexToRgb(s.color));
    u.uSimilarity = s.similarity;
    u.uSmoothness = s.smoothness;
    u.uSpill = s.spill;
    return this;
  }
}
