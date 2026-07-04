# TFStudio Russian Translation Guide

This file is the authoritative glossary + style spec for the EN→RU translation
of TFStudio's documentation site. It is read by `translate-docs.mjs` and fed
to the LLM as part of the cached system prompt. **Keep it short, concrete,
and only add rules confirmed by a native speaker (the user).**

## Glossary — confirmed terms

| English | Russian | Notes |
| --- | --- | --- |
| Design Editor | Редактор покрытия | NEVER "Редактор дизайна" (calque). |
| Inputs (UI section heading) | Входные данные | NEVER "Входы" — wrong register (means physical signal inputs). |
| Outputs / readouts (section heading) | Индикаторы | Single word, no "Выходы". |
| layer stack | слои | NEVER "стек слоёв". |
| badge (UI element) | индикатор | NEVER "бейдж". |
| merit function | MF (функция качества); abbreviation **ФК** | Always include the "MF" abbr. |
| locked / Lock (the layer-lock toggle) | заблокированный / блокировка | NEVER "запертый". |
| Reference wavelength | Опорная длина волны | |
| Drives the … columns | Используется … | NOT "задаёт колонки". |
| Typical: 550 nm (visible), 1550 nm (telecom) | По-умолчанию: 550 нм (видимый) | Drop redundant English gloss when context is clear. |
| substrate | подложка | |
| coating | покрытие | |
| front layers / back layers | слои передней стороны / слои задней стороны | |
| coherent / incoherent (substrate) | когерентный / некогерентный | Keep technical terms — they exist in Russian thin-film vocabulary. |
| Transfer Matrix Method (TMM) | метод матрицы переноса (TMM) | Leave TMM abbreviation in body text. |

## Do NOT translate

- **App window names** in body text: Optical Evaluation, Admittance, Refinement,
  Needle Variation, Gradual Evolution, Material Editor, Merit Function Editor,
  Variator, BBM Simulator, Mono Simulator, Process Simulator, etc. Russian
  users see English in many places in the app, and these are recognisable.
  Exception: when the term is itself the page title, the page title MAY use
  the glossary Russian (e.g. page title is "Редактор покрытия" but body
  references to other windows stay English).
- **Code/enum identifiers** verbatim: `front_only`, `back_only`, `symmetric`,
  `both_independent`, `frontLayers`, `backLayers`, `MNT`, `MXT`, `QW`, `OT`,
  `FW`, `MF`, `TMM`.
- **Scientific symbols and units**: λ, λ₀, nm, °, n, k, ñ, d, θ, δ.
- **Equation references**: "Macleod §2.6.4", "Eq. 2.111", "Ch. 2".
- **File names, paths, identifiers, URLs**.

## Style rules

1. Write Russian as a native domain expert would — not a calque of the
   English sentence structure. Reorder, drop articles, change voice as
   needed.
2. Active voice over passive ("используется" over "осуществляется").
   Avoid bureaucratic verbs (производить, осуществлять).
3. Drop redundant English glosses when the meaning is clear from context.
4. Don't add explanatory padding the English source doesn't have. If the
   EN says it in 5 words, RU should too.
5. Tone: technical, clean, written for domain experts.

## THE HARDEST RULE — never invent

**If you don't know the exact idiomatic Russian term, DO NOT INVENT ONE.**
Instead, write a plain-prose description of the behaviour and put the
original English term in parentheses:

- ✅ "TMM только задней стороны (back_only)"
- ✅ "Алгоритм needle (needle variation)" — if no settled RU term
- ✅ "Полная двусторонняя система покрытий (full two-sided system)"
- ❌ "Однопокрытие" — invented, not a Russian word
- ❌ "Редактор дизайна" — calque of "Design Editor", does not work in Russian here
- ❌ "Входы" — wrong register for a UI section heading

Confirmed bad coinages to **never** produce: **Редактор дизайна, Входы,
Однопокрытие, запертый**.

## Preservation rules (mechanical)

- Preserve YAML frontmatter exactly. Translate ONLY the values of `title:` and
  `description:`. Keep all other keys (e.g. `ribbonIcon:`) and their values
  verbatim.
- Preserve all Markdown structure: heading levels, list bullets, table
  pipes/alignment, blockquotes, code fences.
- Preserve code blocks (` ``` ... ``` `) and inline code (`` ` ... ` ``)
  verbatim — translate nothing inside them.
- Preserve links: translate the link text (between `[ ]`), keep the target
  (between `( )`) byte-identical, including any leading `/ru/` already
  present.
- Preserve MDX imports / JSX components verbatim.
- Output the file content ONLY. No prefatory "Here is the translation:", no
  markdown fences wrapping the whole document.
