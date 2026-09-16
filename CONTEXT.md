# ShareTally

ShareTally helps groups record shared purchases, submit individual shares, and settle debts.

## Language

**Initiator**:
The person who paid for the purchase and created its bill. The initiator is also a participant in that bill.
_Avoid_: Payer, which can also mean someone making a repayment.

**Participant**:
A person selected to declare their portion of a bill, including the initiator.
_Avoid_: Debtor, since participation does not necessarily mean the person owes money.

**Bill**:
A record of a purchase paid for by its initiator and shared among its selected participants.

**Group**:
A collection of distinct members who record shared bills and settle their debts together. Each group's debts are calculated independently of other groups.

**Member**:
A user who belongs to a group. Membership does not make the user a participant in every bill.

**Share**:
A participant's portion of a bill's total cost, including the initiator's own portion.
_Avoid_: Payment, which refers to money actually transferred.

**Share confirmation**:
A participant's acknowledgment of their submitted share. Manual bills require confirmation for the current bill revision; item-based bills also track confirmations of individual item claims.
_Avoid_: Payment confirmation, which acknowledges received money.

**Bill item**:
A separately listed purchase entry within an item-based bill, with a cost that participants can claim in full or in fractions.

**Item claim**:
A participant's declared fraction of a bill item, contributing to that participant's share when confirmed.

**Item confirmation**:
A participant's acknowledgment of their claim on a bill item at its current price. A price correction invalidates confirmations for that item without invalidating confirmations for other items.

**Claim reservation**:
A previously claimed fraction held for its claimant after an item-price correction, awaiting their renewed confirmation or release. It is unavailable to other claimants and contributes no confirmed amount until reconfirmed.

**Bill draft**:
An uninitialized bill visible only to its initiator, who can review and correct it before opening it for participation.

**Complete bill**:
A finalized bill whose participants have all confirmed their shares and whose permitted difference is accounted for by an initiator adjustment; it cannot be reopened. Completion does not mean the group has finished repaying its debts.
_Avoid_: Paid bill.

**Initiator adjustment**:
The difference between a bill's total and its submitted shares, assigned to the initiator without changing anyone's submitted share. It increases or decreases the initiator's effective cost.

**Repayment suggestion**:
A suggested transfer between group members calculated from their current net balances. Suggestions can change as the group's bills and recorded repayments change.

**Repayment**:
Money sent outside ShareTally from one group member to another to reduce a debt within that group.

**Repayment record**:
A sender's record of an actual transfer to another group member, with a pending, confirmed, or rejected receipt status. Its amount may repay part of a debt or exceed it, creating a reverse balance after confirmation.

**Rejected repayment**:
A repayment record declined by its recipient, with no effect on group balances.

**Payment confirmation**:
A recipient's acknowledgment that they received a repayment.

**Canceled bill**:
A bill withdrawn by its initiator and retained as a canceled record.

**Net balance**:
The amount a member is currently owed or owes within a group after accounting for eligible bills and repayments. Every member having a zero net balance means no repayments are needed at that moment.

**Group creator**:
The member who created a group. This role is distinct from a bill's initiator.

**Invitation link**:
A shareable link through which a signed-in user can join a group.
