import type { Module } from '../../../content/types';

// Ported from the standalone pyschool course. Persian lesson content; code is Python.
export const p03: Module = {
  "id": "p03",
  "number": 3,
  "title": "رشته‌ها",
  "tagline": "با متن‌ها کار کن: به هم بچسبان، با f-string ترکیب کن و حرف‌هایش را جدا کن.",
  "concepts": [
    {
      "id": "m03-concat",
      "title": "چسباندن متن‌ها",
      "card": "با علامت `+` می‌توانی دو رشته را **به هم بچسبانی**:\n\n```python\nfirst = \"علی\"\ngreeting = \"سلام \" + first\nprint(greeting)   # سلام علی\n```\n\nدقت کن که فاصله‌ها را خودت باید بگذاری. اگر `+` بین دو متن باشد یعنی چسباندن، نه جمعِ ریاضی.",
      "predict": {
        "sql": "print(\"ab\" + \"cd\")",
        "question": "خروجی چیست؟",
        "choices": [
          "abcd",
          "ab cd",
          "خطا"
        ],
        "answer": 0,
        "why": "`+` بین دو رشته آن‌ها را به هم می‌چسباند؛ پس `abcd` بدون فاصله چاپ می‌شود."
      },
      "example": {
        "sql": "print(\"خوش\" + \"آمدی\")",
        "note": "دو متن بدون فاصله به هم چسبیدند."
      },
      "cheat": {
        "syntax": "\"a\" + \"b\"",
        "note": "دو رشته را به هم می‌چسباند."
      }
    },
    {
      "id": "m03-fstring",
      "title": "f-string",
      "card": "راحت‌ترین راه برای ترکیب متن و متغیر، **f-string** است: قبل از گیومه یک `f` می‌گذاری و متغیر را داخل `{}` می‌نویسی:\n\n```python\nname = \"رضا\"\nage = 17\nprint(f\"{name} {age} سال دارد\")\n```\n\nپایتون داخل `{}` مقدار متغیر را جایگزین می‌کند. دیگر لازم نیست با `+` سروکله بزنی.",
      "predict": {
        "sql": "x = 5\nprint(f\"عدد برابر {x} است\")",
        "question": "خروجی چیست؟",
        "choices": [
          "عدد برابر {x} است",
          "عدد برابر 5 است",
          "عدد برابر x است"
        ],
        "answer": 1,
        "why": "داخل f-string، `{x}` با مقدارِ `x` یعنی `5` جایگزین می‌شود."
      },
      "example": {
        "sql": "city = \"شیراز\"\nprint(f\"من اهل {city} هستم\")",
        "note": "مقدار متغیر داخل متن جا می‌گیرد."
      },
      "cheat": {
        "syntax": "f\"... {var} ...\"",
        "note": "متغیر داخل {} در متن جایگزین می‌شود."
      }
    },
    {
      "id": "m03-index",
      "title": "ایندکس و برش",
      "card": "هر حرفِ یک رشته یک **شماره (ایندکس)** دارد که از **صفر** شروع می‌شود:\n\n```python\nword = \"پایتون\"\nprint(word[0])   # اولین حرف\nprint(word[1])   # حرف دوم\n```\n\nبا **برش** هم می‌توانی چند حرف پشت سر هم بگیری: `word[0:3]` یعنی از حرف ۰ تا قبل از ۳.",
      "predict": {
        "sql": "w = \"hello\"\nprint(w[0])",
        "question": "خروجی چیست؟",
        "choices": [
          "h",
          "e",
          "o"
        ],
        "answer": 0,
        "why": "ایندکس از صفر شروع می‌شود، پس `w[0]` اولین حرف یعنی `h` است."
      },
      "example": {
        "sql": "w = \"python\"\nprint(w[0:3])",
        "note": "از ایندکس ۰ تا قبل از ۳: سه حرف اول."
      },
      "cheat": {
        "syntax": "s[0] · s[0:3]",
        "note": "یک حرف یا یک برش از رشته."
      }
    },
    {
      "id": "m03-methods",
      "title": "متدهای پرکاربرد",
      "card": "رشته‌ها چند **متد** مفید دارند که با نقطه صدا زده می‌شوند:\n\n```python\ns = \"Hello\"\nprint(s.upper())   # HELLO\nprint(s.lower())   # hello\nprint(len(s))      # 5\n```\n\n`.upper()` حروف را بزرگ می‌کند، `.lower()` کوچک، و `len()` **طول** رشته (تعداد حرف‌ها) را می‌دهد.",
      "predict": {
        "sql": "print(len(\"سلام\"))",
        "question": "خروجی چیست؟",
        "choices": [
          "4",
          "3",
          "سلام"
        ],
        "answer": 0,
        "why": "کلمهٔ «سلام» چهار حرف دارد، پس `len` مقدار `4` می‌دهد."
      },
      "example": {
        "sql": "print(\"python\".upper())",
        "note": "همهٔ حروف بزرگ می‌شوند."
      },
      "cheat": {
        "syntax": "s.upper() · len(s)",
        "note": "بزرگ‌کردن حروف · طول رشته."
      }
    }
  ],
  "practice": [
    {
      "id": "m03-p1",
      "conceptIds": [
        "m03-concat"
      ],
      "prompt": "دو رشتهٔ `\"صبح\"` و `\"بخیر\"` را با یک فاصله به هم بچسبان و چاپ کن (باید «صبح بخیر» شود).",
      "explanation": "با `+` سه تکه را به هم چسباندی: «صبح» + فاصله + «بخیر».",
      "hints": [
        "برای فاصله یک رشتهٔ \" \" بین آن‌ها بگذار."
      ],
      "kind": "write",
      "solution": "print(\"صبح\" + \" \" + \"بخیر\")"
    },
    {
      "id": "m03-p2",
      "conceptIds": [
        "m03-fstring"
      ],
      "prompt": "با f-string متن «سلام علی» را بساز. جای خالی را پر کن.",
      "explanation": "حرف `f` قبل از گیومه، رشته را به f-string تبدیل می‌کند تا `{name}` جایگزین شود.",
      "hints": [
        "قبل از گیومه باید `f` بگذاری."
      ],
      "kind": "fillBlank",
      "starterSql": "name = \"علی\"\nprint(___\"سلام {name}\")",
      "solution": "name = \"علی\"\nprint(f\"سلام {name}\")"
    },
    {
      "id": "m03-p3",
      "conceptIds": [
        "m03-index"
      ],
      "prompt": "بدون اجرا حدس بزن خروجی چیست.",
      "explanation": "`w[0]` برابر `c` و `w[1]` برابر `o` است.",
      "hints": [
        "ایندکس از صفر شروع می‌شود."
      ],
      "kind": "readQuery",
      "sql": "w = \"code\"\nprint(w[1])",
      "choices": [
        "c",
        "o",
        "d"
      ],
      "answer": 1
    },
    {
      "id": "m03-p4",
      "conceptIds": [
        "m03-methods"
      ],
      "prompt": "یک متغیر `name` با نامی دلخواه بساز و با f-string جملهٔ «نام من <name> است» را چاپ کن.",
      "explanation": "مقدار متغیر داخل f-string جایگزین شد.",
      "hints": [
        "از `f\"...\"` و `{name}` استفاده کن."
      ],
      "kind": "write",
      "solution": "name = \"مینا\"\nprint(f\"نام من {name} است\")",
      "python": {
        "nonEmpty": true
      }
    },
    {
      "id": "m03-p5",
      "conceptIds": [
        "m03-concat"
      ],
      "prompt": "این کد باید طول کلمه را چاپ کند ولی خطا می‌دهد. درستش کن.",
      "explanation": "`len` به پرانتز نیاز دارد: `len(word)`.",
      "hints": [
        "`len` یک دستور است و ورودی‌اش باید داخل پرانتز باشد."
      ],
      "kind": "fixBug",
      "starterSql": "word = \"کتاب\"\nprint(len word)",
      "solution": "word = \"کتاب\"\nprint(len(word))"
    },
    {
      "id": "m03-p6",
      "conceptIds": [
        "m03-fstring"
      ],
      "prompt": "خطوط را مرتب کن تا با f-string نام ذخیره‌شده چاپ شود.",
      "explanation": "باید اول `name` ساخته شود تا f-string بتواند مقدارش را جایگزین کند.",
      "hints": [
        "اول متغیر را بساز، بعد در f-string استفاده کن."
      ],
      "kind": "parsons",
      "blocks": [
        "name = \"آوا\"",
        "print(f\"سلام {name}\")"
      ],
      "wrongOrder": [
        "print(f\"سلام {name}\")",
        "name = \"آوا\""
      ],
      "distractors": [
        "print(f\"سلام {name}\")  # قبل از ساختن name"
      ]
    }
  ],
  "test": [
    {
      "id": "m03-t1",
      "conceptIds": [
        "m03-concat"
      ],
      "prompt": "خروجی این کد چیست؟",
      "explanation": "`+` دو رشته را بدون فاصله به هم می‌چسباند، پس «خوشحال».",
      "hints": [],
      "kind": "readQuery",
      "sql": "print(\"خوش\" + \"حال\")",
      "choices": [
        "خوش حال",
        "خوشحال",
        "خطا"
      ],
      "answer": 1
    },
    {
      "id": "m03-t2",
      "conceptIds": [
        "m03-fstring"
      ],
      "prompt": "عددِ طولِ کلمهٔ `\"programming\"` را چاپ کن.",
      "explanation": "`len` تعداد حرف‌ها را می‌دهد که اینجا ۱۱ است.",
      "hints": [],
      "kind": "write",
      "solution": "print(len(\"programming\"))"
    },
    {
      "id": "m03-t3",
      "conceptIds": [
        "m03-index"
      ],
      "prompt": "جای خالی را پر کن تا اولین حرفِ کلمه چاپ شود.",
      "explanation": "ایندکس اولین حرف `0` است، پس `w[0]` برابر `a`.",
      "hints": [],
      "kind": "fillBlank",
      "starterSql": "w = \"apple\"\nprint(w[___])",
      "solution": "w = \"apple\"\nprint(w[0])"
    },
    {
      "id": "m03-t4",
      "conceptIds": [
        "m03-methods"
      ],
      "prompt": "خروجی این کد چیست؟",
      "explanation": "`.upper()` همهٔ حروف را بزرگ می‌کند: `HI`.",
      "hints": [],
      "kind": "readQuery",
      "sql": "print(\"Hi\".upper())",
      "choices": [
        "Hi",
        "HI",
        "hi"
      ],
      "answer": 1
    },
    {
      "id": "m03-t5",
      "conceptIds": [
        "m03-concat"
      ],
      "prompt": "متغیری به نام `n` با عدد سنّت بساز و با f-string جملهٔ «سن من <n> است» را چاپ کن.",
      "explanation": "عدد داخل f-string هم مثل متن جایگزین می‌شود.",
      "hints": [],
      "kind": "write",
      "solution": "n = 18\nprint(f\"سن من {n} است\")",
      "python": {
        "nonEmpty": true
      }
    }
  ],
  "games": [
    "outputPredictor"
  ]
};
