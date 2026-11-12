import type { Module } from '../../../content/types';

// Ported from the standalone pyschool course. Persian lesson content; code is Python.
export const p07: Module = {
  "id": "p07",
  "number": 7,
  "title": "لیست‌ها",
  "tagline": "چند مقدار را کنار هم در یک لیست نگه دار و با آن‌ها کار کن.",
  "concepts": [
    {
      "id": "m07-make",
      "title": "ساخت لیست",
      "card": "یک **لیست** چند مقدار را داخل `[]` و با کاما کنار هم نگه می‌دارد:\n\n```python\nfruits = [\"سیب\", \"موز\", \"پرتقال\"]\nprint(fruits)\n```\n\nعضوها می‌توانند عدد، متن یا هر چیز دیگر باشند. لیست می‌تواند خالی هم باشد: `[]`.",
      "predict": {
        "sql": "nums = [10, 20, 30]\nprint(nums)",
        "question": "خروجی چیست؟",
        "choices": [
          "10 20 30",
          "[10, 20, 30]",
          "60"
        ],
        "answer": 1,
        "why": "وقتی کل لیست را چاپ می‌کنی، پایتون آن را با `[]` و کاما نشان می‌دهد."
      },
      "example": {
        "sql": "colors = [\"قرمز\", \"سبز\"]\nprint(colors)",
        "note": "یک لیست با دو عضو."
      },
      "cheat": {
        "syntax": "[a, b, c]",
        "note": "چند مقدار داخل کروشه با کاما."
      }
    },
    {
      "id": "m07-index",
      "title": "دسترسی با ایندکس",
      "card": "مثل رشته‌ها، هر عضوِ لیست یک **ایندکس** دارد که از `0` شروع می‌شود:\n\n```python\nfruits = [\"سیب\", \"موز\", \"پرتقال\"]\nprint(fruits[0])   # سیب\nprint(fruits[2])   # پرتقال\n```\n\nبا ایندکس می‌توانی عضوی را هم **عوض** کنی: `fruits[1] = \"انگور\"`. ایندکسِ `-1` هم یعنی آخرین عضو.",
      "predict": {
        "sql": "a = [5, 6, 7]\nprint(a[1])",
        "question": "خروجی چیست؟",
        "choices": [
          "5",
          "6",
          "7"
        ],
        "answer": 1,
        "why": "ایندکس از صفر شروع می‌شود، پس `a[1]` عضو دوم یعنی `6` است."
      },
      "example": {
        "sql": "a = [5, 6, 7]\nprint(a[-1])",
        "note": "ایندکسِ -1 آخرین عضو است: ۷."
      },
      "cheat": {
        "syntax": "list[0] · list[-1]",
        "note": "اولین · آخرین عضو."
      }
    },
    {
      "id": "m07-methods",
      "title": "متدها و len",
      "card": "لیست‌ها متدهای مفیدی دارند:\n\n```python\na = [1, 2]\na.append(3)     # اضافه به آخر → [1, 2, 3]\nprint(len(a))   # تعداد عضوها → 3\n```\n\n- `.append(x)` یک عضو به آخرِ لیست اضافه می‌کند.\n- `len(list)` تعداد عضوها را می‌دهد.",
      "predict": {
        "sql": "a = [1, 2, 3]\na.append(4)\nprint(len(a))",
        "question": "خروجی چیست؟",
        "choices": [
          "3",
          "4",
          "10"
        ],
        "answer": 1,
        "why": "بعد از `append(4)` لیست چهار عضو دارد، پس `len` مقدار `4` می‌دهد."
      },
      "example": {
        "sql": "nums = []\nnums.append(5)\nnums.append(9)\nprint(nums)",
        "note": "از لیست خالی شروع و دو عضو اضافه شد."
      },
      "cheat": {
        "syntax": "list.append(x) · len(list)",
        "note": "افزودن به آخر · تعداد عضوها."
      }
    },
    {
      "id": "m07-loop",
      "title": "پیمایش لیست با for",
      "card": "با `for` می‌توانی روی **تک‌تکِ عضوهای** لیست حرکت کنی:\n\n```python\nfruits = [\"سیب\", \"موز\"]\nfor f in fruits:\n    print(f)\n```\n\nدر هر دور، متغیر `f` یک عضوِ لیست را می‌گیرد. این‌جا لازم نیست با ایندکس سروکار داشته باشی.",
      "predict": {
        "sql": "for x in [1, 2, 3]:\n    print(x * 2)",
        "question": "چه چیزی چاپ می‌شود؟",
        "choices": [
          "1 2 3",
          "2 4 6",
          "6"
        ],
        "answer": 1,
        "why": "در هر دور `x` یک عضو است و دو برابرش چاپ می‌شود: ۲، ۴، ۶."
      },
      "example": {
        "sql": "for n in [10, 20, 30]:\n    print(n)",
        "note": "هر عضو در یک خط چاپ می‌شود."
      },
      "cheat": {
        "syntax": "for item in list:",
        "note": "روی تک‌تک عضوها حرکت می‌کند."
      }
    }
  ],
  "practice": [
    {
      "id": "m07-p1",
      "conceptIds": [
        "m07-make"
      ],
      "prompt": "یک لیست با سه عدد ۱، ۲ و ۳ بساز و کلِ لیست را چاپ کن.",
      "explanation": "لیست را ساختی و با `print` کلِ آن را نشان دادی.",
      "hints": [
        "عددها را داخل `[]` و با کاما بنویس."
      ],
      "kind": "write",
      "solution": "nums = [1, 2, 3]\nprint(nums)"
    },
    {
      "id": "m07-p2",
      "conceptIds": [
        "m07-index"
      ],
      "prompt": "بدون اجرا حدس بزن خروجی چیست.",
      "explanation": "`a[0]=x`، `a[1]=y`، `a[2]=z`، پس `z` چاپ می‌شود.",
      "hints": [
        "ایندکس از صفر شروع می‌شود."
      ],
      "kind": "readQuery",
      "sql": "a = [\"x\", \"y\", \"z\"]\nprint(a[2])",
      "choices": [
        "x",
        "y",
        "z"
      ],
      "answer": 2
    },
    {
      "id": "m07-p3",
      "conceptIds": [
        "m07-methods"
      ],
      "prompt": "جای خالی را پر کن تا عددِ ۴ به آخرِ لیست اضافه شود.",
      "explanation": "`a.append(4)` عدد ۴ را به آخرِ لیست اضافه می‌کند.",
      "hints": [
        "متدی که به آخر اضافه می‌کند `append` است."
      ],
      "kind": "fillBlank",
      "starterSql": "a = [1, 2, 3]\na.___(4)\nprint(a)",
      "solution": "a = [1, 2, 3]\na.append(4)\nprint(a)"
    },
    {
      "id": "m07-p4",
      "conceptIds": [
        "m07-loop"
      ],
      "prompt": "لیست `[2, 4, 6]` را بساز و با یک حلقه هر عضو را در یک خط چاپ کن.",
      "explanation": "حلقه روی عضوها حرکت کرد و هر کدام را در یک خط چاپ کرد.",
      "hints": [
        "از `for x in a:` استفاده کن.",
        "خطِ چاپ باید تورفته باشد."
      ],
      "kind": "write",
      "solution": "a = [2, 4, 6]\nfor x in a:\n    print(x)"
    },
    {
      "id": "m07-p5",
      "conceptIds": [
        "m07-make"
      ],
      "prompt": "این کد باید اولین عضوِ لیست را چاپ کند ولی عضو اشتباهی را می‌گیرد. درستش کن.",
      "explanation": "چون شمارش از صفر است، اولین عضو با `a[0]` گرفته می‌شود.",
      "hints": [
        "ایندکسِ اولین عضو ۰ است، نه ۱."
      ],
      "kind": "fixBug",
      "starterSql": "a = [\"اول\", \"دوم\"]\nprint(a[1])",
      "solution": "a = [\"اول\", \"دوم\"]\nprint(a[0])"
    },
    {
      "id": "m07-p6",
      "conceptIds": [
        "m07-index"
      ],
      "prompt": "خطوط را مرتب کن تا از لیست خالی شروع شود، دو عدد اضافه شود و لیست چاپ شود.",
      "explanation": "نمی‌توان به لیستی که هنوز ساخته نشده عضو اضافه کرد؛ پس `a = []` باید اول باشد.",
      "hints": [
        "اول باید لیست ساخته شود، بعد عضو اضافه شود."
      ],
      "kind": "parsons",
      "blocks": [
        "a = []",
        "a.append(1)",
        "a.append(2)",
        "print(a)"
      ],
      "wrongOrder": [
        "a.append(1)",
        "a = []",
        "a.append(2)",
        "print(a)"
      ],
      "distractors": [
        "a.append()"
      ]
    }
  ],
  "test": [
    {
      "id": "m07-t1",
      "conceptIds": [
        "m07-make"
      ],
      "prompt": "خروجی این کد چیست؟",
      "explanation": "`a[0]` اولین عضو یعنی `7` است.",
      "hints": [],
      "kind": "readQuery",
      "sql": "a = [7, 8, 9]\nprint(a[0])",
      "choices": [
        "7",
        "8",
        "9"
      ],
      "answer": 0
    },
    {
      "id": "m07-t2",
      "conceptIds": [
        "m07-index"
      ],
      "prompt": "لیستی با نام سه میوه بساز و تعدادِ عضوهایش را چاپ کن (باید ۳ شود).",
      "explanation": "`len(fruits)` تعداد عضوها یعنی `3` را می‌دهد.",
      "hints": [],
      "kind": "write",
      "solution": "fruits = [\"سیب\", \"موز\", \"انگور\"]\nprint(len(fruits))"
    },
    {
      "id": "m07-t3",
      "conceptIds": [
        "m07-methods"
      ],
      "prompt": "خروجی این کد چیست؟",
      "explanation": "`append(3)` عدد ۳ را به آخر اضافه می‌کند: `[1, 2, 3]`.",
      "hints": [],
      "kind": "readQuery",
      "sql": "a = [1, 2]\na.append(3)\nprint(a)",
      "choices": [
        "[1, 2]",
        "[1, 2, 3]",
        "[3]"
      ],
      "answer": 1
    },
    {
      "id": "m07-t4",
      "conceptIds": [
        "m07-loop"
      ],
      "prompt": "لیست `[1, 2, 3, 4]` را بساز و با حلقه مجموعِ عضوها را حساب و چاپ کن (باید ۱۰ شود).",
      "explanation": "با یک متغیرِ `total` که از ۰ شروع می‌شود و در هر دور عضو را اضافه می‌کنی، مجموع ۱۰ به دست می‌آید.",
      "hints": [],
      "kind": "write",
      "solution": "a = [1, 2, 3, 4]\ntotal = 0\nfor x in a:\n    total = total + x\nprint(total)"
    },
    {
      "id": "m07-t5",
      "conceptIds": [
        "m07-make"
      ],
      "prompt": "جای خالی را پر کن تا روی عضوهای لیست حرکت کنیم.",
      "explanation": "در حلقهٔ for از کلمهٔ `in` استفاده می‌کنیم: `for x in a:`.",
      "hints": [],
      "kind": "fillBlank",
      "starterSql": "a = [1, 2, 3]\nfor x ___ a:\n    print(x)",
      "solution": "a = [1, 2, 3]\nfor x in a:\n    print(x)"
    }
  ],
  "games": [
    "outputPredictor"
  ]
};
