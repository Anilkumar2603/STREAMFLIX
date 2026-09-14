import { prisma } from "../lib/prisma";

async function main() {
  const email = "anilkumarreddy.k54321@gmail.com";

  const user = await prisma.user.update({
    where: {
      email,
    },
    data: {
      role: "ADMIN",
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  });

  console.log("Admin user updated:");
  console.log(user);
}

main()
  .catch((error) => {
    console.error("Failed to make user admin:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });