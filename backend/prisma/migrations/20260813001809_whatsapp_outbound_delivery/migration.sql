-- CreateEnum
CREATE TYPE "WhatsAppDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "whatsapp_messages" ADD COLUMN     "deliveryError" TEXT,
ADD COLUMN     "deliveryStatus" "WhatsAppDeliveryStatus" NOT NULL DEFAULT 'SENT',
ADD COLUMN     "sentByUserId" TEXT;
