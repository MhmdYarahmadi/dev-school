import type { Module } from '../../../content/types';

// Ported from the standalone pyschool course. Persian lesson content; code is Python.
export const p02: Module = {
  "id": "p02",
  "number": 2,
  "title": "متغیرها و انواع داده",
  "tagline": "یاد بگیر مقدارها را در متغیر ذخیره کنی و فرق متن، عدد و درست/غلط را بفهمی.",
  "concepts": [
    {
      "id": "m02-vars",
      "title": "متغیر چیست؟",
      "card": "یک **متغیر** مثل یک جعبهٔ برچسب‌دار است که یک مقدار را در آن می‌گذاری. با علامت `=` مقدار را در متغیر ذخیره می‌کنیم:\n\n```python\nname = \"Sara\"\nage = 20\nprint(name)\nprint(age)\n```\n\nسمت چپِ `=` **نامِ** متغیر است و سمت راست **مقداری** که در آن ذخیره می‌شود. بعداً هر جا نام را بنویسی، پایتون مقدارش را جایش می‌گذارد.",
      "predict": {
        "sql": "x = 10\nprint(x)",
        "question": "چه چیزی چاپ می‌شود؟",
        "choices": [
          "x",
          "10",
          "x = 10"
        ],
        "answer": 1,
        "why": "وقتی `print(x)` می‌نویسی، پایتون نامِ `x` را با مقدارش یعنی `10` جایگزین می‌کند."
      },
      "example": {
        "sql": "city = \"Tehran\"\nprint(city)",
        "note": "مقدار داخل متغیر city چاپ می‌شود."
      },
      "cheat": {
        "syntax": "name = value",
        "note": "مقدار سمت راست را در متغیر سمت چپ ذخیره می‌کند."
      }
    },
    {
      "id": "m02-types",
      "title": "انواع داده",
      "card": "هر مقدار در پایتون یک **نوع** دارد. چهار نوع پایه برای شروع:\n\n- **`int`** عدد صحیح: `7`\n- **`float`** عدد اعشاری: `3.5`\n- **`str`** متن (رشته): `\"Hello\"`\n- **`bool`** درست یا غلط: `True` یا `False`\n\nدقت کن که `7` (عدد) با `\"7\"` (متن) فرق دارد.",
      "predict": {
        "sql": "print(True)",
        "question": "خروجی چیست؟",
        "choices": [
          "true",
          "True",
          "1"
        ],
        "answer": 1,
        "why": "مقدار منطقی در پایتون با حرف بزرگ نوشته می‌شود: `True` و `False`."
      },
      "example": {
        "sql": "print(3.5)\nprint(\"3.5\")",
        "note": "اولی عدد اعشاری است، دومی یک متن."
      },
      "cheat": {
        "syntax": "int · float · str · bool",
        "note": "عدد صحیح، اعشاری، متن، درست/غلط."
      }
    },
    {
      "id": "m02-type",
      "title": "نوع را با type ببین",
      "card": "با دستور `type()` می‌توانی نوعِ یک مقدار را ببینی:\n\n```python\nprint(type(7))        # <class 'int'>\nprint(type(\"Hello\"))   # <class 'str'>\nprint(type(2.5))      # <class 'float'>\n```\n\nاین کار برای وقتی مفید است که مطمئن نیستی با عدد سروکار داری یا با متن.",
      "predict": {
        "sql": "print(type(\"5\"))",
        "question": "نوعِ \"5\" چیست؟",
        "choices": [
          "<class 'int'>",
          "<class 'str'>",
          "<class 'float'>"
        ],
        "answer": 1,
        "why": "چون داخل گیومه است، یک **رشته** (str) محسوب می‌شود، نه عدد."
      },
      "example": {
        "sql": "print(type(10))\nprint(type(10.0))",
        "note": "۱۰ یک int است ولی ۱۰.۰ یک float."
      },
      "cheat": {
        "syntax": "type(value)",
        "note": "نوعِ مقدار را نشان می‌دهد."
      }
    },
    {
      "id": "m02-naming",
      "title": "نام‌گذاری و تغییر مقدار",
      "card": "نامِ متغیر باید با حرف یا `_` شروع شود و فاصله نداشته باشد (مثلاً `my_age`). می‌توانی مقدار یک متغیر را بعداً **عوض** کنی؛ آخرین مقدار همان است که می‌ماند:\n\n```python\nscore = 5\nscore = 8\nprint(score)   # 8\n```\n\nهمچنین می‌توانی مقدار جدید را از روی مقدار قبلی بسازی: `score = score + 1`.",
      "predict": {
        "sql": "n = 2\nn = n + 3\nprint(n)",
        "question": "خروجی چیست؟",
        "choices": [
          "2",
          "3",
          "5"
        ],
        "answer": 2,
        "why": "اول `n` برابر ۲ است، بعد `n + 3` یعنی `2 + 3 = 5` دوباره در `n` ذخیره می‌شود."
      },
      "example": {
        "sql": "count = 0\ncount = count + 1\ncount = count + 1\nprint(count)",
        "note": "هر خط یکی به count اضافه می‌کند؛ نتیجه ۲."
      },
      "cheat": {
        "syntax": "x = x + 1",
        "note": "مقدار متغیر را بر اساس مقدار قبلی‌اش به‌روز می‌کند."
      }
    }
  ],
  "practice": [
    {
      "id": "m02-p1",
      "conceptIds": [
        "m02-vars"
      ],
      "prompt": "یک متغیر به نام `name` بساز و نامی در آن بگذار، سپس آن را چاپ کن.",
      "explanation": "مقدار را در متغیر ذخیره کردی و بعد با نامش چاپش کردی.",
      "hints": [
        "اول با `=` مقدار بده: `name = \"...\"`",
        "بعد `print(name)`"
      ],
      "kind": "write",
      "solution": "name = \"Sara\"\nprint(name)",
      "python": {
        "nonEmpty": true
      }
    },
    {
      "id": "m02-p2",
      "conceptIds": [
        "m02-types"
      ],
      "prompt": "بدون اجرا حدس بزن خروجی چیست.",
      "explanation": "`a` برابر ۴ و `b` برابر ۶ است، پس `a + b` می‌شود `10`.",
      "hints": [
        "مقدار دو متغیر با هم جمع می‌شود."
      ],
      "kind": "readQuery",
      "sql": "a = 4\nb = 6\nprint(a + b)",
      "choices": [
        "46",
        "10",
        "a + b"
      ],
      "answer": 1
    },
    {
      "id": "m02-p3",
      "conceptIds": [
        "m02-type"
      ],
      "prompt": "جای خالی را پر کن تا نوعِ عددِ ۹ چاپ شود.",
      "explanation": "`type(9)` نوعِ عدد صحیح یعنی `<class 'int'>` را نشان می‌دهد.",
      "hints": [
        "دستوری که نوع را نشان می‌دهد `type` است."
      ],
      "kind": "fillBlank",
      "starterSql": "print(___(9))",
      "solution": "print(type(9))"
    },
    {
      "id": "m02-p4",
      "conceptIds": [
        "m02-naming"
      ],
      "prompt": "این کد باید مقدار متغیر را چاپ کند ولی خطا می‌دهد. درستش کن.",
      "explanation": "نام متغیر نمی‌تواند فاصله داشته باشد؛ معمولاً از `_` استفاده می‌کنیم: `my_age`.",
      "hints": [
        "نام متغیر نباید فاصله داشته باشد.",
        "به جای فاصله از `_` استفاده کن: `my_age`"
      ],
      "kind": "fixBug",
      "starterSql": "my age = 25\nprint(my age)",
      "solution": "my_age = 25\nprint(my_age)"
    },
    {
      "id": "m02-p5",
      "conceptIds": [
        "m02-vars"
      ],
      "prompt": "متغیری به نام `count` با مقدار ۰ بساز، یکی به آن اضافه کن و سپس آن را چاپ کن (باید ۱ شود).",
      "explanation": "مقدار جدید را از روی مقدار قبلی ساختی: `0 + 1 = 1`.",
      "hints": [
        "اول `count = 0`",
        "بعد `count = count + 1`"
      ],
      "kind": "write",
      "solution": "count = 0\ncount = count + 1\nprint(count)"
    },
    {
      "id": "m02-p6",
      "conceptIds": [
        "m02-types"
      ],
      "prompt": "خطوط را مرتب کن تا اول مقدار در متغیر ذخیره شود و بعد چاپ شود.",
      "explanation": "نمی‌توانی چیزی را چاپ کنی که هنوز ساخته نشده؛ پس اول `=` و بعد `print`.",
      "hints": [
        "اول باید مقدار را بسازی، بعد از آن استفاده کنی."
      ],
      "kind": "parsons",
      "blocks": [
        "color = \"blue\"",
        "print(color)"
      ],
      "wrongOrder": [
        "print(color)",
        "color = \"blue\""
      ],
      "distractors": [
        "print(color = \"blue\")"
      ]
    }
  ],
  "test": [
    {
      "id": "m02-t1",
      "conceptIds": [
        "m02-vars"
      ],
      "prompt": "یک متغیر به نام `age` با یک عدد بساز و آن را چاپ کن.",
      "explanation": "عدد را در متغیر ذخیره کردی و چاپش کردی.",
      "hints": [],
      "kind": "write",
      "solution": "age = 20\nprint(age)",
      "python": {
        "nonEmpty": true
      }
    },
    {
      "id": "m02-t2",
      "conceptIds": [
        "m02-types"
      ],
      "prompt": "خروجی این کد چیست؟",
      "explanation": "مقدار دوم جایگزین اولی می‌شود، پس `x` در پایان ۷ است.",
      "hints": [],
      "kind": "readQuery",
      "sql": "x = 3\nx = 7\nprint(x)",
      "choices": [
        "3",
        "7",
        "37"
      ],
      "answer": 1
    },
    {
      "id": "m02-t3",
      "conceptIds": [
        "m02-type"
      ],
      "prompt": "نوعِ این مقدار چیست؟",
      "explanation": "`4.0` به‌خاطر نقطهٔ اعشار یک `float` است، نه `int`.",
      "hints": [],
      "kind": "readQuery",
      "sql": "print(type(4.0))",
      "choices": [
        "<class 'int'>",
        "<class 'float'>",
        "<class 'str'>"
      ],
      "answer": 1
    },
    {
      "id": "m02-t4",
      "conceptIds": [
        "m02-naming"
      ],
      "prompt": "جای خالی را پر کن تا متغیر `score` ساخته و مقدار ۱۰۰ در آن ذخیره شود.",
      "explanation": "برای ذخیرهٔ مقدار در متغیر از `=` استفاده می‌کنیم.",
      "hints": [],
      "kind": "fillBlank",
      "starterSql": "score ___ 100\nprint(score)",
      "solution": "score = 100\nprint(score)"
    },
    {
      "id": "m02-t5",
      "conceptIds": [
        "m02-vars"
      ],
      "prompt": "این کد باید مجموع دو متغیر را چاپ کند. اشکالش را پیدا کن.",
      "explanation": "متغیری به نام `c` ساخته نشده بود؛ باید از `b` استفاده می‌شد.",
      "hints": [],
      "kind": "fixBug",
      "starterSql": "a = 5\nb = 8\nprint(a + c)",
      "solution": "a = 5\nb = 8\nprint(a + b)"
    }
  ],
  "games": [
    "outputPredictor"
  ]
};
