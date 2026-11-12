import type { Module } from '../../../content/types';

// Ported from the standalone pyschool course. Persian lesson content; code is Python.
export const p01: Module = {
  "id": "p01",
  "number": 1,
  "title": "اولین قدم‌ها",
  "tagline": "اولین برنامه‌ات را بنویس: چیزی چاپ کن، کامنت بگذار و یاد بگیر پیام خطا را بخوانی.",
  "concepts": [
    {
      "id": "m01-print",
      "title": "چاپ کردن با print",
      "card": "در پایتون برای نشان‌دادن چیزی روی صفحه از دستور `print()` استفاده می‌کنیم.\n\n```python\nprint(\"Hello, world!\")\n```\n\nهر چیزی که داخل **گیومه** بگذاری یک **رشته** (متن) است و عیناً چاپ می‌شود. می‌توانی از گیومهٔ دوتایی `\"...\"` یا تکی `'...'` استفاده کنی؛ فرقی نمی‌کند.",
      "predict": {
        "sql": "print(\"2 + 2\")",
        "question": "به نظرت چه چیزی چاپ می‌شود؟",
        "choices": [
          "4",
          "2 + 2",
          "خطا می‌دهد"
        ],
        "answer": 1,
        "why": "چون `2 + 2` داخل گیومه است، یک **رشته** محسوب می‌شود نه یک محاسبه؛ پس خود متن چاپ می‌شود."
      },
      "example": {
        "sql": "print(\"Welcome to Python school!\")",
        "note": "دکمهٔ اجرا را بزن و خروجی را ببین."
      },
      "cheat": {
        "syntax": "print(\"text\")",
        "note": "متن داخل گیومه را روی صفحه چاپ می‌کند."
      }
    },
    {
      "id": "m01-numbers",
      "title": "چاپ عدد و محاسبه",
      "card": "اگر چیزی را **بدون گیومه** بنویسی، پایتون آن را یک **عدد یا محاسبه** می‌بیند و نتیجه را حساب می‌کند:\n\n```python\nprint(2 + 3)   # prints: 5\nprint(10 - 4)  # prints: 6\n```\n\nپس `\"2 + 3\"` با گیومه می‌شود متنِ «2 + 3»، ولی `2 + 3` بدون گیومه می‌شود عددِ `5`.",
      "predict": {
        "sql": "print(3 * 4)",
        "question": "خروجی چیست؟",
        "choices": [
          "3 * 4",
          "12",
          "34"
        ],
        "answer": 1,
        "why": "بدون گیومه، `3 * 4` یک محاسبه است؛ پس پایتون حاصل‌ضرب یعنی `12` را چاپ می‌کند. (`*` یعنی ضرب.)"
      },
      "example": {
        "sql": "print(100 + 50)\nprint(9 * 9)",
        "note": "هر print یک محاسبه را حساب و چاپ می‌کند."
      },
      "cheat": {
        "syntax": "print(2 + 3)",
        "note": "بدون گیومه = محاسبه. عملگرها: + - * /"
      }
    },
    {
      "id": "m01-lines",
      "title": "چند خط خروجی",
      "card": "هر `print()` خروجی‌اش را در یک **خط جدا** چاپ می‌کند:\n\n```python\nprint(\"First line\")\nprint(\"Second line\")\n```\n\nنتیجه دو خط می‌شود. دستورها از **بالا به پایین** و به ترتیب اجرا می‌شوند.",
      "predict": {
        "sql": "print(\"a\")\nprint(\"b\")\nprint(\"c\")",
        "question": "چند خط چاپ می‌شود؟",
        "choices": [
          "۱ خط",
          "۳ خط",
          "۰ خط"
        ],
        "answer": 1,
        "why": "هر `print` یک خط جدا می‌سازد، پس سه `print` یعنی سه خط: a، b و c."
      },
      "example": {
        "sql": "print(\"One\")\nprint(\"Two\")\nprint(\"Three\")",
        "note": "سه خط، به همان ترتیبی که نوشته شده."
      },
      "cheat": {
        "syntax": "print(...)\nprint(...)",
        "note": "هر print یک خط جدید."
      }
    },
    {
      "id": "m01-comments",
      "title": "کامنت‌ها و خطاها",
      "card": "هر چیزی بعد از علامت `#` یک **کامنت** است: پایتون آن را نادیده می‌گیرد. کامنت برای یادداشت و توضیح است:\n\n```python\nprint(\"Hello\")  # This comment is not executed\n```\n\n**خطاها** هم طبیعی‌اند! اگر چیزی را اشتباه بنویسی، پایتون یک پیام خطا می‌دهد. مثلاً اگر گیومه را ببندی فراموش کنی، `SyntaxError` می‌بینی. ترسناک نیست — فقط آخرین خطِ پیام را بخوان؛ معمولاً می‌گوید مشکل کجاست.",
      "predict": {
        "sql": "print(\"Hello\")  # print(\"Goodbye\")",
        "question": "چه چیزی چاپ می‌شود؟",
        "choices": [
          "Hello",
          "Hello and Goodbye",
          "Goodbye"
        ],
        "answer": 0,
        "why": "بخش دوم بعد از `#` کامنت است و اجرا نمی‌شود؛ پس فقط «Hello» چاپ می‌شود."
      },
      "example": {
        "sql": "# This program prints a sum\nprint(5 + 7)",
        "note": "خط اول کامنت است و نادیده گرفته می‌شود."
      },
      "cheat": {
        "syntax": "# A comment",
        "note": "هر چیز بعد از # نادیده گرفته می‌شود."
      }
    }
  ],
  "practice": [
    {
      "id": "m01-p1",
      "conceptIds": [
        "m01-print"
      ],
      "prompt": "برنامه‌ای بنویس که دقیقاً این متن را چاپ کند: **Hello, world!**",
      "explanation": "آفرین! `print(\"Hello, world!\")` متن داخل گیومه را چاپ می‌کند.",
      "hints": [
        "از دستور `print()` استفاده کن.",
        "متن را داخل گیومه بگذار: `print(\"Hello, world!\")`"
      ],
      "kind": "write",
      "solution": "print(\"Hello, world!\")"
    },
    {
      "id": "m01-p2",
      "conceptIds": [
        "m01-numbers"
      ],
      "prompt": "بدون اجرا، حدس بزن خروجی این کد چیست.",
      "explanation": "`7 + 2` بدون گیومه یک جمع است، پس `9` چاپ می‌شود.",
      "hints": [
        "بدون گیومه یعنی محاسبه."
      ],
      "kind": "readQuery",
      "sql": "print(7 + 2)",
      "choices": [
        "7 + 2",
        "9",
        "72"
      ],
      "answer": 1
    },
    {
      "id": "m01-p3",
      "conceptIds": [
        "m01-lines"
      ],
      "prompt": "این کد باید عبارت **Welcome** را چاپ کند، ولی خطا می‌دهد. اشکالش را پیدا کن و درستش کن.",
      "explanation": "متن (رشته) همیشه باید داخل گیومه باشد، وگرنه پایتون آن را یک دستور ناشناخته می‌بیند و خطا می‌دهد.",
      "hints": [
        "متن باید داخل گیومه باشد.",
        "به ابتدا و انتهای متن گیومه اضافه کن: `\"Welcome\"`"
      ],
      "kind": "fixBug",
      "starterSql": "print(Welcome)",
      "solution": "print(\"Welcome\")"
    },
    {
      "id": "m01-p4",
      "conceptIds": [
        "m01-comments"
      ],
      "prompt": "جای خالی را پر کن تا عددِ حاصلِ **۸ ضربدر ۵** چاپ شود.",
      "explanation": "`*` یعنی ضرب، پس `8 * 5` برابر `40` چاپ می‌شود.",
      "hints": [
        "علامت ضرب در پایتون `*` است."
      ],
      "kind": "fillBlank",
      "starterSql": "print(8 ___ 5)",
      "solution": "print(8 * 5)"
    },
    {
      "id": "m01-p5",
      "conceptIds": [
        "m01-print"
      ],
      "prompt": "این دو خط را طوری مرتب کن که اول **Good morning** و بعد **Good night** چاپ شود.",
      "explanation": "ترتیب خطوط مهم است: پایتون آن‌ها را به ترتیب از بالا اجرا می‌کند.",
      "hints": [
        "دستورها از بالا به پایین اجرا می‌شوند؛ پس اولین چیزی که می‌خواهی چاپ شود باید بالاتر باشد."
      ],
      "kind": "parsons",
      "blocks": [
        "print(\"Good morning\")",
        "print(\"Good night\")"
      ],
      "wrongOrder": [
        "print(\"Good night\")",
        "print(\"Good morning\")"
      ],
      "distractors": [
        "print(Good morning)"
      ]
    },
    {
      "id": "m01-p6",
      "conceptIds": [
        "m01-numbers"
      ],
      "prompt": "یک کامنت با متن دلخواه بنویس و در خط بعد عددِ **۱۰۰ منهای ۱** را چاپ کن.",
      "explanation": "کامنت اجرا نمی‌شود؛ فقط `print(100 - 1)` اجرا و `99` چاپ می‌شود.",
      "hints": [
        "خط کامنت با `#` شروع می‌شود.",
        "خط دوم: `print(100 - 1)`"
      ],
      "kind": "write",
      "solution": "# Any comment\nprint(100 - 1)"
    }
  ],
  "test": [
    {
      "id": "m01-t1",
      "conceptIds": [
        "m01-print"
      ],
      "prompt": "نام خودت را به صورت متن چاپ کن (هر نامی که دوست داری).",
      "explanation": "هر متنی داخل گیومه قابل چاپ است — کافی بود چیزی چاپ کنی.",
      "hints": [],
      "kind": "write",
      "solution": "print(\"Parham\")",
      "python": {
        "nonEmpty": true
      }
    },
    {
      "id": "m01-t2",
      "conceptIds": [
        "m01-numbers"
      ],
      "prompt": "خروجی این کد چیست؟",
      "explanation": "خط اول رشتهٔ «5» را چاپ می‌کند و خط دوم عددِ 5 را؛ پس دو خط جدا می‌بینیم.",
      "hints": [],
      "kind": "readQuery",
      "sql": "print(\"5\")\nprint(5)",
      "choices": [
        "دو خط: 5 و 5",
        "یک خط: 55",
        "خطا"
      ],
      "answer": 0
    },
    {
      "id": "m01-t3",
      "conceptIds": [
        "m01-lines"
      ],
      "prompt": "این کد باید عددِ ۲۰ را چاپ کند. درستش کن.",
      "explanation": "علامت ضرب در پایتون حرف `x` نیست، بلکه `*` است.",
      "hints": [],
      "kind": "fixBug",
      "starterSql": "print(4 x 5)",
      "solution": "print(4 * 5)"
    },
    {
      "id": "m01-t4",
      "conceptIds": [
        "m01-comments"
      ],
      "prompt": "جای خالی را پر کن تا متنِ **Done** چاپ شود.",
      "explanation": "متن باید داخل گیومه باشد: `\"Done\"`.",
      "hints": [],
      "kind": "fillBlank",
      "starterSql": "print(___)",
      "solution": "print(\"Done\")"
    },
    {
      "id": "m01-t5",
      "conceptIds": [
        "m01-print"
      ],
      "prompt": "خروجی این کد چیست؟",
      "explanation": "بخش بعد از `#` کامنت است و اجرا نمی‌شود؛ پس فقط `10` چاپ می‌شود.",
      "hints": [],
      "kind": "readQuery",
      "sql": "print(6 + 4)  # print(0)",
      "choices": [
        "10",
        "0",
        "10 و 0"
      ],
      "answer": 0
    }
  ],
  "games": [
    "outputPredictor"
  ]
};
