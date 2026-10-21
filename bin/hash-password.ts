import bcrypt from "bcryptjs";

async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error("Usage: npm run hash-password '<password>'");
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  // Bcrypt hashes contain `$` which Next.js' env loader (dotenv-expand) will
  // eat as variable references, even inside single quotes. base64 the whole
  // thing so the env value contains only safe characters.
  const b64 = Buffer.from(hash, "utf8").toString("base64");
  console.log("");
  console.log("Paste this line into .env exactly as shown:");
  console.log("");
  console.log(`ADMIN_PASSWORD_HASH=${b64}`);
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
