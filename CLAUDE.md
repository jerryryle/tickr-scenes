# tickr-scenes

## Publishing

This repo is always the source of truth for its scenes. When publishing, overwrite the published
scene with the version built here: don't check whether the published scene has changed, and don't
diff it against the source or carry editor changes back into `src/`.

`scene_publish` still needs the current `document.sha256` as its `base`. Pull into
`build/<scene>/` just for that, then run `make <scene>` (which regenerates `scene.ts` from `src/`),
build, make the thumbnail, and publish.

A scene whose build packs assets of its own (`scenes/<scene>/assets-packed/`, such as Long Day's
`world_<hash>`) needs each uploaded with `asset_add`, under its file name, before its source is
published or sent as a draft. The source reads the asset by that name, so without it the scene
fails to start. A packed asset is named after its contents, so a new one is added beside the old
one; adding it changes only the scene's draft.

## Visual changes

A visual change is made, rendered and shown, and then the work stops until the user says what is
next. The render covers the change itself and refreshes the whole set of views the user last
looked at, such as a sheet of every truck. A change to something that moves, such as a door, a
crew chore or a puff of smoke, is shown as a video of it moving (`make stage` makes one of a
stop), and stills are added only where they help. The user often iterates on a look several times before
committing, so `make check-<scene>` runs only when they ask for it or the work moves to a commit.

## Correct, simple and fast enough is the bar

Designs, code and reviews all aim at the same three things: a scene that behaves correctly in the
conditions it actually meets, code no more complex than that behaviour needs, and no wildly
wasteful work. The behaviour asked for is itself open to question when a simpler one would serve.

- **Correct means correct in normal play.** Normal play is every seed, every city in Long Day's
  catalogue (`scenes/long-day/src/world.ts`), a whole day from first frame to last, and every
  value a `DEFINE` or a scene setting admits. A defect there is always in scope. The city
  generator now only drafts cities (`scenes/long-day/tools/draftcities.ts`), so a layout it could
  produce but no catalogue city has is outside normal play.
- **Rare failures outside the scene are not a goal.** A scene does not need to ride out the board
  or the tickr service misbehaving. A reviewer does not ask for handling of it, and machinery
  added only for it is complexity to remove.
- **Cheap handling of a rare case is welcome.** Handling one is fine when it stays inside the code
  path that already exists and adds no mechanism or new state: a guard on a value the code already
  has, or a safer order for two steps it already takes. A reviewer neither asks for such handling
  nor flags it for removal.
- **Complexity is a cost the finding must pay for.** A fix that adds a mechanism, new state or a
  new way to fail has to prevent a defect that is likely or visible. Weigh a trigger by how often
  real seeds produce it, never by whether it can happen at all.
- **Inefficient means wildly inefficient.** In scope is work that is wasteful by an order of
  magnitude or that grows with data it does not need: scanning every object in the city each frame
  to answer for one, rebuilding geometry or materials every frame that could be built once, or
  unbounded growth over a long day. A constant-factor saving nobody would see in the frame rate is
  below the bar.
- **A simpler design is worth a small change to the requirement.** When a requirement drives much
  of the complexity and a nearby one would serve the same purpose with far less, say so: before
  building it, and in a review of existing code, as an entry in the improvements list. Name the
  requirement to change, the complexity it removes and what the user gives up. This is pushback,
  never a unilateral change. The user decides, and the work follows the requirement they choose.
- **Security and privacy sit outside this bar.** A leaked secret or mishandled credential is
  surfaced however unlikely its trigger.
- **What falls below the bar is left out.** A reviewer does not report it, not even as accepted,
  and a design adds no machinery for it.

## Writing style

Applies to everything written in this repo: READMEs, code comments, commit messages, and chat.

Write clear, normal prose in complete, flowing sentences. The rules below name the specific habits
that make writing read as machine-generated. Every one of them is about *how* a thing is said.
None of them licenses saying something different: if the only way to satisfy a rule is to drop a
fact, soften a claim, invent a detail, or blur a number, keep the fact and find another phrasing.

### Lead with the point, then descend

A unit of writing (a document, a section, a paragraph) opens by stating its point, and everything
below it supports that point. A reader who stops at any depth still holds the most important
things read so far.

- A paragraph's first sentence is its claim. Do not open with the mechanism, the history, or the
  argument and leave the claim for the middle. A heading labels; it does not assert.
- The plain version comes before the precise one. State the idea in one plain sentence, then give
  the exact version with its qualifiers.
- Keep altitudes apart. What the code does, why it is so, and what happens at the edges each get
  their own paragraph or list instead of being braided into one.
- One idea per bullet. A bullet that runs ten lines across five topics is a section that lost its
  headings.
- Facts of one kind share one home. Tunables and odds (such as `layouts` in `src/styles.ts`) live
  in one place, and prose points there instead of restating each number.
- A summary orients; it does not compress. Name the two or three ideas everything else hangs off
  and say where the detail lives.
- The opening claim is intelligible before its support arrives. An epigram satisfies point-first
  grammatically and fails it in substance.

### State the mechanism, then the motive

Describe what the code does first, affirmatively, in the indicative. The failure a design
prevents, or the flaw in a rejected alternative, gets at most one sentence after the rule, never a
narrated disaster scenario and never instead of the rule. Never state current behaviour only as
the negation of a failed alternative: say what it does, then (if it earns the space) why the
alternative lost.

### Say less

- Say it once. Delete any sentence that restates the one before it with different words, a vivid
  image, or a number attached.
- Say it once across files and sections too. A mechanism is described in full in exactly one
  place; every other mention is one clause plus a pointer to that place.
- A README states what the code does and why, not the code itself. If deleting a sentence would
  change no reader's understanding of the design, it is a code comment at the enforcement site.
- Report the result. Add reasoning only where it changes what the reader does next, or where they
  asked for it. Do not narrate the decisions taken along the way.
- In a reply, lead with the answer or the table. Do not restate the question or re-narrate what
  the reader said. Rationale they asked for is not filler: keep it, in flowing sentences.
- Stop when the content stops. No closing summary, no "in conclusion", no forward-looking closer.
- Cut manufactured balance. A drawback goes in because it is real, not as ballast.

### Terms and names

- Define a term at its first use, including a verb promoted to a noun of art.
- One name per thing, one thing per name, document-wide.
- A term with an established technical meaning keeps that meaning; a neighbouring concept gets its
  own name.
- Disarm collisions with language and framework terms at first use (a three.js `Scene` versus a
  tickr scene, for example).
- Name a condition by its standard, searchable term.
- Introduce the cast before the role names. A document about how components interact enumerates
  them once before any section leans on their names.

### Limits and numbers

- A limit is a number or a pointer to where the number is defined. "A far smaller ceiling" is a
  comparison, not a value.
- Quote a value only where the argument uses it, and cite the file for the rest.

### Sentence shapes to avoid

- Negative parallelism: "not just X, but Y", "it isn't X, it's Y", "X rather than Y". "X, never Y"
  is the same shape. State the claim on its own; a real, surprising contrast may stay, but not as
  a recurring template.
- Rule of three: three adjectives or three parallel clauses where one or two carry the meaning.
- Participial tails: ", ensuring the cache stays warm", ", making it easier to extend". Cut it, or
  give it a subject and a full stop.
- Verb inflation in place of "is" and "has": "serves as", "acts as", "represents", "boasts",
  "features", "leverages", "utilizes". Prefer an active, concrete verb where one exists.
- Elegant variation: renaming the same thing on each mention. Repeat the term.
- The em-dash splice. Write two sentences.
- The clipped sentence for emphasis: "That's it."
- The suspended spine. Keep a sentence's completion next to the claim it completes; an
  interruption between subject and verb longer than a few words becomes its own sentence.
- The enumeration in the spine. State the class in the sentence and give the members their own
  sentence.
- Stacked subordination: one colon, one em-dash pair, or one parenthetical per sentence, and a
  parenthetical never contains another delimiter.
- The unanchored anaphor. "It", "that" and "this" must resolve to the nearest noun without
  competition, and never across a paragraph break. When the antecedent is a whole clause, repeat
  the noun.
- Fragments. Every sentence has a subject and a finite verb, including comment lines, list items,
  table cells and commit-message bullets. Brevity never buys the verb.

### Words that give it away

Strike on sight, in any inflection: crucial, pivotal, vital, essential, key (as an adjective),
significant, comprehensive, robust, seamless, powerful, rich, vibrant, intricate, meticulous,
nuanced, profound, enduring, groundbreaking, renowned, delve, underscore, showcase, foster,
garner, bolster, enhance, ensure, enable, leverage, utilize, align with, resonate with, landscape,
tapestry, ecosystem, realm, journey, testament, cornerstone, backbone, deep dive, valuable
insights, best-in-class.

Also strike the announcement of significance ("the important part", "worth noting", "notably",
"importantly", "here's the thing", "plays a critical role in") and connective throat-clearing
("Additionally", "Moreover", "Furthermore", "That said", "At its core", "Ultimately").

### Claims

- No vague attribution ("experts argue", "best practice suggests"). Cite the thing: a file and
  line, a test, a commit, a render you made. If there is nothing to cite, say it is your judgement
  or drop the claim.
- No hedge-then-assert.
- No borrowed authority in a recommendation. "We should X because Y" beats "X is the standard
  approach".
- No coined shorthand for a convention ("the usual way"). State the convention's content or name
  the sibling that already follows it.
- A sentence survives the deletion of its cross-references. State the claim in words, then cite.
- Every "so" and "therefore" is checkable from what the page has already said.
- A recorded decision opens with why the winner wins and the constraint that forced the choice,
  and only then walks the rejected alternatives.

### Formatting

- Number every list in chat, reports and reviews, including nested ones, so the user can refer to
  an item by its number ("#3", "2.1"). Never use an unordered list there. A tickable entry puts
  its number in a heading (`### 3. [ ] …`), since `1. [ ] …` renders without its number.
- Sentence case for headings.
- Bold marks a term where it is defined. It is not emphasis to sprinkle through a paragraph.
- Prose by default. A bulleted list is for items that are genuinely parallel and genuinely a set.
- Straight quotes and apostrophes. No emoji as structure, no horizontal rule before a heading, no
  decorative glyphs mid-sentence.
- Nothing normative lives only in a skippable container such as a blockquote or parenthetical
  aside; it also appears as a sentence in the prose.
- A cross-reference quotes its target heading verbatim. A bare "(below)" names its target section
  instead.

### Editing someone else's words

When you revise existing text, meaning is fixed and only wording moves. Do not drop a qualifier
that was doing work, do not turn a hedged claim into a flat one or the reverse, do not round or
restate a number, and do not merge two claims into one that covers less than both. When a
sentence is graceless because the underlying fact is awkward, leave it graceless and say so.
