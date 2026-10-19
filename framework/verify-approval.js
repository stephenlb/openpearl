#!/usr/bin/env node
// Usage: OPENPEARL_INTAKE_KEY=... APPROVAL=<token> node framework/verify-approval.js
// Prints GitHub output lines (tenant=, slug=, issue=, user=). Exit 1 if the approval is not authentic.
import { verifyApproval } from './core/request.js';

try {
  const a = verifyApproval(process.env.APPROVAL ?? '', process.env.OPENPEARL_INTAKE_KEY);
  console.log(`tenant=${a.tenant}\nslug=${a.slug}\nissue=${a.issue}\nuser=${a.user}`);
} catch (e) {
  console.error(`Rejected: ${e.message}`);
  process.exit(1);
}
