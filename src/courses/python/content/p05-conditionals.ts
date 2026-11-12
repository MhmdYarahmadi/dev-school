import type { Module } from '../../../content/types';

// Ported from the standalone pyschool course. Persian lesson content; code is Python.
export const p05: Module = {
  "id": "p05",
  "number": 5,
  "title": "تصمیم‌گیری",
  "tagline": "به برنامه‌ات یاد بده بر اساس شرایط تصمیم بگیرد.",
  "concepts": [
    {
      "id": "m05-if",
      "title": "دستور if",
      "card": "با `if` می‌توانی کاری را فقط **در صورت درست‌بودن یک شرط** انجام دهی. دقت کن به دو نکته: دو نقطه `:` در انتهای خط، و **تورفتگی** (چهار فاصله) در خط بعد:\n\n```python\nage = 20\nif age >= 18:\n    print(\"بزرگسال\")\n```\n\nاگر شرط درست باشد، خطِ تورفته اجرا می‌شود؛ اگر نه، نادیده گرفته می‌شود.",
      "predict": {
        "sql": "x = 5\nif x > 3:\n    print(\"بزرگ\")",
        "question": "چه چیزی چاپ می‌شود؟",
        "choices": [
          "چیزی چاپ نمی‌شود",
          "بزرگ",
          "خطا"
        ],
        "answer": 1,
        "why": "چون `5 > 3` درست است، خطِ تورفته اجرا می‌شود و «بزرگ» چاپ می‌شود."
      },
      "example": {
        "sql": "n = 10\nif n > 0:\n    print(\"عددِ مثبت\")",
        "note": "شرط درست است، پس پیام چاپ می‌شود."
      },
      "cheat": {
        "syntax": "if شرط:\n    کار",
        "note": "اگر شرط درست بود، بلوک تورفته اجرا می‌شود."
      }
    },
    {
      "id": "m05-compare",
      "title": "مقایسه‌ها",
      "card": "برای ساختن شرط از عملگرهای مقایسه استفاده می‌کنیم:\n\n- `==` مساوی (دقت کن دوتا مساوی!)\n- `!=` نامساوی\n- `>` و `<` بزرگ‌تر و کوچک‌تر\n- `>=` و `<=` بزرگ‌تر-مساوی و کوچک‌تر-مساوی\n\n```python\nprint(5 == 5)   # True\nprint(5 != 3)   # True\nprint(2 > 9)    # False\n```\n\nنتیجهٔ هر مقایسه یک مقدار `bool` است: `True` یا `False`.",
      "predict": {
        "sql": "print(7 == 7)",
        "question": "خروجی چیست؟",
        "choices": [
          "7",
          "True",
          "False"
        ],
        "answer": 1,
        "why": "`==` بررسی می‌کند دو مقدار برابرند؛ ۷ با ۷ برابر است پس `True`."
      },
      "example": {
        "sql": "print(3 >= 3)\nprint(3 > 3)",
        "note": "اولی True (مساوی هم قبول است)، دومی False."
      },
      "cheat": {
        "syntax": "==  !=  >  <  >=  <=",
        "note": "نتیجه همیشه True یا False."
      }
    },
    {
      "id": "m05-else",
      "title": "else و elif",
      "card": "با `else` کاری را برای وقتی شرط **غلط** است تعیین می‌کنی، و با `elif` می‌توانی چند شرط را پشت سر هم بررسی کنی:\n\n```python\nscore = 75\nif score >= 90:\n    print(\"عالی\")\nelif score >= 60:\n    print(\"قبول\")\nelse:\n    print(\"مردود\")\n```\n\nپایتون از بالا شرط‌ها را بررسی می‌کند و **اولین** شرطِ درست را اجرا می‌کند و بقیه را رد می‌کند.",
      "predict": {
        "sql": "n = 0\nif n > 0:\n    print(\"مثبت\")\nelse:\n    print(\"مثبت نیست\")",
        "question": "چه چیزی چاپ می‌شود؟",
        "choices": [
          "مثبت",
          "مثبت نیست",
          "هر دو"
        ],
        "answer": 1,
        "why": "`0 > 0` غلط است، پس بلوکِ `else` اجرا می‌شود."
      },
      "example": {
        "sql": "x = 50\nif x >= 60:\n    print(\"قبول\")\nelse:\n    print(\"مردود\")",
        "note": "شرط غلط است، پس else اجرا می‌شود."
      },
      "cheat": {
        "syntax": "if … elif … else …",
        "note": "اولین شرطِ درست اجرا می‌شود."
      }
    },
    {
      "id": "m05-logic",
      "title": "and / or / not",
      "card": "برای ترکیب چند شرط از این سه کلمه استفاده می‌کنیم:\n\n- `and` هر دو شرط باید درست باشند.\n- `or` کافی است یکی درست باشد.\n- `not` درست را غلط می‌کند و برعکس.\n\n```python\nage = 20\nif age >= 18 and age < 65:\n    print(\"بزرگسال\")\n```\n\nاین‌جا هر دو شرط درست‌اند، پس پیام چاپ می‌شود.",
      "predict": {
        "sql": "print(True and False)",
        "question": "خروجی چیست؟",
        "choices": [
          "True",
          "False",
          "خطا"
        ],
        "answer": 1,
        "why": "`and` وقتی `True` می‌دهد که **هر دو** طرف درست باشند؛ اینجا یکی غلط است پس `False`."
      },
      "example": {
        "sql": "x = 5\nprint(x > 0 or x > 100)",
        "note": "کافی است یکی درست باشد؛ x>0 درست است پس True."
      },
      "cheat": {
        "syntax": "and · or · not",
        "note": "ترکیب و وارونه‌کردنِ شرط‌ها."
      }
    }
  ],
  "practice": [
    {
      "id": "m05-p1",
      "conceptIds": [
        "m05-if"
      ],
      "prompt": "عددِ ۱۲ را در متغیری بگذار و اگر از ۱۰ بزرگ‌تر بود، متنِ «بزرگ» را چاپ کن.",
      "explanation": "شرط `12 > 10` درست است، پس «بزرگ» چاپ می‌شود.",
      "hints": [
        "ساختار: `if n > 10:` و خطِ بعد تورفته.",
        "یادت نرود `:` و چهار فاصله."
      ],
      "kind": "write",
      "solution": "n = 12\nif n > 10:\n    print(\"بزرگ\")"
    },
    {
      "id": "m05-p2",
      "conceptIds": [
        "m05-compare"
      ],
      "prompt": "بدون اجرا حدس بزن خروجی چیست.",
      "explanation": "`4 % 2` برابر ۰ است و `0 == 0` درست، پس «زوج» چاپ می‌شود.",
      "hints": [
        "`x % 2` برای عددِ زوج چند می‌شود؟"
      ],
      "kind": "readQuery",
      "sql": "x = 4\nif x % 2 == 0:\n    print(\"زوج\")\nelse:\n    print(\"فرد\")",
      "choices": [
        "زوج",
        "فرد",
        "چیزی چاپ نمی‌شود"
      ],
      "answer": 0
    },
    {
      "id": "m05-p3",
      "conceptIds": [
        "m05-else"
      ],
      "prompt": "جای خالی را پر کن تا فقط وقتی دو مقدار **برابر** بودند، «برابر» چاپ شود.",
      "explanation": "یک `=` برای ذخیره است؛ برای مقایسهٔ برابری `==` به کار می‌رود.",
      "hints": [
        "برای بررسی برابری از `==` استفاده کن (دوتا مساوی)."
      ],
      "kind": "fillBlank",
      "starterSql": "a = 5\nb = 5\nif a ___ b:\n    print(\"برابر\")",
      "solution": "a = 5\nb = 5\nif a == b:\n    print(\"برابر\")"
    },
    {
      "id": "m05-p4",
      "conceptIds": [
        "m05-logic"
      ],
      "prompt": "این کد باید «مثبت» چاپ کند ولی خطا می‌دهد. اشکال تورفتگی/علامت را درست کن.",
      "explanation": "دستور `if` به `:` و بلوکِ تورفته نیاز دارد.",
      "hints": [
        "انتهای خطِ if باید `:` داشته باشد.",
        "خطِ داخل if باید تورفته باشد (چهار فاصله)."
      ],
      "kind": "fixBug",
      "starterSql": "n = 3\nif n > 0\nprint(\"مثبت\")",
      "solution": "n = 3\nif n > 0:\n    print(\"مثبت\")"
    },
    {
      "id": "m05-p5",
      "conceptIds": [
        "m05-if"
      ],
      "prompt": "نمره‌ای را در متغیر `score` با مقدار ۵۵ بگذار؛ اگر ۶۰ یا بیشتر بود «قبول» و در غیر این‌صورت «مردود» چاپ کن.",
      "explanation": "۵۵ کوچک‌تر از ۶۰ است، پس بلوکِ else یعنی «مردود» اجرا می‌شود.",
      "hints": [
        "از `if ... else` استفاده کن.",
        "`score >= 60` را بررسی کن."
      ],
      "kind": "write",
      "solution": "score = 55\nif score >= 60:\n    print(\"قبول\")\nelse:\n    print(\"مردود\")"
    },
    {
      "id": "m05-p6",
      "conceptIds": [
        "m05-compare"
      ],
      "prompt": "خطوط را مرتب کن تا اگر عدد منفی بود «منفی» و وگرنه «منفی نیست» چاپ شود.",
      "explanation": "ترتیب درست: ساختِ متغیر، سپس `if` با بلوک تورفته، سپس `else` با بلوک تورفته.",
      "hints": [
        "اول متغیر را بساز، بعد if و else؛ خطوط چاپ باید تورفته باشند."
      ],
      "kind": "parsons",
      "blocks": [
        "n = -3",
        "if n < 0:",
        "    print(\"منفی\")",
        "else:",
        "    print(\"منفی نیست\")"
      ],
      "wrongOrder": [
        "if n < 0:",
        "n = -3",
        "    print(\"منفی\")",
        "else:",
        "    print(\"منفی نیست\")"
      ],
      "distractors": [
        "print(\"منفی\")"
      ]
    }
  ],
  "test": [
    {
      "id": "m05-t1",
      "conceptIds": [
        "m05-if"
      ],
      "prompt": "خروجی این کد چیست؟",
      "explanation": "`!=` یعنی نامساوی؛ ۱۰ با ۱۰ برابر است پس نتیجه `False`.",
      "hints": [],
      "kind": "readQuery",
      "sql": "print(10 != 10)",
      "choices": [
        "True",
        "False",
        "10"
      ],
      "answer": 1
    },
    {
      "id": "m05-t2",
      "conceptIds": [
        "m05-compare"
      ],
      "prompt": "عددِ ۷ را در متغیری بگذار و اگر فرد بود «فرد» چاپ کن (راهنما: `% 2 == 1`).",
      "explanation": "`7 % 2` برابر ۱ است، پس شرط درست و «فرد» چاپ می‌شود.",
      "hints": [],
      "kind": "write",
      "solution": "n = 7\nif n % 2 == 1:\n    print(\"فرد\")"
    },
    {
      "id": "m05-t3",
      "conceptIds": [
        "m05-else"
      ],
      "prompt": "خروجی این کد چیست؟",
      "explanation": "`8 > 10` غلط ولی `8 > 5` درست است، پس اولین شرطِ درست یعنی «ب» اجرا می‌شود.",
      "hints": [],
      "kind": "readQuery",
      "sql": "x = 8\nif x > 10:\n    print(\"الف\")\nelif x > 5:\n    print(\"ب\")\nelse:\n    print(\"ج\")",
      "choices": [
        "الف",
        "ب",
        "ج"
      ],
      "answer": 1
    },
    {
      "id": "m05-t4",
      "conceptIds": [
        "m05-logic"
      ],
      "prompt": "خروجی این کد چیست؟",
      "explanation": "`or` کافی است یک طرف درست باشد؛ اینجا طرف دوم True است پس `True`.",
      "hints": [],
      "kind": "readQuery",
      "sql": "print(False or True)",
      "choices": [
        "True",
        "False",
        "خطا"
      ],
      "answer": 0
    },
    {
      "id": "m05-t5",
      "conceptIds": [
        "m05-if"
      ],
      "prompt": "جای خالی را پر کن تا فقط وقتی هر دو شرط درست بودند پیام چاپ شود.",
      "explanation": "`and` هر دو شرط را لازم می‌کند؛ هر دو درست‌اند پس پیام چاپ می‌شود.",
      "hints": [],
      "kind": "fillBlank",
      "starterSql": "age = 20\nif age >= 18 ___ age < 65:\n    print(\"بزرگسال\")",
      "solution": "age = 20\nif age >= 18 and age < 65:\n    print(\"بزرگسال\")"
    }
  ],
  "games": [
    "outputPredictor"
  ]
};
