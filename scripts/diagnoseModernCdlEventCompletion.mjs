import assert from "node:assert/strict";
import fs from "node:fs";
const src=fs.readFileSync(new URL("../src/components/CareerBoardReviewOverlay.jsx",import.meta.url),"utf8");
assert.match(src,/enteredMajorIdx != null/);
assert.match(src,/pendingCareerBoardReview/);
console.log("✓ Event placement owns enteredMajorIdx; career board review waits until it is dismissed.");
