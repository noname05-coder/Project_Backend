-- CreateTable
CREATE TABLE "Upload_data" (
    "id" TEXT NOT NULL,
    "session" TEXT NOT NULL,

    CONSTRAINT "Upload_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ML_Interview" (
    "id" TEXT NOT NULL,
    "session" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "ML_Interview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Upload_data_session_key" ON "Upload_data"("session");

-- CreateIndex
CREATE UNIQUE INDEX "ML_Interview_session_key" ON "ML_Interview"("session");
