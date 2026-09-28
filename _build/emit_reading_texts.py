#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""reading_raw.json -> ../reading-texts.js（含收录口径 READING_SCOPE）"""
import io
import json
import os

REF = os.path.dirname(os.path.abspath(__file__))
SCOPE = {'魏书': '节选', '蜀书': '节选', '吴书': '主要人物'}

d = json.load(open(os.path.join(REF, 'reading_raw.json'), encoding='utf-8'))
out = io.StringIO()
out.write('/* 《三国志》原典白文（简体）。\n')
out.write('   底本：文林社《三国志》原文页（https://www.wenlinshe.com），只取每卷「原文」小节，\n')
out.write('   不含裴松之注、释义注音与校勘异文标记；编者订字已并入正文。\n')
out.write('   分章：一传多人者（如卷五四周瑜／鲁肃／吕蒙传）按本传起点各自独立成章。\n')
out.write('   收录口径：吴书按主要人物收齐，魏书、蜀书只取若干名篇（节选）。\n')
out.write('   生成脚本 _build/build_reading.py + _build/emit_reading_texts.py，请勿手工修改。 */\n')
out.write('window.READING_SCOPE = %s;\n' % json.dumps(SCOPE, ensure_ascii=False))
out.write('window.READING_CHAPTERS = ')
json.dump(d['chapters'], out, ensure_ascii=False, indent=1)
out.write(';\n')

path = os.path.join(REF, '..', 'reading-texts.js')
open(path, 'w', encoding='utf-8').write(out.getvalue())
tot = sum(c['chars'] for c in d['chapters'])
print('%s  %d 篇 / %d 字 / %.1f KB'
      % (os.path.basename(path), len(d['chapters']), tot, len(out.getvalue()) / 1024))
for c in d['chapters']:
    print('   %-4s %-10s 卷%-3d %6d 字' % (c['division'], c['title'], c['volume'], c['chars']))
