import bcrypt from "bcryptjs";

async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error("Usage: npx tsx bin/hash-password.ts <password>");
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  console.log(hash);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
