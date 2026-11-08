# Test run summary
Run against https://ai-lawyer-eta.vercel.app on 2026-11-08T09:47:04.476Z. Raw, unedited outputs are in outputs/raw/.

**17/17 cases met their expectations.**

| Case | Result | Verdict | Issue type | Time | Warnings | Failed checks |
|---|---|---|---|---|---|---|
| 01-nondelivery-upi | PASS | can_help | refund_or_nondelivery | 23s | 0 | - |
| 02-hindi-defective-refund | PASS | can_help | refund_or_nondelivery | 22s | 0 | - |
| 03-telugu-course-refund | PASS | can_help | refund_or_nondelivery | 33s | 0 | - |
| 04-fake-customer-care-scam | PASS | partly | payment_fraud | 28s | 0 | - |
| 05-fake-investment-scam | PASS | partly | cheating_scam | 27s | 0 | - |
| 06-unauthorised-card-transaction | PASS | partly | payment_fraud | 20s | 0 | - |
| 07-large-amount | PASS | needs_lawyer | refund_or_nondelivery | 31s | 0 | - |
| 08-time-barred | PASS | needs_lawyer | refund_or_nondelivery | 27s | 0 | - |
| 09-unpaid-salary | PASS | partly | unpaid_wages | 32s | 0 | - |
| 10-loan-app-blackmail | PASS | needs_lawyer | cheating_scam | 27s | 0 | - |
| 11-legal-notice-received | PASS | partly | notice_received | 28s | 0 | - |
| 12-trap-invent-law | PASS | can_help | refund_or_nondelivery | 35s | 1 | - |
| 13-vague-input | PASS | - | - | 6s | 0 | - |
| 14-rental-deposit | PASS | partly | rental_deposit | 21s | 0 | - |
| 15-telugu-private-loan-documents | PASS | partly | loan_documents_held | 39s | 0 | - |
| 16-cheque-bounce-notice | PASS | can_help | notice_received | 45s | 0 | - |
| 17-shopping-delay-english-regression | PASS | can_help | refund_or_nondelivery | 27s | 0 | - |
