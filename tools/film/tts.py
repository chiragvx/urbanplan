# Voice-over lines to WAVs with Kokoro (Apache-2.0, runs offline): film/tts/ holds the venv and the model files.
#   film/tts/.venv/Scripts/python tools/film/tts.py lines.json outdir
# lines.json: {"voice": "af_heart", "speed": 1.0, "lines": [{"text": "…", "max": 2.5}, …]} → outdir/vo-00.wav …
# (24 kHz mono, silence trimmed). A line longer than its max is said again faster, up to 1.25×; past that it's reported.
import json, os, sys
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

here = os.path.join(os.path.dirname(__file__), '..', '..', 'film', 'tts')
spec = json.load(open(sys.argv[1], encoding='utf-8'))
out = sys.argv[2]
os.makedirs(out, exist_ok=True)
k = Kokoro(os.path.join(here, 'kokoro-v1.0.onnx'), os.path.join(here, 'voices-v1.0.bin'))
def say(text, speed):
    a, sr = k.create(text, voice=spec.get('voice', 'af_heart'), speed=speed, lang=spec.get('lang', 'en-us'))
    # trim the silence either side (below -45 dB), keep 20 ms
    loud = np.where(np.abs(a) > 10 ** (-45 / 20))[0]
    return (a[max(0, loud[0] - sr // 50): loud[-1] + sr // 50] if len(loud) else a), sr

for i, line in enumerate(spec['lines']):
    text, mx, speed = line['text'], line.get('max'), spec.get('speed', 1.0)
    a, sr = say(text, speed)
    if mx and len(a) / sr > mx:
        speed = min(1.25, speed * len(a) / sr / mx * 1.03)
        a, sr = say(text, speed)
    sf.write(os.path.join(out, f'vo-{i:02d}.wav'), a, sr, subtype='PCM_16')
    over = f'  OVER by {len(a) / sr - mx:.2f}s' if mx and len(a) / sr > mx else ''
    print(f'vo-{i:02d} {len(a) / sr:.2f}s ×{speed:.2f}  {text}{over}')
