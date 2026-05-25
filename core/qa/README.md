# core/qa

Shared QA routing helpers.

The actionability helper converts QA payload findings and executable check results
into the items that should block routing or feed fix-feedback. It keeps disposition
semantics centralized so QA, fix-feedback, and UI code do not each redefine what
counts as in-scope repair work.
