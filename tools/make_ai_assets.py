#!/usr/bin/env python3
"""
Audiowizard Workspace — генератор демо-данных ИИ-стенограммы.
Единый источник правды: сегменты диалога → word-тайминги + WAV-аудио,
синтезированное точно по этим таймингам (караоке-синхрон в UI идеально совпадает).

Выход:
  js/ai-data.js          — const AI_DATA = {...}
  assets/demo-podcast.wav — демо-аудио
"""
import json, math, wave, struct, os, random, re

SR = 11025
GAP = 0.30          # пауза между сегментами, сек
INTRO = 1.1         # интро-джингл, сек
TAIL = 0.6

# Слова с альтернативами помечаются {вариант1,вариант2} сразу после слова.
SEGMENTS = [
    (1, "Добро пожаловать в подкаст Audiowizard{Аудиовизард,AudioWizard}! Сегодня поговорим про ИИ-стенограммы{ИИ-транскрипции,ИИ-расшифровки} и то, как они меняют работу с аудио."),
    (2, "Да, и особенно ценно, что распознавание идёт с диаризацией{диарризацией,сегментацией}: система сама понимает, кто говорит."),
    (1, "Ровно. Мы загрузили запись прошлой встречи и уже через пару минут получили готовую расшифровку{расшифрование,транскрипцию} с таймкодами{тайм-кодами,таймстемпами}."),
    (2, "Мне понравилось, что неуверенные слова подчёркиваются пунктиром{штрихпунктиром,подчёркиванием} — кликаешь и выбираешь правильный вариант из списка."),
    (1, "А ещё есть караоке-синхрон: подсветка бежит по словам вместе с аудио, удобно вычитывать{правлять,просматривать} длинные интервью."),
    (2, "Про переводы тоже скажу: структура документа сохраняется, абзацы и списки остаются{остаются,сохраняются} на своих местах."),
    (1, "И копирайтинг: задаёшь тему, тон и длину — получаешь три варианта текста, потом рерайт{переписывание,рерайтинг} или саммари в один клик."),
    (2, "Все результаты можно прикрепить{приложить,отправить} прямо к заказу, чтобы клиент и менеджер увидели их в карточке."),
    (1, "Итог простой: рутина уходит машине, а команда занимается смыслами{смыслами,контентом}. Спасибо, что были с нами!"),
]

SPEAKERS = {1: "Ведущий", 2: "Со-ведущий"}
FREQ = {1: 165.0, 2: 232.0}

random.seed(42)

def parse_text(text):
    """Текст → [(word, alts)]; пометка слова с альтернативами: слово{вар1,вар2}! — знаки после } остаются при слове"""
    out = []
    for token in text.split(" "):
        m = re.match(r"^(.*?)\{([^}]+)\}(.*)$", token)
        if m:
            alts = [a.strip() for a in m.group(2).split(",")]
            out.append((m.group(1) + m.group(3), alts))
        else:
            out.append((token, []))
    return out

def build_segments():
    segs = []
    t = INTRO
    for spk, text in SEGMENTS:
        words_raw = parse_text(text)
        weights = [max(3, len(w) + (2 if any(ch in w for ch in "жщшчйьъ") else 0)) for w, _ in words_raw]
        total_w = sum(weights)
        usable = len(words_raw) * 0.06
        span = total_w / 18.0 + 0.35
        end = t + span
        words = []
        cur = t
        for (w, alts), wt in zip(words_raw, weights):
            d = span * wt / total_w * 0.86 + 0.055
            conf = None
            if alts:
                conf = round(0.55 + (random.randint(0, 17)) / 100.0, 2)
                if conf > 0.72: conf = 0.72
            entry = {"w": w, "s": round(cur, 3), "e": round(min(cur + d, end - 0.02), 3)}
            if alts:
                entry["conf"] = conf
                entry["alts"] = alts
            words.append(entry)
            cur += d + 0.028
        segs.append({
            "speaker": spk, "start": round(t, 3), "end": round(end, 3),
            "text": text.replace("{", "").replace("}", ""),
            "words": words
        })
        t = end + GAP
    duration = round(t - GAP + TAIL, 3)
    return segs, duration

def synth(segs, duration, path):
    n_total = int(duration * SR)
    buf = [0.0] * n_total
    # интро-джингл: три ноты
    for k, f in enumerate([523.25, 659.25, 783.99]):
        s0 = int((0.05 + k * 0.26) * SR); n0 = int(0.22 * SR)
        for i in range(n0):
            env = math.sin(math.pi * i / n0) ** 2
            buf[s0 + i] += 0.22 * env * math.sin(2 * math.pi * f * i / SR)
    rnd = random.Random(7)
    for seg in segs:
        base = FREQ[seg["speaker"]]
        for w in seg["words"]:
            s0 = int(w["s"] * SR); e0 = int(w["e"] * SR)
            n0 = max(1, e0 - s0)
            f0 = base * (0.94 + rnd.random() * 0.12)
            for i in range(n0):
                p = i / n0
                env = math.sin(math.pi * min(1.0, p * 1.15)) ** 1.4
                vibr = 1 + 0.012 * math.sin(2 * math.pi * 5.2 * p)
                v = math.sin(2 * math.pi * f0 * vibr * i / SR)
                v += 0.35 * math.sin(2 * math.pi * f0 * 2 * i / SR)
                v += 0.12 * math.sin(2 * math.pi * f0 * 3.01 * i / SR)
                v += (rnd.random() - 0.5) * 0.05
                buf[s0 + i] += 0.30 * env * v
            # короткая «прослойка» шёпотом между словами не нужна — тишина естественна
    # мягкая нормализация
    peak = max(1e-6, max(abs(x) for x in buf))
    k = 0.82 / peak
    with wave.open(path, "w") as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR)
        f.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, x * k)) * 32767)) for x in buf))
    return os.path.getsize(path)

def main():
    root = os.path.dirname(os.path.abspath(__file__))
    proj = os.path.dirname(root)
    segs, duration = build_segments()
    data = {"duration": duration, "speakers": SPEAKERS, "segments": segs}
    os.makedirs(os.path.join(proj, "assets"), exist_ok=True)
    wav_path = os.path.join(proj, "assets", "demo-podcast.wav")
    size = synth(segs, duration, wav_path)
    import base64
    b64 = base64.b64encode(open(wav_path, "rb").read()).decode("ascii")
    js = ("/* Сгенерировано tools/make_ai_assets.py — не редактировать вручную */\n"
          "const AI_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
          "const AI_AUDIO_B64 = \"" + b64 + "\";\n")
    with open(os.path.join(proj, "js", "ai-data.js"), "w", encoding="utf-8") as f:
        f.write(js)
    os.remove(wav_path)
    words = sum(len(s["words"]) for s in segs)
    low = sum(1 for s in segs for w in s["words"] if w.get("alts"))
    print(f"OK: {len(segs)} сегментов, {words} слов, {low} неуверенных, {duration}с, аудио {size//1024} КБ (встроен в ai-data.js)")

if __name__ == "__main__":
    main()
