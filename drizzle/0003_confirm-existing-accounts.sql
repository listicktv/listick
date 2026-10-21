-- accounts made before email confirmation existed were invited or imported: they count as confirmed, so none is locked out
UPDATE "user" SET "email_verified" = true WHERE "email_verified" = false;
