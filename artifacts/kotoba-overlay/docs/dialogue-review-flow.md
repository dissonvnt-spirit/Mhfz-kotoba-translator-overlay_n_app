# Stable dialogue and approval-only journaling

Automatic capture observes horizontal Japanese OCR text in the selected area.
Each text change restarts a **3,000 ms minimum settling period**. The existing
capture polling interval and OCR processing mean the actual wait can be longer
than three seconds. This is an OCR-text stability heuristic, not proof that the
game has finished every animation.

After a stable page receives one translation attempt, it is not submitted again
automatically. This applies to failures as well as successes: the former
30-second automatic retry has been removed. Whitespace/width normalization
prevents formatting-only OCR changes from rearming a page. Genuine text changes,
even one Japanese character, are not deliberately treated as duplicates.

## Review

- A successful result appears in a temporary review card in the main window and
  companion overlay. It is not yet a journal entry.
- **Correct — save** durably stores the exact reviewed source and translation,
  then marks that attempt accepted. Duplicate or stale approval messages do
  nothing.
- **Incorrect — retry** makes one explicit new translation request for the same
  Japanese source using the currently selected engine. Rejected attempts do not
  enter the journal. There is no retry limit imposed by the UI, but cloud quotas
  still apply.
- Failed requests remain available for an explicit retry. Offline translation
  can return the same answer because it uses the same model; retries are not
  model training or a promise of a different answer.
- Until review is completed, new dialogue is observed but does not replace the
  current review card. Once approved, a different stable page can be submitted.
- Manual translations use the same approval rule. An unreviewed result must be
  resolved before another manual line is submitted.

The main window is the sole journal writer. The overlay requests actions by
attempt ID and asks for a fresh snapshot when opened, including when a review
already exists. The approved journal is used for backups and archives;
unapproved results remain in memory and are not restored after app restart.
Existing historical journal entries are preserved, not retroactively deleted.

Changing the capture area invalidates in-flight results from its previous area.
Stopping capture discards late automatic results without changing approved
entries or an already completed review. Pausing or selecting an area interrupts
the settling period. A stable blank interval allows a later, identical dialogue
page to be treated as a new occurrence.

If journal capacity or device storage prevents saving, approval is not
acknowledged as saved: the pending result remains available until the problem
is resolved.
