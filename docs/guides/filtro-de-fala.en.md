# Speech filter

The speech filter reads the text of what the caller says and does two things:

- it **marks** speech that may be background (TV, radio, another person in the room), with the
  confidence;
- it **suggests** the likely reading of a term in the agent's vocabulary, when the transcription
  may have misspelled a name ("meu gasto" instead of "Melgaço"). The suggestion only appears with a
  confidence of 0.8 or more.

**It only marks and suggests.** No decision deletes speech or changes what the person said: the
heard text stays in the timeline, and the mark and the suggestion appear next to it. The call never
waits for the filter. A decision that arrives after the turn, or that does not arrive within 1 s,
stays in the timeline as an observation and changes nothing.

The filter comes **turned off**. Existing installations see no difference until someone turns it
on. Turned off, the call is the same as before: no request goes out, and no new line appears in the
timeline.

The full design is in `docs/specs/2026-11-14-transcricao-pura.md`, part 3 (in Portuguese, still in
PR #198, outside `main`).

## Turning it on

In **Settings → Speech filter**. Only an owner or admin changes it; the other roles see it.

1. Under **Model keys**, paste the Jev key and click **Save and test**. The key is encrypted in the
   database and never comes back to the screen. The test asks for the account's model list, with no
   token cost, and shows the result (accepted, rejected, no credit, and so on).
2. Under **Decision model**, choose **Jev (TypeSafe)**.
3. Read the **Where the text goes** notice and tick the confirmation: "The call's text goes to
   TypeSafe." What goes, in detail, is under "What leaves the server", just below.
4. Click **Save**. The screen then shows who confirmed the sending and when.

Without the confirmation, Jev is not saved. Each new confirmation leaves a receipt in **Settings →
Privacy**, in the log: who confirmed, when, and which provider the text goes to. Turning it off
(choosing **None**) or switching models removes the current confirmation, and turning it on again
asks for a new one; the receipt stays in the log.

## What leaves the server

Jev belongs to TypeSafe AI and runs outside this server. For each caller utterance, a request goes
out with:

- the caller's utterance, as the transcription wrote it;
- the agent's last utterance, when there is one;
- the filter's questions, which are fixed, and, when the agent has a vocabulary, up to four of its
  terms that look like the utterance.

The cost of each request goes into the call cost, at the model file's price (US$ 0.042 per million
input tokens, output free, checked on November 16, 2026). When the request goes out and the usage
does not come back (late, no network, malformed answer), the cost is estimated from the input sent,
marked as estimated, and counts toward the call ceiling.

## What TypeSafe says it does with the text

Source: TypeSafe's privacy policy, <https://typesafe.ai/legal/privacy-policy> ("Last updated Nov
19, 2025"), read on November 16, 2026.

- **Retention:** TypeSafe keeps the personal data it receives, such as this text, for as long as
  reasonably necessary to provide the service or for its business or commercial purposes. The
  policy sets no period.
- **Deletion:** on request, it deletes this data or keeps it in a form that does not identify the
  person once it is no longer reasonably necessary, unless the law requires it to keep the data
  longer.
- **Location:** the service is hosted in the United States.

The project has not read TypeSafe's contract or the pages that require a login.

## Asking TypeSafe for deletion

The page gives no specific channel for a deletion request. The contact it gives for questions
about data processing is **privacy@typesafe.ai**. Write to that address from your organization's
TypeSafe account (the one that owns the key), say which data you want deleted (for example, what was
sent between two dates), and keep the answer. Under the policy, deletion depends on two conditions:
the data is no longer reasonably necessary to TypeSafe, and no law requires it to keep the data
longer. It promises no time to act on the request.

Turning the filter off does not delete what was already sent: it only stops new sending.
DeskVoice's own deletion (retention period and caller requests) does not reach TypeSafe either.

## In the timeline

- **May be background speech (confidence 0.82):** below the utterance, which stays whole.
- **Likely reading: Melgaço (confidence 0.91):** below the utterance, which stays as heard.
- **Speech filter observation:** a decision that arrived after the turn, such as "the person had
  finished the thought". It changed nothing.
- **The speech filter did not answer in time**, or **did not read this utterance** (with the
  reason, such as a missing key): the call went on without it.
