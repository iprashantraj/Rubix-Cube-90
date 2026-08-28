# Image Processing — how it works, start to finish

**Who this is for:** teammates who do not work on the image side, and anyone we have to
explain this to. It follows one photograph from the moment an artisan points the camera to
the moment a listing image exists. Plain language, but every technical term we actually use
is named, so you can use them too.

**Keep it current.** One section per piece of work, in the order it happens. When something
new is built, it gets added here as well as to `docs/Abhay/CHANGELOG.md`. The changelog is
the detailed record for the image developer; this file is the explanation for everyone else.

Last updated: 2026-08-28.

---

## 1. The problem we are solving

An artisan photographs the thing they made. They are holding a mid-range Android phone,
they may be in a courtyard or a dim room, and they may not be able to read.

Online marketplaces reject photographs for very specific reasons: the background is not
pure white, the product is too small in the frame, the image is under 1000 pixels, the
colour does not match the delivered item, there are shadows on the white.

Our job is to take the photograph they actually took and turn it into an image the
marketplace accepts, **without changing what the product looks like.** If the delivered item
looks different from the photo, the artisan gets the bad review and the return. So we
improve the photograph. We never invent anything that was not there.

---

## 2. The one rule that shapes everything

> **The phone coaches the shot. The server does the processing.**

The phone is good at one thing the server cannot do at all: it is *there*, while the artisan
is still holding the camera. If the light is bad, the only useful moment to say so is before
the photo is taken, when they can still move to a window.

The server is good at everything else. It has the full-size photograph, no battery limit, no
"this phone is three years old" problem, and one copy of the software that we can improve
without anyone reinstalling an app.

We considered running the heavy image work on the phone and **rejected it.** It would be
slow, it would drain the battery, it would behave differently on every handset, and every
improvement would need a Play Store release.

---

## 3. The journey of one photograph

### Stage 1 — On the phone: coaching (BUILT, by the app developer)

The camera screen is not just a viewfinder. While the artisan is aiming, the app is
continuously measuring the live preview and speaking one instruction at a time.

The file that does this is `app/src/camera/gate.js`. We call it the **capture gate**.

It measures four things:

| What it measures | Plain meaning |
|---|---|
| **Brightness** | Is there enough light? Is it so bright that detail is lost? |
| **Blur** | Is the picture sharp? |
| **Framing** | Is the product big enough in the frame, and roughly centred? |
| **Tilt** | Is the phone level? |

Two rules here matter more than the measurements:

- **One problem at a time, light first.** If we listed five problems the artisan would be
  lost. Light comes first because every other measurement is meaningless in the dark.
- **It speaks.** The artisan may not read, so instructions are spoken, not written.

Important: it measures a **shrunk-down copy** of the preview, 240×180 pixels, not the full
picture. This is on purpose — reading the full preview many times a second would make the
camera unusable. It also has a consequence we discovered later, in section 5.

### Stage 2 — On the phone: stripping the hidden data (BUILT, by the app developer)

Every photo file contains hidden information alongside the picture: camera model, date,
settings, and **the exact GPS coordinates where it was taken.** This hidden block is called
**EXIF**.

If we uploaded that untouched, an artisan's home address would be embedded in a public
marketplace listing, readable by anyone who downloads the image. That cannot be undone
afterwards.

So the app runs `stripExif` on every upload, with no exceptions. This does not change how
the photo looks. It removes what is hidden behind it.

### Stage 3 — On the phone: getting it to the server (BUILT, by the web developer)

The photograph is cut into small pieces and sent one at a time. This is a **chunked
resumable upload**.

The reason is the network. On a weak rural connection, sending a large file in one go means
that a drop at 90% loses everything and starts again. Sending it in pieces means a drop
loses one piece, and it continues from there.

The server puts the pieces back together and stores the result — `web/api/storage.py`.

### Stage 4 — On the server: the quality gate (BUILT — this is the newest work)

Now the server has the full-size photograph. Before spending any serious computing power on
it, it asks one question: **is this photo usable at all?**

This is `gate()` in `ai/enhance/pipeline.py`. We call it the **server gate**.

It refuses a photograph for six reasons:

| Refusal | Plain meaning |
|---|---|
| Resolution too low | Under 1000 pixels on the short side. Too few pixels to make a listing image |
| Too dark | Not enough light overall |
| Too bright | Overexposed overall |
| Blown highlights | Bright areas have gone pure white and the detail in them is permanently gone |
| Crushed shadows | Dark areas have gone pure black, same problem at the other end |
| Blurry | Genuinely out of focus or smeared |

When it refuses, it does not just say no. It returns a **reason** for our logs and a
**message key** for the artisan, so they are told what to fix.

**Two decisions worth explaining, because people ask about both:**

**It does not check framing.** A photo taken from too far away, or with the product off to
one side, is *fixable* — a later stage crops and re-centres it. Refusing it here would throw
away a listing we were built to rescue. So framing is coached on the phone, where the
artisan can still act on it, and repaired on the server. The gate only refuses things that
cannot be repaired: pixels that were never captured, and detail that is permanently gone.

**It checks the order of its own questions carefully.** The gate gives one spoken
instruction, and a correct refusal with the wrong instruction is close to useless — the
artisan acts on what they hear. So it settles "too dark or too bright" before it looks at
the extremes, which stops an overexposed photo from ever being announced as "too dark".

### Stage 5 onwards — On the server: the actual enhancement (NOT BUILT YET)

These are designed and specified, in `ai/enhance/pipeline.py`, but not written:

| Stage | What it will do |
|---|---|
| **Segmentation** | Work out which pixels are the product and which are the background. The output is called a **mask** |
| **Matting** | Handle soft edges properly — fringes, tassels, thin fabric — where a hard yes/no cutout would slice them off |
| **White balance** | Fix colour. A maroon fabric photographed under a yellow bulb looks orange, and the buyer returns it |
| **Tone** | Brighten and even out the lighting on the product |
| **Sharpen** | Make the weave and texture visible, because texture is what sells handicraft |
| **Crop** | Re-frame so the product fills 85–90% of a square 2000×2000 image |
| **Composite** | Put the product on a pure white background, which is what marketplaces require |
| **Export** | Produce the different sizes each marketplace wants |

**One design rule across all of them:** we never overwrite the artisan's original photo. We
store a **recipe** — a list of instructions describing what to do — and produce the final
image on demand. That way the original is provably untouched, and any decision can be redone
later without starting over.

---

## 4. The work that was actually done: making the numbers real

Everything in stages 1 and 4 depends on **thresholds** — the cut-off numbers that decide
"too dark", "too blurry", and so on. They live in one file, `ai/thresholds.json`, which both
the phone and the server read while running. One file, so the two can never disagree.

**The problem: every one of those numbers was a guess.** The file even claimed they had been
calibrated on real artisan photographs. That had not happened. The folder it pointed at was
empty.

This matters more than it sounds. A threshold set too strictly locks an artisan out of the
app with nothing they can do about it. Nobody should be guessing at that.

So the work was to replace the guesses with evidence. Four pieces:

### 4.1 Collect real photographs — `images/fetch.py`

Gathers openly-licensed photographs of Indian handicrafts, recording who took each one and
under what licence. We deliberately weighted it towards the difficult cases rather than the
pretty ones — fringed textiles, patterned backgrounds, dark products, brass with bright
reflections, indoor light.

**Result: 93 usable photographs.**

### 4.2 Make deliberately bad photographs — `images/degrade.py`

Here is the problem nobody expects: **you cannot find bad photographs on the internet.**
Every image online already survived someone deciding it was good enough to publish. Nobody
uploads their blurry failures.

So we make them, from the good photographs, with the damage recorded. Six kinds of damage:

| Damage | What it simulates |
|---|---|
| Motion blur | Hand shake |
| Defocus | Autofocus missed |
| Underexposed | Indoors, one bulb |
| Overexposed | Direct midday sun |
| Off-centre | Product pushed to a corner |
| Too far | Photographed from across the room |

Each good photograph produces six damaged copies. **93 good + 498 damaged = 591 images.**

The advantage over hunting for real bad photos is that we know the exact answer. When the
gate rejects one, we know whether it rejected it for the right reason.

### 4.3 Measure everything — `images/check.py`

Runs every one of the 591 images through the same measurements the phone and server use,
and writes the results to a file. About 80 seconds for the full set.

### 4.4 Score the thresholds — `images/calibrate.py`

Takes those measurements and asks the only question that can move a number: **how many
images does this threshold get wrong, and in which direction?**

It separates two kinds of mistake, and the second is easy to miss:

- **Refusing a good photograph** — the artisan is blocked for no reason.
- **Refusing a bad photograph but saying the wrong thing** — the photo is correctly
  rejected, but the artisan is told to fix the wrong problem, so they can never succeed.

---

## 5. What we found

### The worst number in the project

One threshold, `fill_fraction_max`, existed to catch photos taken too close. It was
**refusing 44 of the 93 good photographs.**

The reason is a mistake that is easy to make: it measured how much of the frame is "busy",
and treated a busy frame as too close. But a product filling the frame is exactly what a
product photograph looks like. It was rejecting good composition for being good composition.

It hit every patterned-background photo and most fringed textiles. **Turned off.**

### The phone cannot detect blur, and this is not fixable

Remember that the capture gate measures a shrunk 240×180 copy. Shrinking an image removes
blur — the defect gets smaller along with everything else.

Measured across 166 deliberately blurred images:

| Measured on | Blurred images correctly flagged |
|---|---|
| The phone's 240×180 preview | **23 of 166** |
| The server's full-size image | **152 of 166** |

So the blur check on the phone is now **advice only** — it can suggest, it can never block
the shutter. The real decision moved to the server, where the full-size image is available.
This is why there are two separate blur numbers rather than one.

### Being strict is not the same as being right

The blur setting on the server was 100. At that value it catches nearly every blurred photo
— but it also **refuses 24 of the 93 good photographs.** Lowered to 20, it still catches most
blur and refuses only 3.

The reasoning is a project rule: losing the enhancement costs a prettier photo, but a false
rejection costs the artisan the listing entirely. So when in doubt, let it through.

### One thing we deliberately did not change

The brightness cut-off could have been tightened slightly — on our test images it looked
free. **We left it alone on purpose.**

Our dark test images were darkened by calculation, not actually photographed in a dark room.
A genuinely underexposed photo is grainy in a way a calculated one is not. Tightening is the
direction that locks people out, and we will not do that on evidence that cannot see the
failure it would cause.

**This is the one open gap.** It needs 20–30 photographs of dark products, taken on a real
mid-range Android phone, in real indoor evening light.

---

## 6. Results, in numbers

| | Before | After |
|---|---|---|
| Good photographs wrongly refused by the phone | **65 of 93** | **21 of 93** |
| Bad photographs refused but given the wrong instruction | **200 of 498** | **79 of 498** |

The server gate now refuses 25 of the 93 good photographs — 10 of those are genuinely under
1000 pixels — and catches 291 of the 498 damaged ones. The rest are the off-centre and
too-far images, which pass on purpose because a later stage repairs them.

**Every threshold in the project is now traceable to a named photograph** and recorded in
`research/RESULTS.md`. There are automated tests that fail if the gate ever stops agreeing
with that evidence.

---

## 7. Phone vs server, at a glance

| | Runs on the phone | Runs on the server |
|---|---|---|
| **Coaching the shot** (light, framing, tilt) | Yes | No — there is no live preview to look at |
| **Blur** | Advice only | The real decision |
| **Removing hidden GPS data** | Yes, before it leaves the device | Too late by then |
| **Chunked upload** | Sends the pieces | Reassembles them |
| **Quality gate** | Advice | The real decision |
| **All enhancement** | No | Yes |

The shared file is `ai/thresholds.json`. Both sides read the same numbers while running, so
improving a threshold reaches every phone with no app update.

---

## 8. Where we are now

| Step | Work | Status |
|---|---|---|
| 0 | Collect fixtures, calibrate thresholds | **Done** |
| 1 | Store uploaded pieces | **Done** |
| 2 | Link an upload to a product | **Done** |
| 3 | Server quality gate | **Done** |
| 4 | Crop and composite | **Done** |
| 5 | Recipe system | Not started — recommended next |
| 6 | Choose the segmentation model | **Done — BiRefNet** |
| 7 | Segmentation and matting | **Done** |
| 8 | Mask confidence and fallback tiers | **Done** |
| 9 | Connect it to the live service | **Done** |

### What step 6 found

Step 6 was choosing which ready-made model separates the product from the background. It is
done. **We use BiRefNet.** Five models were run over 41 of your photographs and the cut-outs
compared side by side; the full argument and the numbers are in
`research/segmentation/RESULTS.md`, and the pictures are in `research/segmentation/out/`.

Three things came out of it that change what steps 7 and 8 have to be.

**The fringe problem is smaller than we thought — at the right size.** A tassel is hundreds
of loose threads, and the fear was that a model would cut a straight line through them and
produce something obviously fake. BiRefNet followed the individual threads, wisps included.
The plan assumed a separate "matting" stage would be needed to soften edges afterwards; on
this evidence it probably is not.

That came with a condition, and it was checked afterwards rather than assumed. The model
always works at 1024 pixels square, whatever it is given, and its answer is then stretched to
fit the photo. Stretch it too far and thin things dissolve: on a 22-megapixel photo, a
wire-thin nose ring turned into a blurred blob and individual hairs smeared together.

**But the pipeline never does that.** Every photo is shrunk to 2000 pixels before anything
touches it — a rule already in the spec, put there for speed. The stretch is then small, and
the edges hold. So that rule is doing more work than anyone realised: skipping the shrink to
"keep more quality" would make the cut-out visibly worse, not better. Measured in
`research/segmentation/RESULTS.md`.

**The hard case is not the one we prepared for.** A near-black pot on a near-black floor —
picked as the hardest image in the set — came out clean, handle holes and all. What broke was
cream cloth on a white background: the model kept a few fringe threads and threw the whole
cloth away. Pale product on a pale surface is the case to watch, and an artisan photographing
white cotton on a white sheet is not a rare event.

**The model never says "I am not sure".** Given a photo with no single clear product in it, it
does not return an empty or hesitant answer — it returns a confident outline around an
arbitrary piece. Step 8 therefore cannot ask the model how confident it is. It has to work that
out from the shape of the answer itself.

**Known constraint — resolved 2026-08-28.** This section used to say the development machine
had no graphics card, so the comparison would have to run on the processor with the lighter
model variants. It has one: an NVIDIA RTX 2050. The card was there all along; its driver was
not installed, and a driver only takes effect after a restart. Installed and rebooted, so the
comparison ran on the full-weight models.

**The constraint that replaces it:** the card has 4GB of memory. That is enough to compute the
cut-out at 1024x1024, which is the size these models are trained at, but not enough to do it at
full photo resolution. So the shape of the answer is almost certainly: work out the outline
small, then scale that outline up to the full photo. Whether that holds up at the edges — a
tassel is a few pixels wide — is one of the things the benchmark has to measure, not assume.

---

## 9. Open items for other people

**For the app developer:**

1. The gate's checks run in an order that can announce an overexposed photo as "too dark".
2. Blur should suggest, never block the shutter.
3. Nothing currently records where the white reference paper is in frame, so the colour
   correction cannot use it.
4. **Worth checking on a real phone:** a portrait photo may be ending up sideways. Phones
   store portrait photos as sideways pixels plus a note saying "rotate this", and
   `stripExif` removes all such notes. If the rotation is not applied before the note is
   removed, the photo stays sideways permanently. Unconfirmed, and a two-minute test.

**For the web developer:**

5. A `recipe` column and a `mask_version` field on the product record. Needed at step 5,
   and it is a database migration, so lead time matters.

---

## 10. Glossary

| Term | Meaning |
|---|---|
| **Capture gate** | The check running on the phone while the artisan is aiming |
| **Server gate** | The check running on the server after upload |
| **Threshold** | A cut-off number, e.g. "below this is too dark" |
| **EXIF** | Hidden data inside a photo file, including GPS coordinates |
| **Chunked resumable upload** | Sending a file in pieces so a dropped connection does not restart it |
| **Mask** | A map of which pixels are the product and which are background |
| **Matting** | Handling soft or see-through edges, instead of a hard yes/no cutout |
| **Segmentation** | The step that produces the mask |
| **White balance** | Correcting colour so it matches the real object |
| **Blown highlights** | Bright areas gone pure white, detail permanently lost |
| **Crushed shadows** | Dark areas gone pure black, same problem |
| **Composite** | Placing the cut-out product onto a new background |
| **Recipe** | Stored instructions for editing, so the original is never overwritten |
| **Fixture** | A test photograph kept specifically for checking our numbers |
