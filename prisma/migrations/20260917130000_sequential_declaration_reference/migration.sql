CREATE TABLE "CustomsDeclarationSequence" (
    "id" INTEGER NOT NULL,
    "nextValue" BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT "CustomsDeclarationSequence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CustomsDeclarationSequence_singleton_check" CHECK ("id" = 1),
    CONSTRAINT "CustomsDeclarationSequence_positive_check" CHECK ("nextValue" >= 1)
);

INSERT INTO "CustomsDeclarationSequence" ("id", "nextValue")
VALUES (1, 1);
