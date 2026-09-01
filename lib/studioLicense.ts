// The click-through voice recording & AI clone license. The exact text the
// actor saw is stored with their signature, so bump the version on ANY edit.
// Drafted for a friendly indie engagement — have a lawyer review before the
// first paid actor signs.

export const LICENSE_VERSION = "v5-2026-09-01";

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
  return LICENSE_TEXT.replace("{{FEE}}", feeSgd.toFixed(2)).replace(
    "{{DEADLINE}}",
    deadline
  );
}

const LICENSE_TEXT = `VOICE RECORDING AND AI VOICE LICENSE AGREEMENT

Between: the voice performer identified by the typed name below ("Performer")
and Mark Tan ("Producer").

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
the AI Voice for any commercial or non-commercial purpose. Performer will,
if asked, complete a short voice-verification recording used solely to
confirm the authenticity of this consent with the AI provider.

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

8. GOVERNING LAW AND DISPUTES. This agreement is governed by the laws of the
Republic of Singapore. Any dispute arising out of or in connection with this
agreement, including any question regarding its existence, validity or
termination, shall be referred to and finally resolved by arbitration
administered by the Singapore International Arbitration Centre in accordance
with its Arbitration Rules for the time being in force, which rules are
deemed incorporated by reference into this clause. The seat of arbitration
shall be Singapore, the tribunal shall consist of one arbitrator, and the
language of the arbitration shall be English.

9. ENTIRE AGREEMENT. This is the entire agreement about the Recordings and
the AI Voice and can only be changed in writing signed by both parties.

By typing your full legal name below and continuing, you agree to all of the
above.`;
