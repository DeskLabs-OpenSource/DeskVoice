# Agent voice (ElevenLabs)

The pipeline voice engine (design `docs/specs/2026-11-17-motor-de-voz-em-pipeline.md`) keeps the
agent's voice apart from the brain and the transcription. The first outside voice is
**ElevenLabs**.

**In this version, only the key and the voice list.** The agent does not speak through ElevenLabs
yet: picking the voice in the agent is a later slice. Saving the key already tests the account and
shows the voices, ready for when the choice arrives.

ElevenLabs is optional. Without a key nothing changes: no request leaves, and existing installs see
no difference other than the new section in Settings.

## Saving the key

In **Settings → Voice**, next to **Brains**. Only an owner or an administrator can change it.

1. Read the **Where the text goes** notice (what it says is below, in "What ElevenLabs says it does
   with the text").
2. Paste the ElevenLabs key (<https://elevenlabs.io/app/settings/api-keys>).
3. Tick the confirmation: "The text the agent speaks on the call goes to ElevenLabs. It may repeat
   what the caller said, such as name, address and phone number."
4. Click **Save and test**. The key is stored encrypted and never comes back to the screen. The test
   asks the account for one voice (`GET /v2/voices`), which spends no characters, and shows the
   result: accepted, rejected, out of credit, and so on.

Without the confirmation the key is not saved. Who confirmed and when are kept, and the **Log** in
the Privacy section gets the line "Jane confirmed that the ElevenLabs voice receives the text the
agent speaks on the call". The line stays even after the key is removed or the person leaves the
team.

Removing the key removes the confirmation. A new key asks for the confirmation again, with a new
line in the Log. Testing the same key again asks for no confirmation and adds no line.

## The voices

With the key accepted, the section shows the voices the account already has, with the languages
ElevenLabs declares verified for each. Brazilian Portuguese voices come first. The play button plays
the sample ElevenLabs itself hosts (`preview_url`): **it spends no credit**. DeskVoice stores no
audio and no list: it is read from the account each time the section asks for it.

## What leaves the server

Once the voice is turned on in the agent (later slice), **the text the agent speaks on the call**
goes to ElevenLabs. When confirming a request, the agent repeats what the caller said: name,
address, phone number and time. In this version only the key leaves, in the test and when reading
the voice list.

## What ElevenLabs says it does with the text

Read on 17/11/2026, 15:50 UTC, and checked again at 17:23 UTC the same day, on delivery:

1. **Zero Retention Mode**, <https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode>
   (sha256 of the `.md` version: `0ca7448c2279cb985a0971253793499c53a8cb615adf3b01997bd6562f598087`,
   the same in both readings):
   - the "Default Retention" table says that, for Text to Speech, the text sent (*Text Input*) and
     the audio generated (*Audio Output*) are kept by default (**Enabled**);
   - "Customers by default have history preservation enabled. All customers can use the API to
     delete generations at any time. This action will immediately remove the corresponding audio and
     text from our database; however, debugging and moderation logs may still retain data related to
     the generation.";
   - "Following data deletion, database items are retained in backups for up to 30 days.";
   - zero retention is **Enterprise only**: "Enterprise customers can use Zero Retention Mode".
2. **Privacy policy**, <https://elevenlabs.io/privacy-policy> ("Updated 9 October 2026"; sha256 of
   the HTML on the first reading: `c45b9f33cfe1406f47e867e4eb3864d55602ee228441851b2efac812c85d3880`;
   on the second the HTML bytes changed, `c2d6101a…`, but the visible text is the same):
   - section 6: "We generally keep your personal information for as long as necessary to provide
     you with our Services […] for example, for as long as you have an account with us";
   - "Wherever you are, your personal information will be transferred to the United States for
     storage."

In short, outside Enterprise:

- **Retention:** the text stays in the account history until someone deletes the generation or the
  account. The page gives no other period.
- **After deletion:** it stays up to 30 days in backups.
- **Debugging and moderation logs:** may keep data from the generation, with no stated period.
- **Storage:** in the United States (privacy policy, updated 9/10/2026).
- **Processing:** ElevenLabs does not state where it processes. DeskVoice says "not stated"
  (`processingLocation: undeclared`) and assumes no country.

The project has not read the ElevenLabs Terms of Service, DPA or security page.

The decision to offer ElevenLabs even without a retention period was Rafael's, on 17/11/2026, with
the notice saying what the pages say (DESA-103, option A).

## Deleting what was sent

DeskVoice deletion (retention period, caller request) **does not reach ElevenLabs**. To delete the
text there, delete the generations in the ElevenLabs account history (in its app or through the
API). The backup of up to 30 days and the debugging and moderation logs remain. Removing the key in
DeskVoice only stops new sends.
