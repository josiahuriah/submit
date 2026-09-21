-- Preserve every explicit secondary Customs status request and raw response.

CREATE TABLE "CustomsSubmissionStatusCheck" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "submissionAttemptId" TEXT NOT NULL,
  "checkNumber" INTEGER NOT NULL,
  "messageId" TEXT NOT NULL,
  "originalMessageId" TEXT NOT NULL,
  "outcome" "SubmissionAttemptOutcome" NOT NULL DEFAULT 'PENDING',
  "redactedSoapEnvelope" TEXT NOT NULL,
  "responsePayload" TEXT,
  "httpStatus" INTEGER,
  "soapFaultCode" TEXT,
  "soapFaultReason" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "CustomsSubmissionStatusCheck_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomsSubmissionStatusCheck_organizationId_messageId_key"
  ON "CustomsSubmissionStatusCheck"("organizationId", "messageId");
CREATE UNIQUE INDEX "CustomsSubmissionStatusCheck_submissionAttemptId_checkNumber_key"
  ON "CustomsSubmissionStatusCheck"("submissionAttemptId", "checkNumber");
CREATE INDEX "CustomsSubmissionStatusCheck_organizationId_submissionAttemptId_startedAt_idx"
  ON "CustomsSubmissionStatusCheck"("organizationId", "submissionAttemptId", "startedAt" DESC);

ALTER TABLE "CustomsSubmissionStatusCheck" ADD CONSTRAINT "CustomsSubmissionStatusCheck_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomsSubmissionStatusCheck" ADD CONSTRAINT "CustomsSubmissionStatusCheck_submissionAttemptId_fkey"
  FOREIGN KEY ("submissionAttemptId") REFERENCES "CustomsSubmissionAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
