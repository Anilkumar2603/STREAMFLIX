import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error: "Authentication required",
        },
        {
          status: 401,
        }
      );
    }

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error(
      "Get profile error:",
      error
    );

    return NextResponse.json(
      {
        error: "Failed to load profile",
      },
      {
        status: 500,
      }
    );
  }
}

export async function PATCH(
  request: Request
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error: "Authentication required",
        },
        {
          status: 401,
        }
      );
    }

    const body = await request.json();

    const name =
      typeof body.name === "string"
        ? body.name.trim()
        : "";

    const email =
      typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : "";

    /*
     * Validate name.
     */
    if (!name) {
      return NextResponse.json(
        {
          error: "Name cannot be empty",
        },
        {
          status: 400,
        }
      );
    }

    if (name.length > 100) {
      return NextResponse.json(
        {
          error:
            "Name cannot exceed 100 characters",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * Validate email.
     */
    if (!email) {
      return NextResponse.json(
        {
          error: "Email cannot be empty",
        },
        {
          status: 400,
        }
      );
    }

    const emailRegex =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      return NextResponse.json(
        {
          error: "Please enter a valid email address",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * Check whether another account
     * already uses this email.
     */
    const existingUser =
      await prisma.user.findFirst({
        where: {
          email,
          NOT: {
            id: user.id,
          },
        },
      });

    if (existingUser) {
      return NextResponse.json(
        {
          error:
            "An account with this email already exists",
        },
        {
          status: 409,
        }
      );
    }

    /*
     * Update the current user only.
     */
    const updatedUser =
      await prisma.user.update({
        where: {
          id: user.id,
        },
        data: {
          name,
          email,
        },
      });

    return NextResponse.json({
      success: true,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
      },
    });
  } catch (error) {
    console.error(
      "Update profile error:",
      error
    );

    return NextResponse.json(
      {
        error: "Failed to update profile",
      },
      {
        status: 500,
      }
    );
  }
}