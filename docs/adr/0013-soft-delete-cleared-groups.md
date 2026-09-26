# Soft-delete cleared groups by their creator

The owner chose to let only a group's creator delete it, and only after the group's financial activity has been cleared. Deletion marks the group as deleted rather than removing its financial records: bills, bill items, shares and repayment records remain in the database. The deleted group disappears from every member's group list, all group-scoped endpoints—including its invitation—treat it as not found, and there is no read-only history view or restoration workflow.

A group is eligible for deletion only when every member's net balance is zero, there are no incomplete bills, and there are no pending repayment records. Bill drafts, including processing drafts, do not block deletion. Uninitiated drafts are deleted in the same transaction, so they cannot be viewed, edited or initiated; receipt processing finishing later stops without restoring them. There is no separate settlement step. The eligibility check and deletion mark must occur in one transaction that locks the group, preventing a bill or repayment from being added between the check and deletion.

Receipt photos and their raw receipt evidence are physically deleted within the group-deletion transaction, both for uninitiated drafts and for drafts linked to initiated bills. Initiated receipt drafts remain to preserve their receipt text; reviewed bill items and all financial records remain.

This is the first permission specific to the Group creator role. Other members cannot delete the group. Deleting an already deleted group is treated as not found.
