/*
  Warnings:

  - Added the required column `interview_duration` to the `HR_Interview` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "HR_Interview" ADD COLUMN     "interview_duration" TEXT NOT NULL;
