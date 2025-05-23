-- CreateTable
CREATE TABLE "HR_Interview" (
    "id" TEXT NOT NULL,
    "session" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "experience" TEXT NOT NULL,
    "company_applying" TEXT NOT NULL,
    "job_description" TEXT NOT NULL,

    CONSTRAINT "HR_Interview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HR_Interview_session_key" ON "HR_Interview"("session");
