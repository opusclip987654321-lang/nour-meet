-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "reminderH2SentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RestaurantSubscription" ADD COLUMN     "expiryReminderSentAt" TIMESTAMP(3);

