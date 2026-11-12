import type { Module } from '../../../content/types';

// Ported from the standalone pyschool course. Persian lesson content; code is Python.
export const p08: Module = {
  "id": "p08",
  "number": 8,
  "title": "دیکشنری‌ها",
  "tagline": "داده‌ها را با کلید و مقدار سازمان بده؛ مثل یک دفترچهٔ تلفن.",
  "concepts": [
    {
      "id": "m08-make",
      "title": "کلید و مقدار",
      "card": "یک **دیکشنری** جفت‌های «کلید: مقدار» را داخل `{}` نگه می‌دارد. هر مقدار را با **کلیدش** پیدا می‌کنی، نه با شماره:\n\n```python\nperson = {\"name\": \"Sara\", \"age\": 20}\nprint(person[\"name\"])   # Sara\n```\n\nاین‌جا `\"name\"` و `\"age\"` کلید هستند و `\"Sara\"` و `20` مقدارها. برای گرفتن یک مقدار، کلیدش را داخل `[]` می‌نویسی.",
      "predict": {
        "sql": "d = {\"a\": 1, \"b\": 2}\nprint(d[\"b\"])",
        "question": "خروجی چیست؟",
        "choices": [
          "1",
          "2",
          "b"
        ],
        "answer": 1,
        "why": "با کلیدِ `\"b\"` مقدارِ متناظرش یعنی `2` را می‌گیریم."
      },
      "example": {
        "sql": "car = {\"brand\": \"Pride\", \"year\": 1400}\nprint(car[\"brand\"])",
        "note": "مقدارِ کلیدِ brand چاپ می‌شود."
      },
      "cheat": {
        "syntax": "{\"key\": value}",
        "note": "دسترسی: dict[\"key\"]"
      }
    },
    {
      "id": "m08-edit",
      "title": "افزودن و تغییر",
      "card": "با همان `[]` می‌توانی مقداری را **عوض** کنی یا کلیدِ **جدید** اضافه کنی:\n\n```python\nperson = {\"name\": \"Sara\"}\nperson[\"age\"] = 20      # new key\nperson[\"name\"] = \"Mina\" # change value\nprint(person)\n```\n\nاگر کلید وجود داشته باشد مقدارش عوض می‌شود؛ اگر نباشد، یک جفتِ جدید ساخته می‌شود.",
      "predict": {
        "sql": "d = {\"x\": 1}\nd[\"y\"] = 2\nprint(len(d))",
        "question": "خروجی چیست؟",
        "choices": [
          "1",
          "2",
          "3"
        ],
        "answer": 1,
        "why": "بعد از افزودنِ کلیدِ `\"y\"`، دیکشنری دو جفت دارد، پس `len` مقدار `2` می‌دهد."
      },
      "example": {
        "sql": "score = {}\nscore[\"Ali\"] = 18\nprint(score)",
        "note": "از دیکشنری خالی شروع و یک جفت اضافه شد."
      },
      "cheat": {
        "syntax": "dict[\"key\"] = value",
        "note": "افزودن یا تغییرِ یک جفت."
      }
    },
    {
      "id": "m08-loop",
      "title": "پیمایش دیکشنری",
      "card": "با حلقهٔ `for` روی **کلیدها** حرکت می‌کنی و با هر کلید به مقدارش می‌رسی:\n\n```python\nperson = {\"name\": \"Sara\", \"age\": 20}\nfor key in person:\n    print(key, person[key])\n```\n\nهمچنین می‌توانی با `.get(\"key\")` یک مقدار را امن بگیری؛ اگر کلید نبود به‌جای خطا مقدارِ `None` می‌دهد.",
      "predict": {
        "sql": "d = {\"a\": 1, \"b\": 2}\nfor k in d:\n    print(k)",
        "question": "چه چیزی چاپ می‌شود؟",
        "choices": [
          "1 و 2",
          "a و b",
          "a:1 و b:2"
        ],
        "answer": 1,
        "why": "حلقه روی **کلیدها** حرکت می‌کند، پس `a` و `b` چاپ می‌شوند."
      },
      "example": {
        "sql": "ages = {\"Ali\": 17, \"Reza\": 20}\nfor name in ages:\n    print(name, ages[name])",
        "note": "هر کلید همراه مقدارش چاپ می‌شود."
      },
      "cheat": {
        "syntax": "for key in dict:",
        "note": "روی کلیدها حرکت می‌کند."
      }
    },
    {
      "id": "m08-others",
      "title": "اشاره‌ای به tuple و set",
      "card": "دو ساختارِ دیگر که خوب است بشناسی:\n\n- **`tuple`** مثل لیست است ولی داخل `()` و **تغییرناپذیر**: `point = (3, 4)`\n- **`set`** مجموعه‌ای از مقدارهای **یکتا** داخل `{}`: `s = {1, 2, 2, 3}` که می‌شود `{1, 2, 3}`\n\n```python\nnums = {1, 2, 2, 3}\nprint(len(nums))   # 3 (duplicates are removed)\n```\n\nفعلاً فقط بدان که این‌ها هم وجود دارند؛ بعداً بیشتر با آن‌ها کار می‌کنی.",
      "predict": {
        "sql": "print(len({1, 2, 2, 3}))",
        "question": "خروجی چیست؟",
        "choices": [
          "4",
          "3",
          "2"
        ],
        "answer": 1,
        "why": "در یک `set` مقدارهای تکراری حذف می‌شوند، پس فقط ۱، ۲ و ۳ می‌مانند: `3`."
      },
      "example": {
        "sql": "point = (10, 20)\nprint(point[0])",
        "note": "tuple هم مثل لیست ایندکس دارد: اولین عضو ۱۰."
      },
      "cheat": {
        "syntax": "(a, b) · {a, b}",
        "note": "تاپل تغییرناپذیر · مجموعهٔ یکتا."
      }
    }
  ],
  "practice": [
    {
      "id": "m08-p1",
      "conceptIds": [
        "m08-make"
      ],
      "prompt": "یک دیکشنری بساز که کلیدِ `\"name\"` مقدارِ یک نام داشته باشد و فقط آن نام را چاپ کن.",
      "explanation": "با کلیدِ `\"name\"` به مقدارش رسیدی و چاپش کردی.",
      "hints": [
        "دیکشنری را با `{\"name\": \"...\"}` بساز.",
        "بعد `person[\"name\"]` را چاپ کن."
      ],
      "kind": "write",
      "solution": "person = {\"name\": \"Sara\"}\nprint(person[\"name\"])",
      "python": {
        "nonEmpty": true
      }
    },
    {
      "id": "m08-p2",
      "conceptIds": [
        "m08-edit"
      ],
      "prompt": "بدون اجرا حدس بزن خروجی چیست.",
      "explanation": "مقدارِ کلیدِ `\"x\"` برابر `10` است.",
      "hints": [
        "کلیدِ \"x\" به چه مقداری اشاره می‌کند؟"
      ],
      "kind": "readQuery",
      "sql": "d = {\"x\": 10, \"y\": 20}\nprint(d[\"x\"])",
      "choices": [
        "x",
        "10",
        "20"
      ],
      "answer": 1
    },
    {
      "id": "m08-p3",
      "conceptIds": [
        "m08-loop"
      ],
      "prompt": "جای خالی را پر کن تا کلیدِ جدیدِ `\"age\"` با مقدارِ ۲۵ اضافه شود.",
      "explanation": "`p[\"age\"] = 25` یک جفتِ جدید به دیکشنری اضافه می‌کند.",
      "hints": [
        "برای افزودن کلید از `p[\"age\"] = ...` استفاده کن."
      ],
      "kind": "fillBlank",
      "starterSql": "p = {\"name\": \"Reza\"}\np___ = 25\nprint(p)",
      "solution": "p = {\"name\": \"Reza\"}\np[\"age\"] = 25\nprint(p)"
    },
    {
      "id": "m08-p4",
      "conceptIds": [
        "m08-others"
      ],
      "prompt": "دیکشنری `{\"a\": 1, \"b\": 2}` را بساز و با حلقه فقط کلیدها را چاپ کن.",
      "explanation": "حلقه روی کلیدهای دیکشنری حرکت می‌کند و هر کلید را چاپ می‌کند.",
      "hints": [
        "از `for k in d:` استفاده کن."
      ],
      "kind": "write",
      "solution": "d = {\"a\": 1, \"b\": 2}\nfor k in d:\n    print(k)"
    },
    {
      "id": "m08-p5",
      "conceptIds": [
        "m08-make"
      ],
      "prompt": "این کد باید مقدارِ کلیدِ `\"age\"` را چاپ کند ولی اشتباه نوشته شده. درستش کن.",
      "explanation": "دسترسی به مقدارِ دیکشنری با کروشه است: `p[\"age\"]`.",
      "hints": [
        "برای گرفتن مقدار از `[]` استفاده می‌شود، نه `()`."
      ],
      "kind": "fixBug",
      "starterSql": "p = {\"age\": 30}\nprint(p(\"age\"))",
      "solution": "p = {\"age\": 30}\nprint(p[\"age\"])"
    },
    {
      "id": "m08-p6",
      "conceptIds": [
        "m08-edit"
      ],
      "prompt": "خطوط را مرتب کن تا از دیکشنری خالی شروع شود، یک جفت اضافه شود و چاپ شود.",
      "explanation": "نمی‌توان به دیکشنریِ ساخته‌نشده کلید اضافه کرد؛ پس `scores = {}` باید اول باشد.",
      "hints": [
        "اول دیکشنری را بساز، بعد به آن اضافه کن."
      ],
      "kind": "parsons",
      "blocks": [
        "scores = {}",
        "scores[\"Ali\"] = 18",
        "print(scores)"
      ],
      "wrongOrder": [
        "scores[\"Ali\"] = 18",
        "scores = {}",
        "print(scores)"
      ],
      "distractors": [
        "scores[\"Ali\"]"
      ]
    }
  ],
  "test": [
    {
      "id": "m08-t1",
      "conceptIds": [
        "m08-make"
      ],
      "prompt": "خروجی این کد چیست؟",
      "explanation": "با کلیدِ `\"city\"` مقدارش یعنی «Tehran» گرفته می‌شود.",
      "hints": [],
      "kind": "readQuery",
      "sql": "d = {\"city\": \"Tehran\"}\nprint(d[\"city\"])",
      "choices": [
        "city",
        "Tehran",
        "خطا"
      ],
      "answer": 1
    },
    {
      "id": "m08-t2",
      "conceptIds": [
        "m08-edit"
      ],
      "prompt": "دیکشنریِ `{\"a\": 1}` را بساز، کلیدِ `\"b\"` با مقدارِ ۲ اضافه کن و تعداد جفت‌ها را چاپ کن (باید ۲ شود).",
      "explanation": "بعد از افزودنِ `\"b\"` دیکشنری دو جفت دارد، پس `len` می‌شود ۲.",
      "hints": [],
      "kind": "write",
      "solution": "d = {\"a\": 1}\nd[\"b\"] = 2\nprint(len(d))"
    },
    {
      "id": "m08-t3",
      "conceptIds": [
        "m08-loop"
      ],
      "prompt": "خروجی این کد چیست؟",
      "explanation": "در یک `set` مقدار تکراری حذف می‌شود، پس فقط ۵ و ۶ می‌مانند: ۲.",
      "hints": [],
      "kind": "readQuery",
      "sql": "print(len({5, 5, 6}))",
      "choices": [
        "3",
        "2",
        "1"
      ],
      "answer": 1
    },
    {
      "id": "m08-t4",
      "conceptIds": [
        "m08-others"
      ],
      "prompt": "جای خالی را پر کن تا مقدارِ کلیدِ `\"name\"` چاپ شود.",
      "explanation": "کلید باید داخل گیومه و کروشه باشد: `p[\"name\"]`.",
      "hints": [],
      "kind": "fillBlank",
      "starterSql": "p = {\"name\": \"Ava\", \"age\": 19}\nprint(p[___])",
      "solution": "p = {\"name\": \"Ava\", \"age\": 19}\nprint(p[\"name\"])"
    },
    {
      "id": "m08-t5",
      "conceptIds": [
        "m08-make"
      ],
      "prompt": "دیکشنریِ `{\"Ali\": 17, \"Reza\": 20}` را بساز و با حلقه هر کلید را همراه مقدارش چاپ کن.",
      "explanation": "حلقه روی کلیدها حرکت می‌کند و با `ages[name]` به هر مقدار می‌رسی.",
      "hints": [],
      "kind": "write",
      "solution": "ages = {\"Ali\": 17, \"Reza\": 20}\nfor name in ages:\n    print(name, ages[name])"
    }
  ],
  "games": [
    "outputPredictor"
  ]
};
