# Participants own their bill shares

The completed-bill reopening rules below are superseded by [ADR-0006](0006-completed-bills-are-final.md). The confirmation-invalidation rules for manual bills below are superseded by [ADR-0015](0015-share-changes-do-not-invalidate-other-confirmations.md): a share change no longer clears other participants' confirmations, and initiator edits clear them only when the bill total changes. Participant ownership of shares remains in force.

Every selected participant, including the initiator, submits their own share, and the initiator cannot edit another participant's amount. An explicit zero is valid, but a missing submission prevents automatic completion even if the other shares already equal the bill total. The owner chose this collaborative workflow over initiator-entered allocations despite the extra coordination it requires.

Initiator edits reopen the bill and retain previous amounts. Every participant must reconfirm after reopening, including participants whose amounts remain unchanged; balancing retained amounts alone cannot complete a reopened bill.

Changing an existing share also clears everyone's confirmations while retaining amounts. A participant must ask the initiator to reopen a completed bill before editing their share. A participant's first submission on a new bill preserves earlier participants' confirmations; filling a missing share does not invalidate a previously confirmed share.
