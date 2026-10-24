// Copies the licence texts of every third-party package that ends up in the app
// (shipped in node_modules or bundled into the app code) to resources/licenses/,
// plus docs/THIRD_PARTY.md. Runs before every installer build.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
// Shipped at runtime + bundled into the renderer.
const bundled = ["@breezystack/lamejs", "@fontsource/noto-serif-tibetan", "@fontsource/jomolhari", "@fontsource/uchen", "@fontsource/inter", "@fontsource/roboto", "@fontsource/open-sans", "@fontsource/montserrat", "@fontsource/lato", "@fontsource/poppins", "@fontsource/noto-sans", "@fontsource/noto-serif", "@fontsource/merriweather", "@fontsource/playfair-display", "@fontsource/oswald", "@fontsource/raleway", "@fontsource/bebas-neue", "@fontsource/lobster", "@fontsource/pacifico", "@fontsource/dancing-script", "@fontsource/caveat", "@fontsource/source-code-pro", "gifenc", "mp4-muxer", "pixi.js", "react", "react-dom", "webm-muxer", "zustand", "scheduler"];
// Follow each package's own runtime dependencies (e.g. PixiJS → earcut, eventemitter3).
const seen = new Set();
const walk = (name) => {
  if (seen.has(name)) return;
  const file = join("node_modules", name, "package.json");
  if (!existsSync(file)) return;
  seen.add(name);
  for (const dep of Object.keys(JSON.parse(readFileSync(file, "utf8")).dependencies ?? {})) walk(dep);
};
[...Object.keys(pkg.dependencies ?? {}), ...bundled].forEach(walk);
const names = [...seen].sort();
const out = "resources/licenses";
const MIT = (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const missing = [];
const rows = [];
for (const name of names) {
  const dir = join("node_modules", name);
  if (!existsSync(dir)) continue;
  const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.md|\.txt)?$/i.test(f));
  const target = `${name.replace("/", "__")}-${meta.version}.txt`;
  if (file) copyFileSync(join(dir, file), join(out, target));
  else if (meta.license === "MIT") {
    // MIT requires the notice to travel with the code; some packages omit the file.
    const author = typeof meta.author === "string" ? meta.author : meta.author?.name ?? name;
    writeFileSync(join(out, target), MIT(author));
  } else missing.push(name);
  rows.push(`${name} ${meta.version} — ${typeof meta.license === "string" ? meta.license : JSON.stringify(meta.license)} (${target})`);
}
copyFileSync("docs/THIRD_PARTY.md", join(out, "THIRD_PARTY.md"));
writeFileSync(join(out, "README.txt"), "Third-party components in Nangchen T. Studio Screen Recorder\n\n" + rows.join("\n") + "\n");
console.log(`licences: ${rows.length} packages${missing.length ? `; no licence file: ${missing.join(", ")}` : ""}`);
