# Claude review result contract

For Rick Loop, a clean automated Claude review is valid only when all of the following are true:

- the result names the exact PR HEAD using `Reviewed commit: <sha>`;
- the result contains the explicit clean verdict `No major issues found.`;
- the reviewer identity is independent of the PR author;
- there are zero unresolved inline findings anchored to the same exact HEAD;
- any HEAD change invalidates the previous result and triggers a new review.

When Claude finds any actionable issue, it must publish `Review result: FINDINGS`, create inline comments where appropriate, and must not use the clean-verdict phrase anywhere in that result.
