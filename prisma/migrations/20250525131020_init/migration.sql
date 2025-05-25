-- CreateTable
CREATE TABLE "Tech_Interview" (
    "id" TEXT NOT NULL,
    "session" TEXT NOT NULL,
    "readme" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "dependencies" TEXT NOT NULL,
    "site_data" TEXT,

    CONSTRAINT "Tech_Interview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tech_Interview_session_key" ON "Tech_Interview"("session");
