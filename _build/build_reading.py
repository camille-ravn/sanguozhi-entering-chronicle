#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""从 wenlinshe.com 取回《三国志》指定卷的完整正文，按人物传记切分，输出 reading_raw.json。

要点：
1. 卷页只列出「分节」链接，一个人物的传记会被拆成多个分节；必须按顺序合并。
2. 分节正文里插入的 <div class="ad-in-content"> 会把 <p> 截断，必须整块删除再取 <p>。
3. 原文页底部有注音/释义（以〔n〕开头）与裴松之注（以〔一〕开头），游戏中只保留白文，需剔除。
"""
import json
import os
import re
import html
import time
import urllib.request

BASE = 'https://www.wenlinshe.com'
REF = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(REF, '_cache_wl')
HEAD = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                  '(KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': BASE + '/book/zhongguolishi/san-guo-zhi.html',
}
DELAY = 0.5


def fetch(url):
    os.makedirs(CACHE, exist_ok=True)
    key = re.sub(r'[^0-9A-Za-z]+', '_', url)[-120:] + '.html'
    path = os.path.join(CACHE, key)
    if os.path.exists(path) and os.path.getsize(path) > 500:
        return open(path, encoding='utf-8').read()
    req = urllib.request.Request(url, headers=HEAD)
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                t = r.read().decode('utf-8', 'replace')
            open(path, 'w', encoding='utf-8').write(t)
            time.sleep(DELAY)
            return t
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError('fetch failed %s: %s' % (url, last))


def strip_tags(x):
    x = re.sub(r'<script[\s\S]*?</script>', '', x, flags=re.I)
    x = re.sub(r'<style[\s\S]*?</style>', '', x, flags=re.I)
    x = re.sub(r'<[^>]+>', '', x)
    return html.unescape(x).strip()


def volume_sections(juan_url):
    """卷页 -> 该卷按顺序排列的分节 [(label, url)]"""
    t = fetch(juan_url)
    m = re.search(r'/san-guo-zhi/([a-z\-]+)/', juan_url)
    vol_dir = m.group(1) if m else ''
    needle = '/chapter/zhongguolishi/san-guo-zhi/%s/' % vol_dir
    out, seen = [], set()
    for mm in re.finditer(r'<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)</a>', t):
        url, label = mm.group(1), strip_tags(mm.group(2))
        if needle not in url:
            continue
        if url.rstrip('/').endswith('yuan-wen.html'):  # 卷首页自身
            continue
        if url in seen or not label:
            continue
        seen.add(url)
        out.append((label, url))
    return out


def section_text(url):
    """分节页 -> 白文（只取「原文」小节，剔除广告/注释/裴注）"""
    t = fetch(url)
    seg = ''
    i = t.find('class="label-yuanwen"')
    if i >= 0:  # 优先：只截取「原文」小节，直到下一个 <h3>
        j = t.find('<h3', i + 20)
        seg = t[i:j if j > i else i + 80000]
    else:
        i = t.find('class="chapter-content"')
        if i < 0:
            return ''
        j = t.find('</article>', i)
        seg = t[i:j if j > i else i + 80000]
    # 广告块（含正文中插入的）先整块删除
    seg = re.sub(r'<div[^>]*(?:ad-in-content|ad-adsense-wrap)[^>]*>[\s\S]*?</div>', '', seg)
    seg = re.sub(r'<div[^>]*class="[^"]*ad[-_][^"]*"[^>]*>[\s\S]*?</div>', '', seg)
    paras = []
    for p in re.findall(r'<p[^>]*>([\s\S]*?)</p>', seg):
        x = strip_tags(p)
        if not x:
            continue
        if re.match(r'^〔\s*[0-9一二三四五六七八九十百]+\s*〕', x):  # 注音/释义/裴注条目
            continue
        paras.append(x)
    return '\n'.join(paras)


def clean(text):
    # 文林社的校勘写法：正文用〔编者订字〕，异文用（底本字）并列。
    text = re.sub(r'〔\s*[0-9]+\s*〕', '', text)                        # 释义序号〔1〕
    text = re.sub(r'〔[一二三四五六七八九十]+〕', '', text)              # 裴注序号〔一〕
    text = re.sub(r'（[^（）]{0,14}）〔([^〔〕]{1,14})〕', r'\1', text)  # 成对：取订字
    text = re.sub(r'〔([^〔〕]{1,20})〕', r'\1', text)                   # 校改补字：保留内容
    text = re.sub(r'（[^（）]{0,14}）', '', text)                        # 孤立的（底本字）
    text = text.replace('\u3000', '')
    text = re.sub(r'[ \t]+', '', text)
    text = re.sub(r'\n{2,}', '\n', text)
    text = re.sub(r'［([^］]{1,12})］', r'\1', text)   # 站点用全角方括号插入校改字
    for a, b in FIXES.items():                        # 站点占位符/笔误
        text = text.replace(a, b)
    return text.strip()


# 每卷要抓的传记： (卷号, person_id, 传名, 分节起始标记, 该卷内所有切分点(按顺序))
CHAPS = [
    (10, 'xun_yu',      '荀彧传',   '荀彧字文若',   ['荀彧字文若', '荀攸字公达', '贾诩字文和', '评曰']),
    (10, 'xun_you',     '荀攸传',   '荀攸字公达',   ['荀彧字文若', '荀攸字公达', '贾诩字文和', '评曰']),
    (10, 'jia_xu',      '贾诩传',   '贾诩字文和',   ['荀彧字文若', '荀攸字公达', '贾诩字文和', '评曰']),
    (14, 'guo_jia',     '郭嘉传',   '郭嘉字奉孝',   ['郭嘉字奉孝', '董昭字公仁', '评曰']),
    (17, 'zhang_liao',  '张辽传',   '张辽字文远',   ['张辽字文远', '乐进字文谦', '于禁字文则', '张郃字儁乂', '徐晃字公明', '评曰']),
    (29, 'hua_tuo',     '华佗传',   '华佗字元化',   ['华佗字元化', '杜夔字公良', '评曰']),
    (35, 'zhuge_liang', '诸葛亮传', '诸葛亮字孔明', ['诸葛亮字孔明', '评曰']),
    (36, 'guan_yu',     '关羽传',   '关羽字云长',   ['关羽字云长', '张飞字益德', '张飞字翼德', '马超字孟起', '评曰']),
    (36, 'zhang_fei',   '张飞传',   '张飞字益德',   ['关羽字云长', '张飞字益德', '张飞字翼德', '马超字孟起', '评曰']),
    (36, 'zhao_yun',    '赵云传',   '赵云字子龙',   ['关羽字云长', '张飞字益德', '张飞字翼德', '马超字孟起', '赵云字子龙', '评曰']),
    (46, 'sun_jian',    '孙坚传',   '孙坚字文台',   ['孙坚字文台', '孙策字伯符', '评曰']),
    (46, 'sun_ce',      '孙策传',   '孙策字伯符',   ['孙坚字文台', '孙策字伯符', '评曰']),
    (47, 'sun_quan',    '孙权传',   '孙权字仲谋',   ['孙权字仲谋', '评曰']),
    (49, 'tai_shi_ci',  '太史慈传', '太史慈字子义', ['刘繇字正礼', '太史慈字子义', '士燮字威彦', '评曰']),
    (52, 'zhang_zhao',  '张昭传',   '张昭字子布',   ['张昭字子布', '顾雍字元叹', '评曰']),
    (54, 'zhou_yu',     '周瑜传',   '周瑜字公瑾',   ['周瑜字公瑾', '鲁肃字子敬', '吕蒙字子明', '孙权与陆逊论周瑜', '评曰']),
    (54, 'lu_su',       '鲁肃传',   '鲁肃字子敬',   ['周瑜字公瑾', '鲁肃字子敬', '吕蒙字子明', '孙权与陆逊论周瑜', '评曰']),
    (54, 'lv_meng',     '吕蒙传',   '吕蒙字子明',   ['周瑜字公瑾', '鲁肃字子敬', '吕蒙字子明', '孙权与陆逊论周瑜', '评曰']),
    (55, 'gan_ning',    '甘宁传',   '甘宁字兴霸',   ['甘宁字兴霸', '凌统字公绩', '评曰']),
    (58, 'lu_xun',      '陆逊传',   '陆逊字伯言',   ['陆逊字伯言', '陆抗字幼节', '评曰']),
    (58, 'lu_kang',     '陆抗传',   '陆抗字幼节',   ['陆逊字伯言', '陆抗字幼节', '评曰']),
    (64, 'zhuge_ke',    '诸葛恪传', '诸葛恪字元逊', ['诸葛恪字元逊', '滕胤字承嗣', '评曰']),
]
DIVISION = {1: '魏书', 2: '魏书', 3: '吴书', 4: '蜀书', 5: '蜀书'}
JUAN_DIV = {10: '魏书', 14: '魏书', 17: '魏书', 29: '魏书',
            35: '蜀书', 36: '蜀书',
            46: '吴书', 47: '吴书', 49: '吴书', 52: '吴书',
            54: '吴书', 55: '吴书', 58: '吴书', 64: '吴书'}
# 收录口径：吴书按「主要人物」收齐，魏书/蜀书只是抽篇，前端据此标注
SCOPE = {'魏书': '节选', '蜀书': '节选', '吴书': '主要人物'}
# 站点原文自身的录入笔误 / 无法渲染字符的占位符，逐条修正（左=站点，右=通行本）
FIXES = {
    '蒜i大酢': '蒜齑大酢',
    '肃将入<拜': '肃将入阁拜',
    '据襄阳以<操': '据襄阳以蹙操',
    '尽伏其精兵}~中': '尽伏其精兵舟中',
    '臣愚""': '臣愚慺慺',
    '卿不师日!': '卿不师日磾',
    '兼纳纤6南方之贡': '兼纳纤絺南方之贡',   # 占位符「6」= 絺
    '著缞衣入其<中': '著缞衣入其阁中',      # 站内把「阁」误转义成了 &lt;
    '策字伯符': '孙策字伯符',                # 站点脱去传首姓氏，须在切分前补回
    '抗字幼节': '陆抗字幼节',
}


def main():
    urls = json.load(open(os.path.join(REF, 'wl_juan_urls.json'), encoding='utf-8'))
    assert len(urls) == 65
    juan_url = {n + 1: u for n, u in enumerate(urls)}

    needed = sorted({c[0] for c in CHAPS})
    vol_sections = {}
    vol_labels = {}
    for n in needed:
        secs = volume_sections(juan_url[n])
        vol_sections[n] = secs
        vol_labels[n] = [s[0] for s in secs]
        print('卷%-3d 分节 %2d：%s' % (n, len(secs), ' / '.join(s[0][:10] for s in secs)))
        # 预取正文
        for _lab, u in secs:
            section_text(u)

    chapters = []
    for juan, pid, title, start, cuts in CHAPS:
        secs = vol_sections[juan]
        # 站点的「分节」是按段落切的，与传记边界并不重合，
        # 所以先合并整卷正文，再在全文里按人物起始句定位切点。
        full = clean('\n'.join(section_text(u) for _l, u in secs))
        si = full.find(start)
        if si < 0:
            print('!! 卷%d 找不到起点「%s」' % (juan, start))
            continue
        hits = []
        for c in cuts:
            k = full.find(c)
            if k >= 0:
                hits.append(k)
        hits.sort()
        ei = len(full)
        for k in hits:
            if si < k < ei:
                ei = k
        body = full[si:ei]
        paras = [p for p in body.split('\n') if p]
        chapters.append({
            'slug': pid, 'title': title, 'volume': juan,
            'division': JUAN_DIV.get(juan, ''),
            'chars': sum(len(p) for p in paras),
            'paras': paras,
        })
        print('%-12s %-8s 卷%-3d %6d 字  首:%s'
              % (pid, title, juan, chapters[-1]['chars'], paras[0][:16] if paras else ''))

    # 交付前自检：正文不应残留标签、序号、拉丁字母
    bad = []
    for c in chapters:
        txt = ''.join(c['paras'])
        for m in re.finditer(r'[A-Za-z0-9〔〕（）\[\]<>]', txt):
            bad.append('%s:%s' % (c['slug'], txt[max(0, m.start() - 6):m.start() + 6]))
    print('自检残留 %d 处' % len(bad))
    for b in bad[:20]:
        print('   ', b)

    out = os.path.join(REF, 'reading_raw.json')
    json.dump({'chapters': chapters}, open(out, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print('写出', out)


if __name__ == '__main__':
    main()
