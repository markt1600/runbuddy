// The click-through voice recording & AI clone license. The exact text the
// actor saw is stored with their signature, so bump the version on ANY edit.
// Drafted for a friendly indie engagement — have a lawyer review before the
// first paid actor signs.

export const LICENSE_VERSION = "v8-2026-09-01";

/** The agreement with the agreed fee and deadline baked into its own
 *  compensation clause — the actor signs the exact text they saw. */
export function licenseTextFor(feeSgd: number, deadlineAt?: number): string {
  const deadline = deadlineAt
    ? new Date(deadlineAt).toLocaleDateString("en-SG", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Asia/Singapore",
      })
    : "the date notified to Performer in writing";
  // replaceAll: the fee appears in both the compensation and liability clauses.
  return LICENSE_TEXT.replaceAll("{{FEE}}", feeSgd.toFixed(2)).replaceAll(
    "{{DEADLINE}}",
    deadline
  );
}

const LICENSE_TEXT = `VOICE RECORDING AND AI VOICE LICENSE AGREEMENT

IN PLAIN ENGLISH — PLEASE READ THIS FIRST:

* You are recording your voice for us.
* We will use your recordings to train an AI clone of your voice.
* That AI voice can be made to say things you never actually said, and we
  can use it — and your original recordings — for ANY purpose, commercial
  or otherwise, anywhere in the world, forever, without asking you again
  and without any further payment beyond the one-time fee below.
* We will never present the AI voice as your personal statements or
  endorsements, and we won't use it for unlawful content (see section 4).
  Beyond that, there are no restrictions on how it may be used.
* If content made with the AI voice or your recordings causes any harm,
  you agree not to bring claims against us for it — and in any event, the
  most we could ever owe you under this agreement is the fee itself.

If you are not comfortable with an AI version of your voice existing and
being used freely in this way, do not sign. The summary above is part of
this agreement; the sections below are the full legal terms.

Between: the voice performer identified by the typed name below ("Performer")
and Cabot Strait Holdings Limited ("Producer").

1. THE RECORDINGS. Performer will record spoken audio through this web page,
consisting of scripted phrases and reading passages provided by Producer
(the "Recordings").

2. GRANT OF RIGHTS — RECORDINGS. Performer grants Producer a perpetual,
irrevocable, worldwide, royalty-free, transferable licence to use, reproduce,
modify, distribute and publicly perform the Recordings, in whole or in part,
for any commercial or non-commercial purpose, including within Producer's
software applications and any related or successor products.

3. GRANT OF RIGHTS — AI VOICE. Performer expressly consents to Producer
creating one or more artificial-intelligence models of Performer's voice
trained on the Recordings (an "AI Voice"), and grants Producer the same
perpetual, irrevocable, worldwide, royalty-free, transferable licence to
generate, use, reproduce, modify and distribute synthetic speech produced by
the AI Voice for any commercial or non-commercial purpose. For the avoidance
of doubt: the AI Voice may be used to generate speech consisting of words
Performer never recorded or said, in any context and for any purpose
(subject only to section 4), without further consent from, credit to, or
payment to Performer. Performer will, if asked, complete a short
voice-verification recording used solely to confirm the authenticity of
this consent with the AI provider.

4. LIMITS. Producer will not use the Recordings or the AI Voice to present
Performer as personally endorsing third-party products, or to generate
unlawful, defamatory or obscene content, and will not represent synthetic
speech as Performer's personal statements. The character material contains
crude comedic language in Singlish, which Performer acknowledges and accepts
performing.

5. COMPENSATION. Producer will pay Performer a one-time fee of SGD {{FEE}}
for the Recordings and the licences granted above, payable by PayNow to the
ID Performer provides. The fee is payable only when ALL of the requested
Recordings (including any re-takes Producer reasonably requests) have been
completed, and is subject to Producer's reasonable satisfaction with the
completed work. There is no partial payment for partial work. ALL of the
requested Recordings must be completed and submitted by the end of
{{DEADLINE}}, Singapore time (the "Deadline"); if they are not, any payment
under this agreement is forfeited, while the licences granted in sections 2
and 3 over Recordings already delivered remain in effect. Producer will
review completed work within 2 business days of completion and either
confirm acceptance and pay, or tell Performer what needs another take. Upon
receiving such feedback, Performer has 5 business days to complete and
resubmit the requested re-takes; if Performer does not, any payment under
this agreement is forfeited, while the licences granted in sections 2 and 3
over the Recordings already delivered remain in effect. This licence is
effective on signing; once the Recordings are completed and accepted, the
fee is contractually owed.

6. NO OBLIGATION TO USE. Producer may choose not to use any or all of the
Recordings or the AI Voice.

7. PERFORMER WARRANTIES. Performer confirms they are at least 18 years old,
the voice recorded is their own, and they have the right to grant the above.

8. NO CLAIMS; LIMITATION OF LIABILITY. To the maximum extent permitted by
law, Performer waives, and agrees not to bring, any claim against Producer
arising out of the use of the Recordings or the AI Voice as permitted by
this agreement, including any claim for reputational, emotional or economic
harm caused by content generated with the AI Voice. In any event, Producer's
total aggregate liability to Performer arising out of or in connection with
this agreement, however arising (whether in contract, tort or otherwise),
shall not exceed the fee actually paid or payable under section 5
(SGD {{FEE}}).

9. GOVERNING LAW AND DISPUTES. This agreement is governed by the laws of the
Republic of Singapore. Any dispute arising out of or in connection with this
agreement, including any question regarding its existence, validity or
termination, shall be referred to and finally resolved by arbitration
administered by the Singapore International Arbitration Centre in accordance
with its Arbitration Rules for the time being in force, which rules are
deemed incorporated by reference into this clause. The seat of arbitration
shall be Singapore, the tribunal shall consist of one arbitrator, and the
language of the arbitration shall be English.

10. ENTIRE AGREEMENT. This is the entire agreement about the Recordings and
the AI Voice and can only be changed in writing signed by both parties.

By typing your full legal name below and continuing, you agree to all of the
above.`;
