# Third-party components

| Package | Version | Licence | Used for |
|---|---|---|---|
| mp4-muxer | 5.2.2 | MIT | Writing MP4/M4A files (final release; superseded upstream by Mediabunny) |
| webm-muxer | 5.1.4 | MIT | Writing WebM files (final release; superseded upstream by Mediabunny) |
| gifenc | 1.0.3 | MIT | GIF palette quantisation and encoding |
| @breezystack/lamejs | 1.2.7 | LGPL-3.0 | MP3 encoding |
| pixi.js | 8.22.0 | MIT | Compositor |
| React 19.3.1, zustand 5.0.15, zod 4.6.7 | | MIT | UI, state, validation |
| @fontsource/noto-serif-tibetan | 5.3.0 | OFL-1.1 | Tibetan font |
| @fontsource/jomolhari | 5.3.0 | OFL-1.1 | Tibetan font (Jomolhari, by Christopher J. Fynn) |
| @fontsource/uchen | 5.3.0 | OFL-1.1 | Tibetan font (Uchen) |
| @fontsource/inter | 5.3.0 | OFL-1.1 | English font, Latin subset (bundled for text and titles) |
| @fontsource/roboto | 5.3.0 | OFL-1.1 | English font, Latin subset (bundled for text and titles) |
| @fontsource/open-sans | 5.3.0 | OFL-1.1 | English font, Latin subset (bundled for text and titles) |
| @fontsource/montserrat | 5.3.0 | OFL-1.1 | English font, Latin subset (bundled for text and titles) |
| @fontsource/lato | 5.3.0 | OFL-1.1 | English font, Latin subset (bundled for text and titles) |
| @fontsource/poppins | 5.3.0 | OFL-1.1 | English font, Latin subset (bundled for text and titles) |
| @fontsource/noto-sans | 5.3.0 | OFL-1.1 | English font, Latin subset (bundled for text and titles) |
| @fontsource/noto-serif | 5.3.0 | OFL-1.1 | English font, Latin subset (bundled for text and titles) |
| @fontsource/merriweather | 5.3.0 | OFL-1.1 | English font, Latin subset (bundled for text and titles) |
| @fontsource/playfair-display | 5.3.0 | OFL-1.1 | English font, Latin subset (bundled for text and titles) |
| @fontsource/oswald | 5.3.0 | OFL-1.1 | English font, Latin subset (bundled for text and titles) |
| @fontsource/raleway | 5.3.0 | OFL-1.1 | English font, Latin subset (bundled for text and titles) |
| @fontsource/bebas-neue | 5.3.0 | OFL-1.1 | English font, Latin subset (bundled for text and titles) |
| @fontsource/lobster | 5.3.0 | OFL-1.1 | English font, Latin subset (bundled for text and titles) |
| @fontsource/pacifico | 5.3.0 | OFL-1.1 | English font, Latin subset (bundled for text and titles) |
| @fontsource/dancing-script | 5.3.0 | OFL-1.1 | English font, Latin subset (bundled for text and titles) |
| @fontsource/caveat | 5.3.0 | OFL-1.1 | English font, Latin subset (bundled for text and titles) |
| @fontsource/source-code-pro | 5.3.1 | OFL-1.1 | English font, Latin subset (bundled for text and titles) |
| uiohook-napi | 1.5.5 | MIT | Global click/key capture during recording |

**LGPL note (lamejs):** the library is used unmodified as a separate JavaScript module.
Its licence text ships with the app, and users may replace the module with their own
build of lamejs. Its source is available at https://github.com/zhuker/lamejs and the
fork used at https://www.npmjs.com/package/@breezystack/lamejs.

Video, AAC and Opus encoding use the WebCodecs encoders built into Electron (Chromium);
no FFmpeg binary is shipped.
