import type { Module } from '../../../content/types';

// Ported from the standalone pyschool course. Persian lesson content; code is Python.
export const p04: Module = {
  "id": "p04",
  "number": 4,
  "title": "اعداد و ورودی",
  "tagline": "با عددها حساب کن، باقی‌مانده بگیر و از کاربر ورودی بخوان.",
  "concepts": [
    {
      "id": "m04-ops",
      "title": "عملگرهای ریاضی",
      "card": "پایتون یک ماشین‌حساب قوی است:\n\n```python\nprint(7 + 2)   # addition → 9\nprint(7 - 2)   # subtraction → 5\nprint(7 * 2)   # multiplication → 14\nprint(7 / 2)   # division → 3.5\n```\n\nدقت کن که `/` همیشه یک عدد **اعشاری** (float) می‌دهد؛ حتی `4 / 2` می‌شود `2.0`.",
      "predict": {
        "sql": "print(10 / 2)",
        "question": "خروجی چیست؟",
        "choices": [
          "5",
          "5.0",
          "2"
        ],
        "answer": 1,
        "why": "عملگر `/` همیشه نتیجهٔ اعشاری می‌دهد، پس `5.0` چاپ می‌شود نه `5`."
      },
      "example": {
        "sql": "print(3 + 4 * 2)",
        "note": "اول ضرب، بعد جمع: نتیجه 11."
      },
      "cheat": {
        "syntax": "+  -  *  /",
        "note": "جمع، تفریق، ضرب، تقسیم (/ همیشه اعشاری)."
      }
    },
    {
      "id": "m04-divmod",
      "title": "تقسیم صحیح و باقی‌مانده",
      "card": "دو عملگر خیلی کاربردی:\n\n- **`//`** تقسیمِ صحیح: فقط بخش کامل را می‌دهد. `17 // 5` → `3`\n- **`%`** باقی‌مانده: چیزی که از تقسیم می‌ماند. `17 % 5` → `2`\n\n```python\nprint(17 // 5)   # 3\nprint(17 % 5)    # 2\n```\n\nمثلاً با `% 2` می‌فهمی یک عدد زوج است یا فرد (زوج‌ها باقی‌ماندهٔ ۰ دارند).",
      "predict": {
        "sql": "print(9 % 2)",
        "question": "باقی‌ماندهٔ ۹ بر ۲ چند است؟",
        "choices": [
          "4",
          "1",
          "0"
        ],
        "answer": 1,
        "why": "۹ تقسیم بر ۲ می‌شود ۴ با باقی‌ماندهٔ ۱؛ پس `%` مقدار `1` می‌دهد."
      },
      "example": {
        "sql": "print(20 // 3)\nprint(20 % 3)",
        "note": "بخش صحیح ۶ و باقی‌مانده ۲."
      },
      "cheat": {
        "syntax": "//  ·  %",
        "note": "تقسیم صحیح · باقی‌مانده."
      }
    },
    {
      "id": "m04-input",
      "title": "خواندن ورودی با input",
      "card": "با `input()` می‌توانی از کاربر چیزی بپرسی. متنی که کاربر می‌نویسد برمی‌گردد و معمولاً در یک متغیر ذخیره‌اش می‌کنیم:\n\n```python\nname = input(\"What is your name? \")\nprint(\"Hello \" + name)\n```\n\n**نکتهٔ مهم:** `input()` همیشه یک **رشته (متن)** برمی‌گرداند، حتی اگر کاربر عدد بنویسد.",
      "predict": {
        "sql": "x = input()\nprint(type(x))",
        "question": "نوعِ چیزی که input می‌دهد چیست؟",
        "choices": [
          "<class 'int'>",
          "<class 'str'>",
          "<class 'float'>"
        ],
        "answer": 1,
        "why": "`input()` همیشه متن (str) برمی‌گرداند، حتی وقتی کاربر عدد تایپ کند."
      },
      "example": {
        "sql": "city = input(\"Your city? \")\nprint(city)",
        "note": "هر چه بنویسی همان چاپ می‌شود."
      },
      "cheat": {
        "syntax": "x = input(\"message\")",
        "note": "یک متن از کاربر می‌گیرد."
      }
    },
    {
      "id": "m04-convert",
      "title": "تبدیل نوع",
      "card": "چون `input()` متن می‌دهد، برای محاسبه باید آن را به عدد **تبدیل** کنی:\n\n```python\nage = int(input(\"Your age? \"))\nprint(age + 1)\n```\n\n- `int(...)` متن را به عدد صحیح تبدیل می‌کند.\n- `float(...)` به عدد اعشاری.\n- `str(...)` یک عدد را به متن.\n\nاگر `\"5\" + 1` بنویسی خطا می‌گیری، ولی `int(\"5\") + 1` می‌شود `6`.",
      "predict": {
        "sql": "print(int(\"3\") + 2)",
        "question": "خروجی چیست؟",
        "choices": [
          "32",
          "5",
          "خطا"
        ],
        "answer": 1,
        "why": "`int(\"3\")` رشته را به عددِ ۳ تبدیل می‌کند، پس `3 + 2` می‌شود `5`."
      },
      "example": {
        "sql": "n = int(\"10\")\nprint(n * 2)",
        "note": "بعد از تبدیل، مثل یک عدد عادی با آن حساب می‌کنی."
      },
      "cheat": {
        "syntax": "int(x) · float(x) · str(x)",
        "note": "تبدیل بین متن و عدد."
      }
    }
  ],
  "practice": [
    {
      "id": "m04-p1",
      "conceptIds": [
        "m04-ops"
      ],
      "prompt": "حاصلِ `48 / 5` را چاپ کن و ببین اعشاری است.",
      "explanation": "`/` نتیجهٔ اعشاری می‌دهد: `9.6`.",
      "hints": [
        "فقط `print(48 / 5)`"
      ],
      "kind": "write",
      "solution": "print(48 / 5)"
    },
    {
      "id": "m04-p2",
      "conceptIds": [
        "m04-divmod"
      ],
      "prompt": "بدون اجرا حدس بزن خروجی چیست.",
      "explanation": "۱۳ تقسیم بر ۴ می‌شود ۳ با باقی‌مانده؛ `//` فقط `3` را می‌دهد.",
      "hints": [
        "`//` فقط بخش کامل را می‌دهد."
      ],
      "kind": "readQuery",
      "sql": "print(13 // 4)",
      "choices": [
        "3.25",
        "3",
        "1"
      ],
      "answer": 1
    },
    {
      "id": "m04-p3",
      "conceptIds": [
        "m04-input"
      ],
      "prompt": "جای خالی را پر کن تا باقی‌ماندهٔ تقسیمِ ۱۰ بر ۳ چاپ شود.",
      "explanation": "`10 % 3` برابر `1` است (باقی‌ماندهٔ تقسیم).",
      "hints": [
        "عملگر باقی‌مانده `%` است."
      ],
      "kind": "fillBlank",
      "starterSql": "print(10 ___ 3)",
      "solution": "print(10 % 3)"
    },
    {
      "id": "m04-p4",
      "conceptIds": [
        "m04-convert"
      ],
      "prompt": "یک نام از کاربر بگیر و با `print` جملهٔ «Hello <name>» را چاپ کن. (برای آزمایش، ورودی «Negar» داده می‌شود.)",
      "explanation": "`input()` متن کاربر را می‌دهد و تو آن را به Hello چسباندی.",
      "hints": [
        "ورودی را در متغیر بگیر: `name = input()`",
        "بعد با `+` به «Hello » بچسبان."
      ],
      "kind": "write",
      "solution": "name = input()\nprint(\"Hello \" + name)",
      "python": {
        "stdin": "Negar"
      }
    },
    {
      "id": "m04-p5",
      "conceptIds": [
        "m04-ops"
      ],
      "prompt": "این کد باید عددِ ورودی را با ۱ جمع کند، ولی خطا می‌دهد. درستش کن. (ورودی آزمایش: ۵)",
      "explanation": "نمی‌توان متن را با عدد جمع کرد؛ با `int(input())` اول به عدد تبدیل می‌کنیم.",
      "hints": [
        "`input` متن می‌دهد؛ برای جمع باید به عدد تبدیلش کنی.",
        "از `int(...)` استفاده کن."
      ],
      "kind": "fixBug",
      "starterSql": "n = input()\nprint(n + 1)",
      "solution": "n = int(input())\nprint(n + 1)",
      "python": {
        "stdin": "5"
      }
    },
    {
      "id": "m04-p6",
      "conceptIds": [
        "m04-divmod"
      ],
      "prompt": "خطوط را مرتب کن تا عددِ ورودی گرفته، دو برابر شده و چاپ شود.",
      "explanation": "باید اول `n` ساخته شود تا بتوانی در خط بعد از آن استفاده کنی.",
      "hints": [
        "اول ورودی را بگیر و تبدیل کن، بعد محاسبه."
      ],
      "kind": "parsons",
      "blocks": [
        "n = int(input())",
        "print(n * 2)"
      ],
      "wrongOrder": [
        "print(n * 2)",
        "n = int(input())"
      ],
      "distractors": [
        "print(n * 2)  # before getting n"
      ],
      "python": {
        "stdin": "6"
      }
    }
  ],
  "test": [
    {
      "id": "m04-t1",
      "conceptIds": [
        "m04-ops"
      ],
      "prompt": "خروجی این کد چیست؟",
      "explanation": "`/` همیشه نتیجهٔ اعشاری می‌دهد، پس `4.0`.",
      "hints": [],
      "kind": "readQuery",
      "sql": "print(8 / 2)",
      "choices": [
        "4",
        "4.0",
        "2"
      ],
      "answer": 1
    },
    {
      "id": "m04-t2",
      "conceptIds": [
        "m04-divmod"
      ],
      "prompt": "خروجی این کد چیست؟",
      "explanation": "۷ بر ۳ می‌شود ۲ با باقی‌ماندهٔ ۱؛ پس `%` مقدار `1`.",
      "hints": [],
      "kind": "readQuery",
      "sql": "print(7 % 3)",
      "choices": [
        "2",
        "1",
        "3"
      ],
      "answer": 1
    },
    {
      "id": "m04-t3",
      "conceptIds": [
        "m04-input"
      ],
      "prompt": "عددِ ورودی را بگیر، آن را به `int` تبدیل کن و سه برابرش را چاپ کن. (ورودی آزمایش: ۴)",
      "explanation": "با `int(input())` عدد گرفتی و `n * 3` را چاپ کردی؛ برای ۴ می‌شود ۱۲.",
      "hints": [],
      "kind": "write",
      "solution": "n = int(input())\nprint(n * 3)",
      "python": {
        "stdin": "4"
      }
    },
    {
      "id": "m04-t4",
      "conceptIds": [
        "m04-convert"
      ],
      "prompt": "جای خالی را پر کن تا رشتهٔ `\"7\"` به عدد تبدیل و با ۳ جمع شود.",
      "explanation": "`int(\"7\")` برابر عددِ ۷ است، پس نتیجه `10` می‌شود.",
      "hints": [],
      "kind": "fillBlank",
      "starterSql": "print(___(\"7\") + 3)",
      "solution": "print(int(\"7\") + 3)"
    },
    {
      "id": "m04-t5",
      "conceptIds": [
        "m04-ops"
      ],
      "prompt": "خروجی این کد چیست؟",
      "explanation": "`//` فقط بخش کامل را می‌دهد: `2`.",
      "hints": [],
      "kind": "readQuery",
      "sql": "print(25 // 10)",
      "choices": [
        "2.5",
        "2",
        "5"
      ],
      "answer": 1
    }
  ],
  "games": [
    "outputPredictor"
  ]
};
