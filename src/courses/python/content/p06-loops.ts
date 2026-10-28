import type { Module } from '../../../content/types';

// Ported from the standalone pyschool course. Persian lesson content; code is Python.
export const p06: Module = {
  "id": "p06",
  "number": 6,
  "title": "حلقه‌ها",
  "tagline": "کارهای تکراری را به حلقه بسپار؛ کمتر بنویس، بیشتر انجام بده.",
  "concepts": [
    {
      "id": "m06-for",
      "title": "حلقهٔ for و range",
      "card": "با حلقهٔ `for` یک کار را چند بار تکرار می‌کنیم. `range(n)` اعداد را از `0` تا قبل از `n` می‌سازد:\n\n```python\nfor i in range(3):\n    print(i)\n```\n\nاین کد `0`، `1` و `2` را چاپ می‌کند. متغیر `i` در هر دور مقدار بعدی را می‌گیرد. بلوکِ داخل حلقه باید **تورفته** باشد.",
      "predict": {
        "sql": "for i in range(3):\n    print(\"سلام\")",
        "question": "«سلام» چند بار چاپ می‌شود؟",
        "choices": [
          "۱ بار",
          "۳ بار",
          "۴ بار"
        ],
        "answer": 1,
        "why": "`range(3)` سه مقدار (۰، ۱، ۲) می‌سازد، پس حلقه سه بار اجرا می‌شود."
      },
      "example": {
        "sql": "for i in range(4):\n    print(i)",
        "note": "چاپ می‌کند: 0 و 1 و 2 و 3."
      },
      "cheat": {
        "syntax": "for i in range(n):",
        "note": "n بار تکرار؛ i از ۰ تا n-1."
      }
    },
    {
      "id": "m06-range2",
      "title": "range با شروع و گام",
      "card": "`range` می‌تواند **شروع**، **پایان** و **گام** بگیرد: `range(شروع, پایان, گام)`:\n\n```python\nfor i in range(1, 6):\n    print(i)        # 1 2 3 4 5\n\nfor i in range(0, 10, 2):\n    print(i)        # 0 2 4 6 8\n```\n\nپایان همیشه **شامل نمی‌شود**. گام (عدد سوم) تعیین می‌کند چند تا چند تا جلو برود.",
      "predict": {
        "sql": "for i in range(2, 5):\n    print(i)",
        "question": "چه اعدادی چاپ می‌شوند؟",
        "choices": [
          "2 3 4 5",
          "2 3 4",
          "3 4 5"
        ],
        "answer": 1,
        "why": "`range(2, 5)` از ۲ شروع می‌شود و تا قبل از ۵ می‌رود، پس ۲ و ۳ و ۴."
      },
      "example": {
        "sql": "for i in range(1, 10, 3):\n    print(i)",
        "note": "از ۱ با گامِ ۳: چاپ می‌کند 1 و 4 و 7."
      },
      "cheat": {
        "syntax": "range(start, stop, step)",
        "note": "stop شامل نمی‌شود."
      }
    },
    {
      "id": "m06-while",
      "title": "حلقهٔ while",
      "card": "حلقهٔ `while` **تا وقتی** شرط درست است تکرار می‌شود:\n\n```python\ncount = 0\nwhile count < 3:\n    print(count)\n    count = count + 1\n```\n\n**خیلی مهم:** باید داخل حلقه کاری کنی که شرط بالاخره **غلط** شود (مثل `count = count + 1`)، وگرنه حلقه هیچ‌وقت تمام نمی‌شود!",
      "predict": {
        "sql": "n = 3\nwhile n > 0:\n    print(n)\n    n = n - 1",
        "question": "چه اعدادی چاپ می‌شوند؟",
        "choices": [
          "3 2 1",
          "3 2 1 0",
          "1 2 3"
        ],
        "answer": 0,
        "why": "تا وقتی `n > 0` است چاپ می‌کند: ۳، ۲، ۱؛ وقتی n به ۰ برسد شرط غلط می‌شود."
      },
      "example": {
        "sql": "i = 1\nwhile i <= 3:\n    print(i)\n    i = i + 1",
        "note": "چاپ می‌کند 1 و 2 و 3."
      },
      "cheat": {
        "syntax": "while شرط:",
        "note": "تا وقتی شرط درست است تکرار می‌شود."
      }
    },
    {
      "id": "m06-break",
      "title": "break و continue",
      "card": "دو دستور برای کنترلِ حلقه:\n\n- `break` حلقه را کاملاً **متوقف** می‌کند.\n- `continue` از این دور می‌پرد و به **دور بعد** می‌رود.\n\n```python\nfor i in range(10):\n    if i == 3:\n        break\n    print(i)   # 0 1 2\n```\n\nوقتی `i` به ۳ رسید، `break` اجرا شده و حلقه تمام می‌شود.",
      "predict": {
        "sql": "for i in range(5):\n    if i == 2:\n        break\n    print(i)",
        "question": "چه اعدادی چاپ می‌شوند؟",
        "choices": [
          "0 1",
          "0 1 2",
          "0 1 2 3 4"
        ],
        "answer": 0,
        "why": "در دورِ `i == 2` قبل از چاپ `break` می‌شود، پس فقط ۰ و ۱ چاپ می‌شوند."
      },
      "example": {
        "sql": "for i in range(5):\n    if i == 2:\n        continue\n    print(i)",
        "note": "عددِ ۲ رد می‌شود: چاپ می‌کند 0 1 3 4."
      },
      "cheat": {
        "syntax": "break · continue",
        "note": "توقف حلقه · پریدن به دور بعد."
      }
    }
  ],
  "practice": [
    {
      "id": "m06-p1",
      "conceptIds": [
        "m06-for"
      ],
      "prompt": "با یک حلقه، اعدادِ ۰ تا ۴ را (هر کدام در یک خط) چاپ کن.",
      "explanation": "`range(5)` اعداد ۰ تا ۴ را می‌سازد و حلقه هر کدام را چاپ می‌کند.",
      "hints": [
        "از `for i in range(5):` استفاده کن.",
        "خطِ چاپ باید تورفته باشد."
      ],
      "kind": "write",
      "solution": "for i in range(5):\n    print(i)"
    },
    {
      "id": "m06-p2",
      "conceptIds": [
        "m06-range2"
      ],
      "prompt": "بدون اجرا حدس بزن چند خط چاپ می‌شود.",
      "explanation": "`range(1, 4)` سه مقدار (۱، ۲، ۳) دارد، پس سه خط «x».",
      "hints": [
        "`range(1, 4)` چند مقدار دارد؟"
      ],
      "kind": "readQuery",
      "sql": "for i in range(1, 4):\n    print(\"x\")",
      "choices": [
        "۲ خط",
        "۳ خط",
        "۴ خط"
      ],
      "answer": 1
    },
    {
      "id": "m06-p3",
      "conceptIds": [
        "m06-while"
      ],
      "prompt": "جای خالی را پر کن تا اعدادِ زوجِ ۰ تا ۸ چاپ شوند (۰، ۲، ۴، ۶، ۸).",
      "explanation": "گامِ ۲ باعث می‌شود دو تا دو تا جلو برود: ۰، ۲، ۴، ۶، ۸.",
      "hints": [
        "عدد سومِ range همان گام است؛ برای زوج‌ها باید ۲ باشد."
      ],
      "kind": "fillBlank",
      "starterSql": "for i in range(0, 9, ___):\n    print(i)",
      "solution": "for i in range(0, 9, 2):\n    print(i)"
    },
    {
      "id": "m06-p4",
      "conceptIds": [
        "m06-break"
      ],
      "prompt": "با یک حلقهٔ while، از عدد ۳ شروع کن و تا وقتی مثبت است هر عدد را چاپ کن (۳، ۲، ۱).",
      "explanation": "در هر دور n یکی کم می‌شود تا شرط غلط شود؛ خروجی ۳، ۲، ۱.",
      "hints": [
        "شرط: `while n > 0:`",
        "داخل حلقه یادت نرود `n = n - 1` وگرنه بی‌نهایت می‌شود."
      ],
      "kind": "write",
      "solution": "n = 3\nwhile n > 0:\n    print(n)\n    n = n - 1"
    },
    {
      "id": "m06-p5",
      "conceptIds": [
        "m06-for"
      ],
      "prompt": "این حلقه باید اعدادِ ۰ تا ۲ را چاپ کند ولی خطا می‌دهد. درستش کن.",
      "explanation": "خطِ `for` هم مثل `if` به `:` در انتها نیاز دارد.",
      "hints": [
        "انتهای خطِ for باید `:` داشته باشد."
      ],
      "kind": "fixBug",
      "starterSql": "for i in range(3)\n    print(i)",
      "solution": "for i in range(3):\n    print(i)"
    },
    {
      "id": "m06-p6",
      "conceptIds": [
        "m06-range2"
      ],
      "prompt": "خطوط را مرتب کن تا حلقه اعدادِ ۰، ۱، ۲ را چاپ کند و در ۳ متوقف شود.",
      "explanation": "ترتیب درست: ابتدا شرطِ break، بعد print؛ پس در i==3 بدون چاپ متوقف می‌شود.",
      "hints": [
        "اول باید بررسی break باشد، بعد print؛ تا وقتی i به ۳ رسید قبل از چاپ متوقف شود."
      ],
      "kind": "parsons",
      "blocks": [
        "for i in range(10):",
        "    if i == 3:",
        "        break",
        "    print(i)"
      ],
      "wrongOrder": [
        "for i in range(10):",
        "    print(i)",
        "    if i == 3:",
        "        break"
      ],
      "distractors": [
        "        continue"
      ]
    }
  ],
  "test": [
    {
      "id": "m06-t1",
      "conceptIds": [
        "m06-for"
      ],
      "prompt": "خروجی این کد چیست؟",
      "explanation": "`range(3)` یعنی ۰، ۱، ۲.",
      "hints": [],
      "kind": "readQuery",
      "sql": "for i in range(3):\n    print(i)",
      "choices": [
        "1 2 3",
        "0 1 2",
        "0 1 2 3"
      ],
      "answer": 1
    },
    {
      "id": "m06-t2",
      "conceptIds": [
        "m06-range2"
      ],
      "prompt": "با یک حلقه، اعدادِ ۱ تا ۵ را (شاملِ ۵) چاپ کن.",
      "explanation": "`range(1, 6)` اعداد ۱ تا ۵ را می‌سازد (۶ شامل نمی‌شود).",
      "hints": [],
      "kind": "write",
      "solution": "for i in range(1, 6):\n    print(i)"
    },
    {
      "id": "m06-t3",
      "conceptIds": [
        "m06-while"
      ],
      "prompt": "خروجی این کد چیست؟",
      "explanation": "`continue` دورِ `i == 2` را رد می‌کند، پس ۲ چاپ نمی‌شود.",
      "hints": [],
      "kind": "readQuery",
      "sql": "for i in range(5):\n    if i == 2:\n        continue\n    print(i)",
      "choices": [
        "0 1 2 3 4",
        "0 1 3 4",
        "0 1"
      ],
      "answer": 1
    },
    {
      "id": "m06-t4",
      "conceptIds": [
        "m06-break"
      ],
      "prompt": "جای خالی را پر کن تا حلقهٔ while سه بار اجرا شود (۰، ۱، ۲).",
      "explanation": "باید در هر دور به `c` یکی اضافه شود تا بالاخره شرط غلط شود.",
      "hints": [],
      "kind": "fillBlank",
      "starterSql": "c = 0\nwhile c < 3:\n    print(c)\n    c = c ___ 1",
      "solution": "c = 0\nwhile c < 3:\n    print(c)\n    c = c + 1"
    },
    {
      "id": "m06-t5",
      "conceptIds": [
        "m06-for"
      ],
      "prompt": "خروجی این کد چیست؟",
      "explanation": "تا وقتی `n > 0` است چاپ می‌کند: ۲ و ۱؛ در ۰ شرط غلط می‌شود.",
      "hints": [],
      "kind": "readQuery",
      "sql": "n = 2\nwhile n > 0:\n    print(n)\n    n = n - 1",
      "choices": [
        "2 1 0",
        "2 1",
        "1 2"
      ],
      "answer": 1
    }
  ],
  "games": [
    "outputPredictor"
  ]
};
