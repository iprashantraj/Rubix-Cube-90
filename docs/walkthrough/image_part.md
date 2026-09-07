# The image flow, in 12 steps

One photograph, from the moment the artisan opens the camera to the JPEGs that go out to
each marketplace. Plain language — no image-processing background needed.

---

## The flow, in short

**On the phone**

1. Live frames → checked 10×/sec → artisan guided, one thing at a time
2. Frame stays good 1 second → photo taken automatically, sharpest of 3
3. GPS stripped → uploaded, full size

**On the server**

4. **Checked again**, at full size → only the unfixable is refused
5. Passes → shrunk to 2000px
6. That 2000px version → AI cuts the product out (soft mask)
7. Mask judged by its shape → tier A (clean cut) / B (softened) / C (leave background)
8. Mask says where the product is → square crop, product fills 85%
9. Brightness measured from the product's own lightness, capped
10. Every decision written down as a recipe — **still no pixels touched**
11. Recipe rendered → the one step that actually makes the image
12. Exported → one JPEG per marketplace

The rest of this file is those twelve steps, explained.

---

# On the phone

## 1. Live frames → checked 10 times a second → artisan guided, one thing at a time

The camera preview is already a stream of pictures — about 30 a second. So before anyone
presses anything, we quietly take one and inspect it.

Every 3rd frame gets shrunk to a tiny 240×180 version with the colour thrown away, leaving
about 43,000 brightness values instead of 2 million. That is the trick that makes it feel
instant — roughly 6 milliseconds per check on a cheap phone.

Four things get measured:

- **Light** — average brightness, plus how many pixels are pure white or pure black (those
  hold no information at all)
- **Sharpness** — compare each pixel to its neighbours; sharp photos have hard jumps at
  edges, blurry ones are mushy
- **Framing** — split into a 12×9 grid and ask each square *"is anything textured here?"*
  Empty floor is flat, a woven shawl is busy. The busy squares tell us roughly where the
  product is — we never actually detect *what* it is
- **Tilt** — read straight from the phone's motion sensor, does not touch the image at all

Then it says **one** thing. Not four. "Photo blurry hai, andhera hai, phone tedha hai,
product door hai" all at once is how an app gets uninstalled. Light is always checked first,
because every other measurement is meaningless in the dark.

`app/src/camera/gate.js`, `app/src/camera/useCameraGate.ts`

## 2. Frame stays good for 1 second → photo taken automatically, sharpest of 3

The shutter button stays grey and unpressable until the frame is genuinely good. Then the
app fires **by itself**.

Why no button: pressing a button shakes the phone, which puts back exactly the hand-shake
blur we just spent all that effort avoiding.

And instead of one photo it grabs three in a burst and keeps the sharpest. Costs about 60
milliseconds, no AI, no internet — free quality.

## 3. GPS stripped → uploaded, full size

Phone photos secretly carry the location where they were taken. That gets removed from
**every** upload, no exceptions — an artisan's home address published on a marketplace
listing cannot be taken back.

The upload is then sent in small chunks rather than one big file, so a dropped rural
connection picks up where it left off instead of starting over.

---

# On the server

## 4. Checked again, at full size → only the unfixable is refused

The same four measurements run again, but now on the real full-size photo, and **before any
AI is run** — no point spending computing power on something we are about to throw away.

Why check twice? Because shrinking a photo hides blur. On the phone's tiny preview, the blur
test catches **23 out of 166** known-blurry test photos. The exact same formula at full size
catches **152**. So the phone gives advice, the server makes the decision.

One thing the server deliberately does *not* re-check: **framing**. Too far, too close,
off-centre — the crop step later fixes all of those. Refusing the photo for something we can
repair would throw away a listing this whole system exists to rescue.

It only refuses what genuinely cannot be repaired: not enough pixels, not enough detail, or
light so blown out the information was never recorded in the first place.

`ai/enhance/pipeline.py` → `gate()`

## 5. Passes → shrunk to 2000 pixels

This surprises people, because it sounds like we are throwing away quality. Here is why we
are not.

Think of it like **tracing**. The AI can only ever trace on a small sheet of paper — it
shrinks whatever you give it down to a fixed small size, traces the outline there, and hands
the tracing back. Then *you* have to blow that tracing back up to match your photo.

- Photo at 2000px → tracing enlarged about **2×** → the line stays thin and clean
- Raw 12-megapixel photo → tracing enlarged about **4×** → that thin line becomes a fat
  fuzzy band, and a thin wire nose-ring turns into a blob

So giving the AI the biggest file is **slower *and* worse**. We shrink first so its answer
does not have to be stretched as far.

`ai/enhance/segmenter.py` → `to_master()`

## 6. That 2000px version → AI cuts the product out

This is the only step that uses the graphics card — about 0.65 seconds.

The model is called BiRefNet, and it was chosen by actually testing five different models
side by side on 41 of our own craft photos, not by picking whichever is most famous.

What it returns is not a clean yes/no outline. It gives **every pixel a number between 0 and
1**: 1 means definitely the product, 0 means definitely background, 0.4 means a wispy fringe
thread with background showing through. That softness is the whole point — it is what stops
a dupatta's fringe looking like it was cut off with scissors.

Worth knowing: the model has no idea it is looking at a matka or a saree. It only answers
*"where does the front thing end and the background begin?"* — which is why it works on
Indian handicrafts without ever having been trained on them.

`ai/enhance/pipeline.py` → `segment()`

## 7. Mask judged by its shape → tier A / B / C

This is the most important step, and the least obvious.

**The AI never admits when it is wrong.** Show it a cluttered shop, a shelf of pots, or a
saree filling the entire frame, and it does not say "I am not sure." It confidently draws a
neat outline around something arbitrary and hands it over looking exactly as certain as when
it is right.

So we cannot ask it. Instead we look at the **shape of its answer** and ask "does this look
sensible?":

- **Is it fuzzy all over?** More than 8% "maybe" pixels means it was guessing
- **Did it come back in pieces?** More than 3 separate blobs means it probably found a
  shelf, not one product
- **Is the size sane?** Under 15% of the frame (it found a shadow) or over 85% (there is no
  background to remove)

Then:

- **No problems → Tier A** — cut the product out cleanly, put it on pure white
- **One problem → Tier B** — same, but soften the edge. This does not *fix* a wrong outline;
  it stops it shouting. Your eye catches a sharp wrong edge instantly, a soft one slips past
- **Two or more → Tier C** — **do not cut anything.** Just crop and brighten the photo as it is

It deliberately takes **two** problems to fall to C. One odd measurement is usually just an
odd photo — a rug that genuinely fills the frame, a pot in a dark corner. Refusing to help
those would cost more listings than it saves.

**Tier C is not a failure.** A saree with a chewed-up edge looks *worse* to a buyer than a
plain unedited photo. C removes nothing, so it cannot damage the product. It is the safety
net under the entire feature.

`ai/enhance/pipeline.py` → `tier()`, `mask_confidence()`

## 8. Square crop, product fills 85%

Every marketplace wants the same thing: a square picture with the product filling about 85%
of it. Our photos are rectangles with the product off to one side.

We already know exactly where the product is, so this is just geometry — no guessing.

One subtlety: we do not draw the box around every non-zero pixel. The cut-out has faint dust
specks scattered about, and one speck in a corner would drag the box out to the frame edge
and shrink the product to a dot. So it asks *where does 99.8% of the product actually live?*
and boxes that.

Then a square is built around it, sized off the product's **longer** side — so a tall vase
and a wide dhurrie both come out correctly. If the square hangs off the edge of the photo,
those bits are filled with white (invisible, because the background is already white).

**It never stretches.** Squashing a saree to fit a square means the buyer receives something
a different shape from what they saw.

`ai/enhance/pipeline.py` → `crop_plan()`, `product_box()`

## 9. Brightness measured from the product's own lightness, capped

The black and white points are taken **inside the product only**. Measure the whole photo
and a dark floor or a bright window ends up deciding how the product is exposed.

Contrast is adjusted on lightness alone — colour is mathematically untouched, because a
saree changing shade is exactly the kind of misrepresentation that costs an artisan a return.

And the adjustment is **capped**. A dark product photographed in a dim room *is a dark
product*. Pulling its brightness wide until it looks studio-lit is inventing an appearance
the object does not have — which is fabrication whether a fancy AI does it or plain
arithmetic does.

`ai/enhance/pipeline.py` → `tone()`

## 10. Every decision written down as a recipe — still no pixels touched

Everything so far — which tier, where to crop, how much to brighten, which version of the AI
produced the outline — gets saved as a small note attached to the product.

**Nothing has edited the photo yet.** Every step only produced *instructions*. This sounds
like a technicality and is actually the most valuable design decision in the pipeline — see
the next step.

`ai/enhance/recipe.py`

## 11. Recipe rendered → the one step that actually makes the image

One function reads the note and applies it. It makes no decisions of its own; it just
follows instructions.

Because everything upstream is instructions rather than edited images:

- The artisan taps "use a softer edge" → change one word in the note, redraw. **No AI
  re-run, no waiting.**
- Undo works the same way
- When we ship a better AI model later, we can redraw everything — and every choice the
  artisan already made survives
- **The original photo can never be overwritten**, not because someone remembered to keep a
  backup, but because nothing in the entire pipeline is capable of writing over an image

`ai/enhance/renderer.py` → `render()`

## 12. Exported → one JPEG per marketplace

Each destination gets its own file at its own size and quality:

- **2000px, high quality** — Amazon, GeM, Flipkart
- **1000px, lighter** — WhatsApp, kept under 200KB so it actually sends on a weak connection
- **1080px** — social media

An unknown channel gets the standard marketplace square rather than nothing at all.

`ai/enhance/pipeline.py` → `export()`

---

**The whole thing in one line:** the phone stops photos that cannot be saved and coaches
with one sentence at a time; the server re-checks properly, cuts the product out, decides
how much of that cut-out it actually trusts, and writes down what to do — so the final
picture is made in a single step that can be redone at any time without ever touching the
artisan's original.
