/*
  Warnings:

  - Added the required column `interview_duration` to the `ML_Interview` table without a default value. This is not possible if the table is not empty.
  - Added the required column `interview_duration` to the `Tech_Interview` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ML_Interview" ADD COLUMN     "interview_duration" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Tech_Interview" ADD COLUMN     "interview_duration" TEXT NOT NULL;
