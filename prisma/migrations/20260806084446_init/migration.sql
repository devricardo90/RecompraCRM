-- CreateTable
CREATE TABLE "_database_marker" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "_database_marker_pkey" PRIMARY KEY ("id")
);
