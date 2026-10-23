"""
Generate the built-in music loops for the Library (original, synthesized here,
so they are free to use in any video). Writes 16-bit stereo WAV files to
resources/library/music/. Each loop is seamless: its length is a whole number
of bars and every note's tail is wrapped around to the start.

Run:  python build/library-source/make_music.py
"""
import json
import pathlib
import wave

import numpy as np

SR = 44100
OUT = pathlib.Path(__file__).resolve().parents[2] / "resources" / "library" / "music"


def midi(n: float) -> float:
    return 440.0 * 2 ** ((n - 69) / 12)


def env(n: int, attack: float, release: float) -> np.ndarray:
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    r = np.exp(-t / max(release, 1e-4))
    return a * r


def tone(freq: float, dur: float, kind: str, attack=0.01, release=0.6) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    if kind == "pad":
        # Detuned soft saw-ish stack, low-passed by keeping few harmonics.
        w = sum(np.sin(2 * np.pi * freq * h * (1 + d) * t) / h for h in (1, 2, 3) for d in (-0.003, 0.003)) / 3.5
    elif kind == "pluck":
        w = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * freq * 2 * t) * np.exp(-t * 6)
    elif kind == "bell":
        w = np.sin(2 * np.pi * freq * t) + 0.5 * np.sin(2 * np.pi * freq * 2.76 * t) * np.exp(-t * 3) + 0.25 * np.sin(2 * np.pi * freq * 5.4 * t) * np.exp(-t * 6)
    elif kind == "bass":
        w = np.sin(2 * np.pi * freq * t) + 0.2 * np.sin(2 * np.pi * freq * 2 * t)
    else:
        raise ValueError(kind)
    return w * env(n, attack, release)


def kick(dur=0.35) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 50 + 70 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)


def shaker(dur=0.08, seed=0) -> np.ndarray:
    n = int(dur * SR)
    rng = np.random.default_rng(seed)
    noise = rng.standard_normal(n)
    noise = np.diff(noise, prepend=0)  # brighter
    return noise * np.exp(-np.arange(n) / SR * 60) * 0.25


class Loop:
    def __init__(self, bpm: float, bars: int):
        self.beat = 60 / bpm
        self.length = int(round(bars * 4 * self.beat * SR))
        self.buf = np.zeros((self.length, 2))

    def add(self, sound: np.ndarray, at_beats: float, gain=1.0, pan=0.0):
        start = int(round(at_beats * self.beat * SR)) % self.length
        lg, rg = gain * np.sqrt((1 - pan) / 2), gain * np.sqrt((1 + pan) / 2)
        idx = (start + np.arange(len(sound))) % self.length  # wrap tails: seamless loop
        np.add.at(self.buf[:, 0], idx, sound * lg)
        np.add.at(self.buf[:, 1], idx, sound * rg)

    def write(self, name: str):
        peak = np.max(np.abs(self.buf)) or 1
        data = (self.buf / peak * 0.5 * 32767).astype("<i2")  # about -6 dBFS peak
        OUT.mkdir(parents=True, exist_ok=True)
        with wave.open(str(OUT / name), "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(data.tobytes())
        return self.length / SR


def calm_pad():
    lp = Loop(bpm=72, bars=8)
    chords = [[50, 57, 62, 66], [47, 54, 59, 62], [43, 50, 55, 59], [45, 52, 57, 61]]  # D, Bm, G, A
    for i, ch in enumerate(chords * 2):
        for j, n in enumerate(ch):
            lp.add(tone(midi(n), lp.beat * 4.5, "pad", attack=1.2, release=2.5), i * 4, 0.22, pan=(j - 1.5) / 3)
        lp.add(tone(midi(ch[0] - 12), lp.beat * 4, "bass", attack=0.3, release=1.5), i * 4, 0.35)
    return lp


def mountain_pluck():
    # Pentatonic (D E F# A B) arpeggios with a soft bell on each bar.
    lp = Loop(bpm=96, bars=8)
    scale = [62, 64, 66, 69, 71, 74, 76, 78]
    pattern = [0, 2, 4, 3, 5, 4, 2, 1]
    for bar in range(8):
        shift = [0, 0, -2, 1, 0, 0, -2, 2][bar]
        for k, step in enumerate(pattern):
            n = scale[max(0, min(len(scale) - 1, step + shift))]
            lp.add(tone(midi(n), 1.2, "pluck", release=0.35), bar * 4 + k * 0.5, 0.3, pan=-0.3 + 0.6 * (k % 2))
        lp.add(tone(midi(scale[0 if bar % 2 == 0 else 3] + 12), 3.0, "bell", release=1.6), bar * 4, 0.12, pan=0.2)
        lp.add(tone(midi(38 + (0 if bar % 4 < 2 else 7)), lp.beat * 3.5, "bass", attack=0.02, release=0.8), bar * 4, 0.4)
    return lp


def soft_pulse():
    lp = Loop(bpm=100, bars=8)
    roots = [45, 41, 48, 43]  # Am F C G
    for bar in range(8):
        r = roots[bar % 4]
        for b in range(4):
            lp.add(kick(), bar * 4 + b, 0.55 if b % 2 == 0 else 0.35)
            lp.add(shaker(seed=bar * 8 + b), bar * 4 + b + 0.5, 0.6, pan=0.4)
        for n in (r + 12, r + 16 if r in (41, 48) else r + 15, r + 19):
            lp.add(tone(midi(n), lp.beat * 4, "pad", attack=0.4, release=1.2), bar * 4, 0.12, pan=-0.2)
        lp.add(tone(midi(r - 12), lp.beat * 1.8, "bass", attack=0.01, release=0.5), bar * 4, 0.45)
        lp.add(tone(midi(r - 12), lp.beat * 1.8, "bass", attack=0.01, release=0.5), bar * 4 + 2.5, 0.35)
    return lp


if __name__ == "__main__":
    tracks = [
        ("calm-pad.wav", "music.calmPad", calm_pad),
        ("mountain-pluck.wav", "music.mountainPluck", mountain_pluck),
        ("soft-pulse.wav", "music.softPulse", soft_pulse),
    ]
    index = []
    for file, key, fn in tracks:
        seconds = fn().write(file)
        index.append({"file": file, "name": key, "seconds": round(seconds, 2)})
        print(f"{file}: {seconds:.1f} s")
    (OUT / "index.json").write_text(json.dumps(index, indent=2), encoding="utf-8")
