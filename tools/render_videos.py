"""サイネージページからクイズ動画(mp4)を書き出す。"""
import asyncio, sys, os, glob, subprocess, json
import cv2, numpy as np
from playwright.async_api import async_playwright
# 使い方:
#   pip install playwright imageio-ffmpeg opencv-python-headless && playwright install chromium
#   (リポジトリ直下で) python3 -m http.server 8765 &
#   python3 tools/render_videos.py out/ 0,1,2,3,4
# 日本語フォント(Noto Sans CJK JP など太字のあるもの)を OS に入れておくこと。
import shutil
try:
    import imageio_ffmpeg; FF = imageio_ffmpeg.get_ffmpeg_exe()
except ImportError:
    FF = shutil.which('ffmpeg')
B = os.environ.get('SIGNAGE_URL', 'http://127.0.0.1:8765/')
CHROME = os.environ.get('CHROME_PATH')
OUT=sys.argv[1]; ITEMS=[int(x) for x in sys.argv[2].split(',')]
DUR=float(sys.argv[3]) if len(sys.argv)>3 else 71.0
os.makedirs(OUT, exist_ok=True)
pl=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'playlist.json'), encoding='utf-8'))

async def record(idx):
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        ctx = await b.new_context(viewport={'width':1920,'height':1080}, record_video_dir=f'{OUT}/raw', record_video_size={'width':1920,'height':1080})
        pg = await ctx.new_page()
        await pg.goto(f'{B}index.html?item={idx}&export=1', wait_until='networkidle')
        await pg.wait_for_function("document.title === 'EXPORT_DONE'", timeout=120000)
        await pg.wait_for_timeout(700)
        path = await pg.video.path()
        await ctx.close(); await b.close()
        return path

def first_nonwhite(path):
    cap = cv2.VideoCapture(path); fps = cap.get(cv2.CAP_PROP_FPS) or 25; i=0
    while True:
        ok, f = cap.read()
        if not ok: return None, fps
        # 最初の暗いフレームと真っ白な読み込み中の画面を飛ばし、文字が出た最初のフレームを探す
        if i > 3 and (cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) < 200).sum() > 5000: return i/fps, fps
        i += 1

async def main():
    for idx in ITEMS:
        raw = await record(idx)
        start, fps = first_nonwhite(raw)
        item = pl['items'][idx]; name = f"quiz-workx-{item['id']}.mp4"
        print(f'item {idx}: raw={os.path.basename(raw)} fps={fps:.1f} start={start:.2f}s')
        subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-ss',f'{start:.3f}','-i',raw,'-t',str(DUR),
                        '-vf','scale=1920:1080,fps=30,format=yuv420p','-c:v','libx264','-preset','slow','-crf','18','-movflags','+faststart','-an',
                        f'{OUT}/{name}'], check=True)
        print('wrote', name)
asyncio.run(main())
