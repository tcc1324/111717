#!/usr/bin/env python3
# tests/visual_diff.py —— 两张截图的像素对比（视觉回归）
# 用法：python3 tests/visual_diff.py 基线.png 当前.png [--out 差异图.png] [--tol 12] [--max 0.5]
#   --tol  单个通道色差容差（0-255，默认 12，用来忽略抗锯齿/字体微调带来的噪音）
#   --max  允许的差异像素占比上限（百分比，默认 0.5%）
# 退出码：0 = 通过（差异在阈值内），1 = 超阈值，2 = 出错
import sys, json, argparse
from PIL import Image, ImageChops, ImageDraw

def load(path):
    im = Image.open(path).convert('RGB')
    return im

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('base')
    ap.add_argument('cur')
    ap.add_argument('--out', default=None)
    ap.add_argument('--tol', type=int, default=12)
    ap.add_argument('--max', type=float, default=0.5)
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args()

    try:
        b, c = load(a.base), load(a.cur)
    except Exception as e:
        print(f'读图失败: {e}')
        return 2

    size_same = b.size == c.size
    # 尺寸不同时就按左上角对齐、共同区域比较，另外单独报尺寸差（很多视觉回归就是高度变了）
    w = min(b.size[0], c.size[0]); h = min(b.size[1], c.size[1])
    if w < 2 or h < 2:
        print('可比较区域太小')
        return 2
    bb = b.crop((0, 0, w, h)); cc = c.crop((0, 0, w, h))

    diff = ImageChops.difference(bb, cc).convert('L')
    # 容差内的差异当作 0，去掉抗锯齿噪音
    mask = diff.point(lambda v: 255 if v > a.tol else 0)
    hist = mask.histogram()
    changed = sum(hist[1:])            # 被标为 255 的像素数
    total = w * h
    ratio = changed / total * 100 if total else 0

    # 找到差异最集中的区域，方便一眼看哪儿动了
    box = None
    if changed:
        bbox = mask.getbbox()
        box = list(bbox) if bbox else None

    result = {
        'ok': bool(ratio <= a.max and size_same),
        'size_base': list(b.size),
        'size_cur': list(c.size),
        'size_same': size_same,
        'diff_px': changed,
        'total_px': total,
        'diff_percent': round(ratio, 4),
        'tol_percent': a.max,
        'diff_bbox': box,
    }

    # 差异图：左=基线，中=当前，右=红点标出的差异
    if a.out:
        hh = min(b.size[1], c.size[1])
        canvas = Image.new('RGB', (b.size[0] + c.size[0] + w + 24, hh), (255, 255, 255))
        canvas.paste(b, (0, 0))
        canvas.paste(c, (b.size[0] + 12, 0))
        heat = bb.copy()
        red = Image.new('RGB', (w, h), (255, 40, 40))
        heat.paste(red, (0, 0), mask)
        canvas.paste(heat, (b.size[0] + c.size[0] + 24, 0))
        canvas.save(a.out)

    if a.json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        tag = '通过' if result['ok'] else '不通过'
        print(f"[{tag}] 差异 {result['diff_percent']}%（阈值 {a.max}%）· 变化像素 {changed}/{total}")
        if not size_same:
            print(f"  尺寸变了：基线 {b.size[0]}×{b.size[1]} → 当前 {c.size[0]}×{c.size[1]}")
        if box:
            print(f"  差异集中在 {box[0]},{box[1]} 到 {box[2]},{box[3]}")
        if a.out:
            print(f"  对比图（左=基线 中=当前 右=差异）：{a.out}")
    return 0 if result['ok'] else 1

if __name__ == '__main__':
    sys.exit(main())