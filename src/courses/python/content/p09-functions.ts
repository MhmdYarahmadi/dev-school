import type { Module } from '../../../content/types';

// Ported from the standalone pyschool course. Persian lesson content; code is Python.
export const p09: Module = {
  "id": "p09",
  "number": 9,
  "title": "توابع و پروژهٔ کوچک",
  "tagline": "کدِ خودت را به بسته‌های قابل‌استفادهٔ دوباره تبدیل کن و یک پروژهٔ کوچک بساز.",
  "concepts": [
    {
      "id": "m09-def",
      "title": "تعریف تابع",
      "card": "یک **تابع** یک تکه کدِ نام‌دار است که می‌توانی بارها صدایش بزنی. با `def` تعریف می‌شود:\n\n```python\ndef greet():\n    print(\"Hello\")\n\ngreet()   # call the function\ngreet()\n```\n\nبدنهٔ تابع **تورفته** است. تا وقتی تابع را **صدا نزنی** (با `()`)، کدِ داخلش اجرا نمی‌شود.",
      "predict": {
        "sql": "def hi():\n    print(\"hi\")\n\nhi()\nhi()",
        "question": "«hi» چند بار چاپ می‌شود؟",
        "choices": [
          "۰ بار",
          "۱ بار",
          "۲ بار"
        ],
        "answer": 2,
        "why": "تابع دو بار صدا زده شده (`hi()` دو خط)، پس بدنه‌اش دو بار اجرا می‌شود."
      },
      "example": {
        "sql": "def welcome():\n    print(\"Welcome\")\n\nwelcome()",
        "note": "اول تعریف، بعد صدا زدن با ()."
      },
      "cheat": {
        "syntax": "def name():\n    ...",
        "note": "تعریف تابع؛ صدا زدن با name()"
      }
    },
    {
      "id": "m09-params",
      "title": "پارامتر و ورودی",
      "card": "تابع می‌تواند **ورودی** بگیرد تا هر بار با مقدارِ متفاوتی کار کند. ورودی‌ها را داخل پرانتز می‌نویسی:\n\n```python\ndef greet(name):\n    print(\"Hello \" + name)\n\ngreet(\"Ali\")\ngreet(\"Sara\")\n```\n\nاین‌جا `name` یک **پارامتر** است و هنگام صدا زدن، مقدارش را می‌دهی.",
      "predict": {
        "sql": "def double(x):\n    print(x * 2)\n\ndouble(5)",
        "question": "خروجی چیست؟",
        "choices": [
          "5",
          "10",
          "x * 2"
        ],
        "answer": 1,
        "why": "مقدارِ ۵ به پارامترِ `x` داده می‌شود، پس `x * 2` برابر `10` چاپ می‌شود."
      },
      "example": {
        "sql": "def say(word):\n    print(word)\n\nsay(\"Hello\")",
        "note": "مقدارِ \"Hello\" جای word می‌نشیند."
      },
      "cheat": {
        "syntax": "def f(a, b):",
        "note": "ورودی‌ها را هنگام صدا زدن می‌دهی."
      }
    },
    {
      "id": "m09-return",
      "title": "return؛ پس‌دادن نتیجه",
      "card": "فرق مهم: `print` فقط چیزی را **نشان می‌دهد**، ولی `return` یک مقدار را **پس می‌دهد** تا بتوانی بعداً از آن استفاده کنی:\n\n```python\ndef add(a, b):\n    return a + b\n\nresult = add(3, 4)\nprint(result)   # 7\n```\n\nمقداری که `return` می‌کند در متغیری ذخیره می‌شود. بعد از اجرای `return`، تابع تمام می‌شود.",
      "predict": {
        "sql": "def square(n):\n    return n * n\n\nprint(square(4))",
        "question": "خروجی چیست؟",
        "choices": [
          "8",
          "16",
          "4"
        ],
        "answer": 1,
        "why": "`square(4)` مقدارِ `4 * 4 = 16` را پس می‌دهد و همان چاپ می‌شود."
      },
      "example": {
        "sql": "def plus_one(x):\n    return x + 1\n\nprint(plus_one(9))",
        "note": "نتیجهٔ بازگشتی چاپ می‌شود: ۱۰."
      },
      "cheat": {
        "syntax": "return value",
        "note": "مقدار را پس می‌دهد (با print فرق دارد)."
      }
    },
    {
      "id": "m09-scope",
      "title": "محدودهٔ متغیر (scope)",
      "card": "متغیری که **داخل** یک تابع ساخته می‌شود، فقط همان‌جا زنده است و بیرون شناخته نمی‌شود:\n\n```python\ndef f():\n    inside = 10\n    print(inside)   # works here\n\nf()\n# print(inside)  ← error outside\n```\n\nبه این می‌گویند **محدوده (scope)**. برای این‌که مقداری از تابع بیرون بیاید، آن را `return` کن.",
      "predict": {
        "sql": "def f():\n    x = 5\n    return x\n\nprint(f())",
        "question": "خروجی چیست؟",
        "choices": [
          "5",
          "x",
          "خطا"
        ],
        "answer": 0,
        "why": "تابع مقدارِ `x` یعنی 5 را return می‌کند و بیرون چاپ می‌شود؛ خودِ `x` فقط داخل تابع زنده بود."
      },
      "example": {
        "sql": "def make():\n    msg = \"inside\"\n    return msg\n\nprint(make())",
        "note": "مقدار با return بیرون آمد."
      },
      "cheat": {
        "syntax": "return value",
        "note": "متغیرِ داخلِ تابع بیرون شناخته نمی‌شود."
      }
    }
  ],
  "practice": [
    {
      "id": "m09-p1",
      "conceptIds": [
        "m09-def"
      ],
      "prompt": "تابعی به نام `hello` بنویس که وقتی صدا زده شد، متنِ «Hello» را چاپ کند؛ بعد یک بار صدایش بزن.",
      "explanation": "تابع را تعریف کردی و با `hello()` اجرایش کردی.",
      "hints": [
        "با `def hello():` شروع کن و بدنه را تورفته بنویس.",
        "در آخر `hello()` را صدا بزن."
      ],
      "kind": "write",
      "solution": "def hello():\n    print(\"Hello\")\n\nhello()"
    },
    {
      "id": "m09-p2",
      "conceptIds": [
        "m09-params"
      ],
      "prompt": "تابعی به نام `add` بنویس که دو عدد بگیرد و **مجموعشان را return کند** (چاپ لازم نیست).",
      "explanation": "تابع مجموع را پس می‌دهد تا هر جا لازم شد از نتیجه‌اش استفاده شود.",
      "hints": [
        "دو پارامتر بگیر: `def add(a, b):`",
        "به‌جای print از `return a + b` استفاده کن."
      ],
      "kind": "write",
      "solution": "def add(a, b):\n    return a + b",
      "python": {
        "tests": [
          "assert add(2, 3) == 5",
          "assert add(10, 0) == 10",
          "assert add(-1, 1) == 0"
        ]
      }
    },
    {
      "id": "m09-p3",
      "conceptIds": [
        "m09-return"
      ],
      "prompt": "بدون اجرا حدس بزن خروجی چیست.",
      "explanation": "`triple(4)` برابر `4 * 3 = 12` را return می‌کند.",
      "hints": [
        "`triple(4)` چه مقداری پس می‌دهد؟"
      ],
      "kind": "readQuery",
      "sql": "def triple(n):\n    return n * 3\n\nprint(triple(4))",
      "choices": [
        "7",
        "12",
        "34"
      ],
      "answer": 1
    },
    {
      "id": "m09-p4",
      "conceptIds": [
        "m09-scope"
      ],
      "prompt": "جای خالی را پر کن تا تابع مقدارِ دو برابر را **پس بدهد** (نه چاپ).",
      "explanation": "`return x * 2` مقدار را پس می‌دهد تا بتوان بعداً استفاده کرد.",
      "hints": [
        "برای پس‌دادنِ مقدار از `return` استفاده کن."
      ],
      "kind": "fillBlank",
      "starterSql": "def double(x):\n    ___ x * 2",
      "solution": "def double(x):\n    return x * 2",
      "python": {
        "tests": [
          "assert double(5) == 10",
          "assert double(0) == 0"
        ]
      }
    },
    {
      "id": "m09-p5",
      "conceptIds": [
        "m09-def"
      ],
      "prompt": "این تابع باید مربعِ عدد را پس بدهد ولی به‌جای return از print استفاده کرده و نتیجه‌اش قابل‌استفاده نیست. درستش کن.",
      "explanation": "با `return` مقدار پس داده می‌شود و در آزمون‌ها قابل‌استفاده است.",
      "hints": [
        "`print` فقط نشان می‌دهد؛ برای پس‌دادنِ مقدار `return` لازم است."
      ],
      "kind": "fixBug",
      "starterSql": "def square(n):\n    print(n * n)",
      "solution": "def square(n):\n    return n * n",
      "python": {
        "tests": [
          "assert square(3) == 9",
          "assert square(5) == 25"
        ]
      }
    },
    {
      "id": "m09-p6",
      "conceptIds": [
        "m09-params"
      ],
      "prompt": "تابعی به نام `is_even` بنویس که یک عدد بگیرد و اگر زوج بود `True` و وگرنه `False` را return کند.",
      "explanation": "عبارتِ `n % 2 == 0` برای عددِ زوج True و برای فرد False است؛ همان را پس می‌دهی.",
      "hints": [
        "باقی‌ماندهٔ تقسیم بر ۲ را بررسی کن: `n % 2 == 0`",
        "نتیجهٔ مقایسه خودش True یا False است؛ همان را return کن."
      ],
      "kind": "write",
      "solution": "def is_even(n):\n    return n % 2 == 0",
      "python": {
        "tests": [
          "assert is_even(4) == True",
          "assert is_even(7) == False",
          "assert is_even(0) == True"
        ]
      }
    }
  ],
  "test": [
    {
      "id": "m09-t1",
      "conceptIds": [
        "m09-def"
      ],
      "prompt": "خروجی این کد چیست؟",
      "explanation": "تابع دو بار صدا زده شده، پس «A» دو بار چاپ می‌شود.",
      "hints": [],
      "kind": "readQuery",
      "sql": "def f():\n    print(\"A\")\n\nf()\nf()",
      "choices": [
        "یک بار A",
        "دو بار A",
        "چیزی چاپ نمی‌شود"
      ],
      "answer": 1
    },
    {
      "id": "m09-t2",
      "conceptIds": [
        "m09-params"
      ],
      "prompt": "تابعی به نام `mul` بنویس که دو عدد بگیرد و حاصل‌ضربشان را return کند.",
      "explanation": "تابع دو ورودی می‌گیرد و حاصل‌ضرب را پس می‌دهد.",
      "hints": [],
      "kind": "write",
      "solution": "def mul(a, b):\n    return a * b",
      "python": {
        "tests": [
          "assert mul(3, 4) == 12",
          "assert mul(5, 0) == 0",
          "assert mul(2, 2) == 4"
        ]
      }
    },
    {
      "id": "m09-t3",
      "conceptIds": [
        "m09-return"
      ],
      "prompt": "خروجی این کد چیست؟",
      "explanation": "`add(2, 5)` برابر ۷ است که در `x` ذخیره می‌شود؛ بعد `x + 1` می‌شود ۸.",
      "hints": [],
      "kind": "readQuery",
      "sql": "def add(a, b):\n    return a + b\n\nx = add(2, 5)\nprint(x + 1)",
      "choices": [
        "7",
        "8",
        "25"
      ],
      "answer": 1
    },
    {
      "id": "m09-t4",
      "conceptIds": [
        "m09-scope"
      ],
      "prompt": "تابعی به نام `greet` بنویس که یک نام بگیرد و متنِ «Hello <نام>» را **return** کند.",
      "explanation": "با `return` رشتهٔ ساخته‌شده را پس می‌دهی تا قابل‌استفاده باشد.",
      "hints": [],
      "kind": "write",
      "solution": "def greet(name):\n    return \"Hello \" + name",
      "python": {
        "tests": [
          "assert greet(\"Ali\") == \"Hello Ali\"",
          "assert greet(\"Sara\") == \"Hello Sara\""
        ]
      }
    },
    {
      "id": "m09-t5",
      "conceptIds": [
        "m09-def"
      ],
      "prompt": "پروژهٔ کوچک: تابعی به نام `grade` بنویس که یک نمره بگیرد و اگر ۱۰ یا بیشتر بود `\"Pass\"` و وگرنه `\"Fail\"` را return کند.",
      "explanation": "تابع با یک شرط تصمیم می‌گیرد و رشتهٔ مناسب را پس می‌دهد — ترکیبِ همهٔ چیزهایی که یاد گرفتی!",
      "hints": [
        "داخل تابع از `if ... else` استفاده کن.",
        "در هر شاخه یک رشته return کن."
      ],
      "kind": "write",
      "solution": "def grade(score):\n    if score >= 10:\n        return \"Pass\"\n    else:\n        return \"Fail\"",
      "python": {
        "tests": [
          "assert grade(15) == \"Pass\"",
          "assert grade(10) == \"Pass\"",
          "assert grade(8) == \"Fail\""
        ]
      }
    }
  ],
  "games": [
    "outputPredictor"
  ]
};
